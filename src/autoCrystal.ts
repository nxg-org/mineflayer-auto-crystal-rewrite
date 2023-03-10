import { EventEmitter } from "events";
import type { Bot } from "mineflayer";
import type { Entity } from "prismarine-entity";
import merge from "ts-deepmerge";
import { Vec3 } from "vec3";
import { CrystalTracker } from "./util/crystalTracker";
import { BreakType, DeepPartial, EntityRaycastReturn, PlaceType } from "./types";
import { blockFaceToVec, DefaultOptions, getViewDirection, isRaycastEntity, sleep } from "./util/randoms";
import { isPosGood, predictiveFindPosition, testFindPosition } from "./util/utilPlacement";
import { AABB, AABBUtils, BlockFace, MathUtils } from "@nxg-org/mineflayer-util-plugin";
import { shouldAttemptAttack } from "./util/utilBreaking";

export interface AutoCrystalOptions {
  placeAndBreak: boolean;

  tpsSync:
    | { enabled: false; placeSleep: number; breakSleep: number; breakCrystalAge: number; breakWaitTimeout: number }
    | { enabled: true; placeTicks: number; breakTicks: number; breakCrystalTicks: number; breakTickTimeout: number };
  positionLookup: {
    async: boolean;
    positionCount: number;
    positionDistanceFromOrigin?: number;
  } & ({ aabbCheck: "predictive" | "current" | "none" | "all" } | { aabbCheck: "current_nohit"; countAABBAfterXms: number });
  crystalTrackerOptions: {
    fastModes: {
      sound: boolean;
      explosion: boolean;
    };
    careAboutPastPlaceAttempts: boolean;
    deletePlacementsAfter: number;
  };
  placement: {
    skipPosIfCrystalThere: boolean;
    predictOnBreak: boolean;
    predictOnExplosion: boolean;
    useBackupPositions: boolean;
    placementPriority: "damage" | "closest" | "farthest" | "none";
    minDamage: number;
    placesPerTry: number;
    placeDistance: number;
    useOffhand: boolean;
  } & ({ stagger: false } | { stagger: true; staggerDelay: number }) &
    ({ raycast: false } | { raycast: true; entityRaycast?: boolean });
  breaking: {
    predictOnSpawn: boolean;
    hitAll: boolean;
    minDamage: number;
    offhandAttack: boolean;
    breaksPerTry: number;
    triesPerCrystal: number;
    delayBetweenTries: number;
    breakDistance: number;
    raytrace: boolean;
  } & ({ swingArm: false } | { swingArm: true; offhandSwing: boolean });
  rotation: {
    placement: boolean;
    lookDotThreshhold: number;
  } & ({ breaking: false } | { breaking: true; dontRotateIfCrystalAABBHit: boolean });
}

export class AutoCrystal extends EventEmitter {
  public readonly placeableBlocks = new Set<number>();

  public options: AutoCrystalOptions;
  public readonly tracker: CrystalTracker;
  private _target?: Entity;
  private positions: PlaceType[] = [];
  private running = false;

  public get target() {
    return this._target;
  }

  // private wantsBreak = false;
  private shouldBreak = false;
  private toBreak: Entity[] = [];
  private breaksThisTick = 0;
  private placesThisTick = 0;

  constructor(public readonly bot: Bot, options: DeepPartial<AutoCrystalOptions> = {}) {
    super();
    this.tracker = new CrystalTracker(bot, options.crystalTrackerOptions);
    this.options = merge({}, DefaultOptions, options as AutoCrystalOptions);
    this.placeableBlocks.add(bot.registry.blocksByName.obsidian.id);
    this.placeableBlocks.add(bot.registry.blocksByName.bedrock.id);
  }

  private onLocalTick = async () => {
    // if (this.wantsBreak) {
    //   this.shouldBreak = true;
    //   this.wantsBreak = false;
    // }
    this.breaksThisTick = 0;
    this.placesThisTick = 0;
  };

  public stop() {
    this.running = false;
    this._target = undefined;
    this.tracker.stop();
    this.bot.off("entitySpawn", this.onEntitySpawn);
    this.bot.off("entityGone", this.onEntityDestroyed);
    this.bot.off("physicsTick", this.onLocalTick);
    this.bot._client.off("explosion", this.onExplosion);
  }

  public attack(entity?: Entity) {
    if (this.running) return;
    if (!this._target && !entity) return;
    if (!this._target) this._target = entity;

    this.running = true;
    if (this.options.tpsSync.enabled) {
    } else {
      this.desyncedPlaceThread();
      this.desyncedBreakThread();
    }
    if (this.options.positionLookup.async) this.asyncPositionThread();
    this.bot.prependListener("entitySpawn", this.onEntitySpawn);
    this.bot.prependListener("entityGone", this.onEntityDestroyed);
    this.bot.on("physicsTick", this.onLocalTick);
    this.bot._client.on("explosion", this.onExplosion);

    this.tracker.start();
  }

  private tickForPosUpdate = () => {
    if (!this._target) return Promise.resolve();
    let lastPos = this._target.position.clone();
    return new Promise((res, rej) => {
      const botChecker = (e: Entity) => !this._target || (e.id === this._target.id && !e.position.equals(lastPos)); //e.position.distanceTo(lastPos) >= 1);
      const botListener = (e: Entity) => {
        if (botChecker(e)) {
          this.bot.off("entityMoved", botListener);
          this.bot.off("entitySpawn", crystalListener);
          this.tracker.off("serverCrystalDestroyed", crystalListener);
          res(undefined);
        }
      };

      const crystalListener = (...args: any[]) => {
        this.bot.off("entityMoved", botListener);
        this.bot.off("entitySpawn", crystalListener);
        this.tracker.off("serverCrystalDestroyed", crystalListener);
        res(undefined);
      };

      this.bot.on("entityMoved", botListener);
      this.bot.on("entitySpawn", crystalListener);
      this.tracker.on("serverCrystalDestroyed", crystalListener);
    });
  };

  private waitForCrystalBreakOr = (ms: number) => {
    if (!this._target) return Promise.resolve();
    return new Promise((res, rej) => {
      const crystalListener = (...args: any[]) => {
        this.off("brokeCrystals", crystalListener);
        res(undefined);
      };
      this.on("brokeCrystals", crystalListener);
      sleep(ms).then((e) => {
        this.off("brokeCrystals", crystalListener);
        // Object.values(this.bot.entities).forEach((e) => e.isValid === true);
        res(undefined);
      });
    });
  };

  protected asyncPositionThread = async () => {
    while (this.running && this._target?.isValid && this.options.positionLookup.async) {
      const time = performance.now();
      this.positions = this.getPositions();
      const now = performance.now();
      if (now - time > 50) await sleep(10);
      else await this.tickForPosUpdate();
      // const before = now - time;
      // const after = performance.now() - now;
      // console.log("search:", before, "wait:", after, "total:", before + after);
    }
  };

  protected getPositions = (): PlaceType[] => {
    if (!this._target) return [];
    return predictiveFindPosition(this, this._target);
  };

  protected onEntitySpawn = async (entity: Entity) => {
    if (!this._target) return;
    if (entity.entityType !== this.tracker.endCrystalType) return;
    const info = shouldAttemptAttack(this, this._target, entity);
    if (info) {
      if (!this.options.placeAndBreak) {
        this.toBreak.push(entity);
        this.shouldBreak = true;
      } else if (this.options.breaking.predictOnSpawn) {
        this.breakCrystal(info);
      }
    }
  };

  protected onEntityDestroyed = async (entity: Entity) => {
    if (!this._target) return;
    if (entity.entityType !== this.tracker.endCrystalType) return;
    if (this.options.placement.predictOnBreak && (!this.shouldBreak || !this.options.placeAndBreak)) {
      const blockPos = entity.position.offset(-0.5, -1, -0.5);
      const posInfo = isPosGood(this, this._target, blockPos);
      if (posInfo) {
        const dmgs = this.positions.map((p) => p.dmg);
        const minDmg = Math.min(posInfo.dmg, ...dmgs);
        const maxDmg = Math.max(...dmgs);
        if (posInfo.dmg >= maxDmg) {
          console.log("placing1!");
          this.tracker.addPlacement(blockPos);
          this.placeCrystal(posInfo);
        }
      }
    }
  };

  protected onExplosion = (packet: any) => {
    if (!this._target) return;
    if (!this.options.placement.predictOnExplosion && (!this.shouldBreak || !this.options.placeAndBreak)) return;
    const pos = new Vec3(packet.x - 0.5, packet.y - 1, packet.z - 0.5);
    const check = isPosGood(this, this._target, pos);
    if (check) {
      this.tracker.addPlacement(pos);
      this.placeCrystal(check);
    }
  };

  private placementDot = (eyePos: Vec3, p: Vec3) => {
    return p.minus(eyePos).normalize().dot(getViewDirection(this.bot.entity.pitch, this.bot.entity.yaw));
  };

  protected desyncedPlaceThread = async () => {
    if (this.options.tpsSync.enabled) return;

    while (this.running && this._target?.isValid) {

      let waitTime = this.options.tpsSync.placeSleep;
      if (!this.options.positionLookup.async) {
        const time = performance.now();
        this.positions = this.getPositions();
        // console.log((performance.now() - time))
        waitTime -= (performance.now() - time);
      }

      if (this.options.placement.skipPosIfCrystalThere) {
        this.positions.filter(this.tracker.canPlace);
      }

      if (this.positions.length === 0) {
        console.log("zero pos?????", this.tracker._attemptedPlacements);
        await this.tickForPosUpdate();
        continue;
      }

      if (this.shouldBreak && !this.options.placeAndBreak) {
        // console.log("waiting??");
        await this.waitForCrystalBreakOr(this.options.tpsSync.breakWaitTimeout);
      }

      // const now = performance.now();
      // console.log("place loop", now - time)
      // time = now;

      // console.log(this.positions)
      /**
       * Note: NCP aim check seems to be bypassable so long as, at the end of the current tick,
       * Your aim is back to where it was before the tick started.
       */
      // no stagger, sorted by distance from current eye pos to minimize look packets (less anti-cheat)
      const eyePos = this.bot.entity.position.offset(0, 1.62, 0);
      if (!this.options.placement.stagger)
        this.positions.sort((a, b) => this.placementDot(eyePos, a.lookHere) - this.placementDot(eyePos, b.lookHere));
      // console.log(this.positions.map(i=>[i.block, this.placementDot(eyePos, i.lookHere)]))

      // let breakLim = this.options.placement.placesPerTry;
      // for (let i = 0; i < breakLim && i < this.positions!.length; i++) {
      //   const p = this.positions[i];
      //   if (this.placer.canPlace(p)) {
      //     this.placer.addPlacement(p.block);
      //     this.placeCrystal(p);
      //   } else if (this.options.placement.useBackupPositions) breakLim++;
      // }

      // await sleep(this.options.tpsSync.placeDelay);

      // staggered, sorted solely by damage. Will trigger higher anticheats.
      const finalPlacements: [PlaceType[], PlaceType[]] = [[], []];
      let breakLim = this.options.placement.placesPerTry;
      let staggerFlag = false;
      for (let i = 0; i < breakLim && i < this.positions!.length; i++) {
        const p = this.positions[i];
        // console.log(p, i, this.tracker.canPlace(p))
        if (this.tracker.canPlace(p)) {
          finalPlacements[i % (staggerFlag ? 2 : 1)].push(p);
          this.tracker.addPlacement(p.block);
          if (this.options.placement.stagger) staggerFlag = !staggerFlag;
        } else if (this.options.placement.useBackupPositions) breakLim++;
      }

      finalPlacements[0].map(this.placeCrystal);
      if (this.options.placement.stagger && finalPlacements[1].length > 0) {
        await sleep(this.options.placement.staggerDelay);
        finalPlacements[1].map(this.placeCrystal);
        await sleep(waitTime - this.options.placement.staggerDelay);
      } else {
        await sleep(waitTime);
      }
    }
    if (this.running) this.stop();
  };

  private desyncedBreakThread = async () => {
    if (this.options.tpsSync.enabled) return;
    const getDmg = (i: Entity, origin: Vec3) => this.bot.getExplosionDamages(i, origin, 6, true) ?? -1;
    const filterFunc = (testE: Entity, origin: Vec3) => {
      const ret = getDmg(testE, origin) <= 0;
      if (!ret) (testE as any).lastHit = performance.now();
      return ret;
    };

    const crystalsInWanted = (entities: Entity[]) => {
      // console.log(entities.map(e=>[e.name, e.position]), this.positions.map(info=>info.block.offset(0.5, 1, 0.5)))
      return this.positions.some((info) => entities.some((e) => e.position.equals(info.block.offset(0.5, 1, 0.5))));
    };

    while (this.running && this._target?.isValid) {
      let entities = Object.values(this.bot.entities).filter((e) => {
        if (e.entityType !== this.tracker.endCrystalType) return false;
        const now = performance.now();
        if (this.options.tpsSync.enabled)
          return Math.floor(now - ((e as any).lastHit ?? 0)) * 50 > this.options.tpsSync.breakTickTimeout;
        else return now - ((e as any).lastHit ?? 0) > this.options.tpsSync.breakWaitTimeout;
      });

      if (!this.shouldBreak && !crystalsInWanted(Object.values(this.bot.entities)) && !this.options.placeAndBreak) {
        // console.log("waiting on places?");
        await sleep(this.options.tpsSync.breakSleep);
        continue;
      }

      let count = 0;
      const broken: Entity[] = [];
      const tasks = [];
      if (this.toBreak.length !== 0) {
        // console.log("HAVE TO BREAK", this.toBreak.length);
        let target: Entity | undefined;

        while (!!(target = this.toBreak.pop())) {
          const info = shouldAttemptAttack(this, this._target!, target);
          if (!info) continue;
          tasks.push(this.breakCrystal(info));
          (target as any).lastHit = performance.now();
          broken.push(target);
          if (!this.options.breaking.hitAll) {
            const before = this.toBreak.length;
            this.toBreak = this.toBreak.filter((e) => filterFunc(e, target!.position));
            // console.log("before:", before, "after sort:", this.toBreak.length);
          }
        }
      } else {
        let raw = Object.values(this.bot.entities).filter(
          (e) => e.entityType === this.tracker.endCrystalType // .isValid
        );

        const eyePos = this.bot.entity.position.offset(0, 1.62, 0);
        entities.sort((a, b) => this.placementDot(eyePos, b.position) - this.placementDot(eyePos, a.position));
        // console.log(entities.map((e) => this.placementDot(eyePos, e.position)));

        let target: Entity | undefined;

        while (!!(target = entities.pop())) {
          const info = shouldAttemptAttack(this, this._target!, target);
          if (!info) {
            continue;
          }

          tasks.push(this.breakCrystal(info));
          (target as any).lastHit = performance.now();
          broken.push(target);
          if (!this.options.breaking.hitAll) {
            entities = entities.filter((e) => filterFunc(e, target!.position));
          }
        }
      }

      await Promise.all(tasks);

      this.emit("brokeCrystals", broken);
      this.shouldBreak = false;
      await sleep(this.options.tpsSync.breakSleep);
    }
  };

  // ========================
  //     crystal logic
  // ========================

  public placeCrystal = async (placeInfo: PlaceType) => {
    if (!(await this.equipCrystal())) return this.stop();
    // if (this.placesThisTick++ > this.options.placement.placesPerTry) return;
    const block = this.bot.blockAt(placeInfo.block);
    if (!block) return;

    // If check here to limit
    if (
      this.options.rotation.placement && 
      this.placementDot(this.bot.entity.position.offset(0, 1.62, 0), placeInfo.lookHere) <
      this.options.rotation.lookDotThreshhold
    ) {
      await this.bot.util.move.forceLookAt(placeInfo.lookHere, true);
    }
    await this.bot._genericPlace(block!, placeInfo.placeRef, {
      forceLook: "ignore",
      // forceLook: this.options.placement.rotate,
      offhand: this.options.placement.useOffhand,
      swingArm: this.options.placement.useOffhand ? "left" : "right",
    });
    return;
  };

  public breakCrystal = async ({ lookHere: hitLook, id: hitId }: BreakType) => {
    if (!this.target) return;
    if (this.bot.entities[hitId].entityType !== this.tracker.endCrystalType) return;
    const entity = this.bot.entities[hitId];
    if (!entity) return;

    // if (!hitLook.equals(naiveHit)) console.log("hitting", hitId, "with", hitLook, "instead of", naiveHit);

    for (let i = 0; i < this.options.breaking.triesPerCrystal; i++) {
      // if (this.breaksThisTick++ > this.options.breaking.breaksPerTry) return "max tries";

      if (this.options.rotation.breaking) {
        let flag = true;
        if (this.options.rotation.dontRotateIfCrystalAABBHit) {
          const eyePos = this.bot.entity.position.offset(0, this.bot.entity.height, 0);
          const offset = MathUtils.yawPitchAndSpeedToDir(
            this.bot.entity.yaw,
            this.bot.entity.pitch,
            this.options.breaking.breakDistance
          );
          flag = !AABBUtils.getEntityAABB(entity).intersectsSegment(eyePos, offset.add(eyePos));
        }
        const dotCheck =
          this.placementDot(this.bot.entity.position.offset(0, 1.62, 0), hitLook) <
          this.options.rotation.lookDotThreshhold;
        if (dotCheck && flag) {
          // console.log("here", this.placementDot(this.bot.entity.position.offset(0, 1.62, 0), hitLook))
          await this.bot.util.move.forceLookAt(hitLook, true);
        }
      }

      if (!this.bot.entities[hitId]) {
        console.log("somehow cant hit the entity despite raytacing it.");
        return;
      }

      (this.bot as any).attack(entity, this.options.breaking.swingArm, this.options.breaking.offhandAttack);
      (this.bot.entities[hitId] as any).lastHit = performance.now();

      if (i < this.options.breaking.triesPerCrystal - 1) {
        await new Promise((res, rej) => {
          const listener = (entity: Entity) => {
            if (entity.id === hitId) {
              this.bot.off("entityGone", listener);
              res(undefined);
            }
          };
          this.bot.on("entityGone", listener);
          sleep(this.options.breaking.delayBetweenTries).then(() => {
            this.bot.off("entityGone", listener);
            res(undefined);
          });
        });
      }
    }

    if (this.bot.entities[hitId]?.isValid) {
      if (!this.options.tpsSync.enabled) {
        await new Promise((res, rej) => {
          const listener = (entity: Entity) => {
            if (entity.id === hitId) {
              this.bot.off("entityGone", listener);
              res(undefined);
            }
          };
          this.bot.on("entityGone", listener);
          sleep((this.options.tpsSync as any).breakWaitTimeout).then(() => {
            this.bot.off("entityGone", listener);
            res(undefined);
          });
        });
      }
    }

    return;
  };

  // ====================
  //      bot util
  // ====================

  private async equipCrystal(): Promise<boolean> {
    if (this.bot.util.inv.getHandWithItem(this.options.placement.useOffhand)?.name.includes("_crystal")) return true;
    const handName = this.options.placement.useOffhand ? "off-hand" : "hand";
    const crystal = this.bot.util.inv.getAllItemsExceptCurrent(handName).find((item) => item.name.includes("_crystal"));
    if (crystal) {
      await this.bot.util.inv.customEquip(crystal, handName);
      return !!this.bot.util.inv.getHandWithItem(this.options.placement.useOffhand)?.name.includes("_crystal");
    }
    return false;
  }
}

let time = performance.now();
