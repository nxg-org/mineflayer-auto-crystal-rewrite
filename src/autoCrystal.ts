import { EventEmitter } from "events";
import type { Bot } from "mineflayer";
import type { Entity } from "prismarine-entity";
import merge from "ts-deepmerge";
import { Vec3 } from "vec3";
import { CrystalTracker } from "./util/crystalTracker";
import { DeepPartial, EntityRaycastReturn, PlaceType } from "./types";
import { blockFaceToVec, DefaultOptions, isRaycastEntity, sleep } from "./util/randoms";
import { isPosGood, predictiveFindPosition, testFindPosition } from "./util/utilPlacement";
import { AABB, AABBUtils, BlockFace } from "@nxg-org/mineflayer-util-plugin";
import { shouldAttemptAttack } from "./util/utilBreaking";

export interface AutoCrystalOptions {
  placeAndBreak: boolean;
  tpsSync:
    | { enabled: false; placeDelay: number; breakDelay: number }
    | { enabled: true; placeTicks: number; breakTicks: number };
  positionLookup: {
    async: boolean;
    positionCount: number;
    positionDistanceFromOrigin?: number;
    aabbCheck: "predictive" | "actual" | "none" | "all";
  };
  crystalTrackerOptions: {
    fastModes: {
      sound: boolean;
      explosion: boolean;
    };
    careAboutPastPlacements: boolean;
    deletePlacementsAfter: number;
  };
  placement: {
    predictOnBreak: boolean;
    predictOnExplosion: boolean;
    careAboutPastPlacements: boolean;
    rotate: boolean;
    useBackupPositions: boolean;
    raycast: boolean;
    placementPriority: "damage" | "closest" | "farthest" | "none";
    minDamage: number;
    placesPerTry: number;
    placeDistance: number;
    useOffhand: boolean;
  } & ({ stagger: false } | { stagger: true; staggerDelay: number });
  breaking: {
    hitAll: boolean;
    minDamage: number;
    rotate: boolean;
    useOffhand: boolean;
    breaksPerTry: number;
    triesPerCrystal: number;
    delayBetweenTries: number;
    breakDistance: number;
    raytrace: boolean;
  } & ({ swingArm: false } | { swingArm: true; offhand: boolean });
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

  private wantsBreak = false;
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
    if (this.wantsBreak) {
      this.shouldBreak = true;
      this.wantsBreak = false;
    }

    this.breaksThisTick = 0;
    this.placesThisTick = 0;
  };

  public stop() {
    this.running = false;
    this._target = undefined;
    this.tracker.stop();
    this.bot.off("entitySpawn", this.onEntitySpawn);
    this.bot.off("physicsTick", this.onLocalTick);
  }

  public attack(entity?: Entity) {
    if (this.running) return;
    if (!this._target && !entity) return;
    if (!this._target) this._target = entity;
    this.tracker.start();
    this.running = true;
    if (this.options.tpsSync.enabled) {
    } else {
      this.desyncedPlaceThread();
      this.desyncedBreakThread();
    }
    if (this.options.positionLookup.async) this.asyncPositionThread();
    this.bot.prependListener("entitySpawn", this.onEntitySpawn);
    this.bot.on("physicsTick", this.onLocalTick);
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

  private waitForCrystalBreak = () => {
    if (!this._target) return Promise.resolve();
    return new Promise((res, rej) => {
      const crystalListener = (...args: any[]) => {
        this.off("brokeCrystals", crystalListener);
        res(undefined);
      };
      this.on("brokeCrystals", crystalListener);
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
    if (entity.entityType === this.tracker.endCrystalType) {
      if (!this.options.placeAndBreak) {
        this.toBreak.push(entity);
        this.wantsBreak = true;
      } else {
        this.breakCrystal(entity);
      }
      if (this.options.placement.predictOnBreak && (!this.shouldBreak || !this.options.placeAndBreak)) {
        const blockPos = entity.position.offset(-0.5, -1, -0.5);
        const posInfo = isPosGood(this, this._target, blockPos);
        if (posInfo) {
          const dmgs = this.positions.map((p) => p.dmg);
          const minDmg = Math.min(posInfo.dmg, ...dmgs);
          const maxDmg = Math.max(posInfo.dmg, ...dmgs);
          if (posInfo.dmg > minDmg || posInfo.dmg === maxDmg) {
            this.tracker.addPlacement(blockPos);
            this.placeCrystal(posInfo);
          }
        }
      }
    }
  };

  protected onFastExplosion = async (reason: string, explodePos: Vec3) => {
    if (!this._target) return;
    if (this.options.placement.predictOnExplosion) {
      const posInfo = isPosGood(this, this._target, explodePos);
      if (posInfo) {
        this.tracker.addPlacement(explodePos);
        this.placeCrystal(posInfo);
      }
    }
  };

  protected desyncedPlaceThread = async () => {
    if (this.options.tpsSync.enabled) return;

    while (this.running && this._target?.isValid) {
      if (!this.options.positionLookup.async) {
        this.positions = this.getPositions();
      }

      if (this.positions.length === 0) {
        await this.tickForPosUpdate();
        continue;
      }

      if (this.shouldBreak && !this.options.placeAndBreak) {
        await this.waitForCrystalBreak();
      }

      const finalPlacements: [PlaceType[], PlaceType[]] = [[], []];
      let breakLim = this.options.placement.placesPerTry;
      let staggerFlag = false;
      for (let i = 0; i < breakLim && i < this.positions!.length; i++) {
        const p = this.positions[i];
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
        await sleep(this.options.tpsSync.placeDelay - this.options.placement.staggerDelay);
      } else {
        await sleep(this.options.tpsSync.placeDelay);
      }

      // rough fix.
      // if (count++ % clearNum === 0) this.tracker.clearAttempts();
    }
    if (this.running) this.stop();
  };

  private desyncedBreakThread = async () => {
    if (this.options.tpsSync.enabled) return;
    const getDmg = (i: Entity, target: Entity) => this.bot.getExplosionDamages(i, target!.position, 6, true) ?? -1;

    while (this.running && this._target?.isValid) {
      if (!this.shouldBreak && !this.options.placeAndBreak) {
        await sleep(50);
        continue;
      }

      if (this.toBreak.length === 0) {
        await sleep(50);
        continue;
      }

      const tasks = [];
      const broken = [];
      let target: Entity | undefined;
      let count = 0;
      while (!!(target = this.toBreak.pop())) {
        tasks.push(this.breakCrystal(target));
        broken.push(target);
        if (!this.options.breaking.hitAll) {
          this.toBreak = this.toBreak.filter((i) => getDmg(i, target!) <= 0);
        }

        if (count++ > this.options.breaking.breaksPerTry) break;
      }

      this.emit("brokeCrystals", broken);
      this.wantsBreak = false;
      this.shouldBreak = false;
      await sleep(this.options.tpsSync.breakDelay);
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

    this.bot.util.move.forceLookAt(placeInfo.lookHere, true);
    this.bot._genericPlace(block!, placeInfo.placeRef, {
      forceLook: "ignore",
      // forceLook: this.options.placement.rotate,
      offhand: this.options.placement.useOffhand,
      swingArm: this.options.placement.useOffhand ? "left" : "right",
    });
    return;
  };

  public breakCrystal = async (info: Entity) => {
    if (!this.target) return "no target";
    if (info.entityType !== this.tracker.endCrystalType) return "not end crystal";
    if (!this.bot.entities[info.id]) return "fuck";

    const npw = performance.now();
    console.log("breaking", info.position, "last time:", npw - time);
    time = npw;
    const naiveHit = info.position.offset(0, 1.95, 0);
    let hitLook = naiveHit;
    let hitId = info.id;
    if (this.options.breaking.raytrace) {
      const test = shouldAttemptAttack(this, this._target!, info);
      if (!test) return;
      hitLook = test.lookHere;
      hitId = test.id;
    }

    if (!hitLook.equals(naiveHit)) console.log("hitting", hitId, "with", hitLook, "instead of", naiveHit);

    for (let i = 0; i < this.options.breaking.triesPerCrystal; i++) {
      if (this.breaksThisTick++ > this.options.breaking.breaksPerTry) return "max tries";

      if (!this.bot.entities[hitId]) {
        console.log("somehow cant hit the entity despite raytacing it.");
        return "entity gone";
      }

      if (this.options.breaking.rotate) this.bot.util.move.forceLookAt(hitLook, true);
      (this.bot as any).attack(
        this.bot.entities[hitId],
        this.options.breaking.swingArm,
        this.options.breaking.useOffhand
      );

      await sleep(this.options.breaking.delayBetweenTries);
      if (!this.bot.entities[hitId]?.isValid) return "success";
    }

    return "ran out of tries?";
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
