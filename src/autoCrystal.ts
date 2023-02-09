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
  fastModes: {
    sound: boolean;
    explosion: boolean;
  };
  placement: {
    rotate: boolean;
    stagger: boolean;
    useBackupPositions: boolean;
    raycast: boolean;
    placementPriority: "damage" | "closest" | "farthest" | "none";
    minDamage: number;
    placesPerTick: number;
    placeDistance: number;
    useOffhand: boolean;
  };
  breaking: {
    minDamage: number;
    rotate: boolean;
    useOffhand: boolean;
    breaksPerTick: number;
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

  constructor(public readonly bot: Bot, options: DeepPartial<AutoCrystalOptions> = {}) {
    super();
    this.tracker = new CrystalTracker(bot, options.fastModes);
    this.options = merge({}, DefaultOptions, options as AutoCrystalOptions);
    this.placeableBlocks.add(bot.registry.blocksByName.obsidian.id);
    this.placeableBlocks.add(bot.registry.blocksByName.bedrock.id);
  }

  private onLocalTick = () => {
    if (this.wantsBreak) {
      this.shouldBreak = true;
      this.wantsBreak = false;
    } else if (this.shouldBreak) {
      const start = Math.min(this.options.breaking.breaksPerTick, this.toBreak.length);
      for (let i = start - 1; i >= 0; i--) {
        this.breakCrystal(this.toBreak[i]);
      }
      this.emit("brokeCrystals", this.toBreak);
      this.toBreak = [];
      this.wantsBreak = false;
      this.shouldBreak = false;
    }
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
    this.options.tpsSync.enabled ? null : this.desyncedPlaceThread();
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
    if (entity.entityType === this.tracker.endCrystalType) {
      if (this.options.tpsSync.enabled) await sleep(this.options.tpsSync.breakTicks);
      else await sleep(this.options.tpsSync.breakDelay);
      this.breakCrystal(entity);
      // if (!this._target) return;
      // const posInfo = isPosGood(this, this._target, entity.position.offset(-0.5, -1, -0.5))
      // if (posInfo) this.placeCrystal(posInfo)
    }
  };

  protected desyncedPlaceThread = async () => {
    if (this.options.tpsSync.enabled) return;
    let count = 0;
    while (this.running && this._target?.isValid) {
      const clearNum = this.options.placement.useBackupPositions
        ? Math.ceil(this.options.positionLookup.positionCount / this.options.placement.placesPerTick)
        : 1;

      if (!this.options.positionLookup.async) {
        this.positions = this.getPositions();
      }

      if (this.positions.length === 0) {
        await this.tickForPosUpdate();
        continue;
      }

      if (this.shouldBreak && !this.options.placeAndBreak) {
        console.log("here.");
        await this.waitForCrystalBreak();
      }

      // console.log("place loop", this.positions.length);
      const finalPlacements: [PlaceType[], PlaceType[]] = [[], []];
      let breakLim = this.options.placement.placesPerTick;
      let staggerFlag = false;
      for (let i = 0; i < breakLim && i < this.positions!.length; i++) {
        const p = this.positions[i];
        // console.log(
        //   p.block,
        //   this.tracker.canPlace(p),
        //   staggerFlag,
        //   i,
        //   breakLim,
        //   this.positions!.length,
        //   this.tracker._attemptedPlacements.size
        // );
        if (this.tracker.canPlace(p)) {
          finalPlacements[i % (staggerFlag ? 2 : 1)].push(p);
          if (this.options.placement.stagger) staggerFlag = !staggerFlag;
        } else if (this.options.placement.useBackupPositions) breakLim++;
      }

      finalPlacements[0].map(this.placeCrystal);
      if (this.options.placement.stagger && finalPlacements[1].length > 0) {
        await sleep(50);
        finalPlacements[1].map(this.placeCrystal);
        await sleep(this.options.tpsSync.placeDelay - 50);
      } else {
        await sleep(this.options.tpsSync.placeDelay);
      }

      // rough fix.
      if (count++ % clearNum === 0) this.tracker.clearAttempts();
    }
    if (this.running) this.stop();
  };

  // ========================
  //     crystal logic
  // ========================

  public placeCrystal = async (placeInfo: PlaceType): Promise<void> => {
    if (!(await this.equipCrystal())) return this.stop();
    const block = this.bot.blockAt(placeInfo.block);
    if (!block) return;

    this.bot.util.move.forceLookAt(placeInfo.lookHere, true);
    this.bot._genericPlace(block!, placeInfo.placeRef, {
      forceLook: "ignore",
      // forceLook: this.options.placement.rotate,
      offhand: this.options.placement.useOffhand,
      swingArm: this.options.placement.useOffhand ? "left" : "right",
    });
    this.tracker.addPlacement(placeInfo.block);
    return;
  };

  public breakCrystal = async (info: Entity): Promise<void> => {
    if (!this.target) return;
    if (info.entityType !== this.tracker.endCrystalType) return;
    if (!this.bot.entities[info.id]) return;

    if (!this.shouldBreak && !this.options.placeAndBreak) {
      this.toBreak.push(info);
      this.wantsBreak = true;
      return;
    }

    const naiveHit = info.position.offset(0, 1.95, 0);
    let hitLook: Vec3 | null = naiveHit;
    let hitId: number = info.id;
    if (this.options.breaking.raytrace) {
      const test = shouldAttemptAttack(this, this._target!, info)
      if (!test) return;
      hitLook = test.lookHere;
      hitId = test.id;
    }

    if (hitLook != naiveHit) console.log("hitting", hitId, "with", hitLook, "instead of", naiveHit);
    if (this.options.breaking.rotate) this.bot.util.move.forceLookAt(hitLook, true);
    if (!this.bot.entities[hitId]) {
      console.log("somehow cant hit an entity.");
      return;
    }
    (this.bot as any).attack(
      this.bot.entities[hitId],
      this.options.breaking.swingArm,
      this.options.breaking.useOffhand
    );
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
