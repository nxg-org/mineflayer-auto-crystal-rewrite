import { EventEmitter } from "events";
import type { Bot } from "mineflayer";
import type { Entity } from "prismarine-entity";
import merge from "ts-deepmerge";
import { Vec3 } from "vec3";
import { CrystalTracker } from "./util/crystalTracker";
import { DeepPartial } from "./types";
import { blockFaceToVec, DefaultOptions, PlaceType, sleep } from "./util/randoms";
import { isPosGood, predictiveFindPosition, testFindPosition } from "./util/getPositions";

export interface AutoCrystalOptions {
  tpsSync:
    | { enabled: false; placeDelay: number; breakDelay: number }
    | { enabled: true; placeTicks: number; breakTicks: number };
  positionLookup: {
    async: boolean;
    positionCount: number;

    aabbCheck: "predictive" | "actual" | "none" | "all";
    onlyHighest: boolean;
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
    rotate: boolean;
    breaksPerTick: number;
    breakDistance: number;
    raytrace: boolean;
  } & ({ swingArm: false } | { swingArm: true; offhand: boolean });
}

export class AutoCrystal extends EventEmitter {
  public readonly placeableBlocks = new Set<number>();

  public options: AutoCrystalOptions;
  public readonly tracker: CrystalTracker;
  public get target() {
    return this._target;
  }
  private _target?: Entity;
  private positions: PlaceType[] | null = null;
  private calcedPositions: boolean = false;
  private running: boolean = false;

  constructor(public readonly bot: Bot, options: DeepPartial<AutoCrystalOptions> = {}) {
    super();
    this.tracker = new CrystalTracker(bot, options.fastModes);
    this.options = merge({}, DefaultOptions, options as AutoCrystalOptions);
    this.placeableBlocks.add(bot.registry.blocksByName.obsidian.id);
    this.placeableBlocks.add(bot.registry.blocksByName.bedrock.id);
  }

  public stop() {
    this.running = false;
    this._target = undefined;
    this.tracker.stop();
    this.bot.off("entitySpawn", this.onEntitySpawn);
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
      if (this.options.tpsSync.enabled) await sleep(0); // todo
      // todo
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

      if (this.positions === null || this.positions.length === 0) {
        await this.tickForPosUpdate();
        continue;
      }

      console.log("place loop", this.positions.length);
      const finalPlacements: [PlaceType[], PlaceType[]] = [[], []];
      let breakLim = this.options.placement.placesPerTick;
      let staggerFlag = false;
      for (let i = 0; i < breakLim && i < this.positions!.length; i++) {
        const p = this.positions[i];
        console.log(
          p.block,
          this.tracker.canPlace(p),
          staggerFlag,
          i,
          breakLim,
          this.positions!.length,
          this.tracker._attemptedPlacements.size
        );
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

  public placeCrystal = async (placeInfo: PlaceType) => {
    if (!(await this.equipCrystal())) return this.stop();
    const block = this.bot.blockAt(placeInfo.block);
    if (!block) return;

    this.bot._genericPlace(block!, placeInfo.placeRef, {
      forceLook: this.options.placement.rotate,
      offhand: this.options.placement.useOffhand,
      swingArm: this.options.placement.useOffhand ? "left" : "right",
    });
    this.tracker.addPlacement(placeInfo.block);
    return;
  };

  public breakCrystal = (info: Entity) => {
    if (info.entityType !== this.tracker.endCrystalType) return;
    const naiveHit = info.position.offset(0, 2, 0);
    let hitLook: Vec3 | null = naiveHit;
    let hitId: number = info.id;
    if (this.options.breaking.raytrace) {
      const eyePos = this.bot.entity.position.offset(0, this.bot.entity.height, 0);
      const rayPos = naiveHit;
      hitLook = null;
      const res = this.bot.entityRaytrace(
        eyePos,
        rayPos.minus(eyePos).normalize(),
        this.options.breaking.breakDistance,
        (e) => e.entityType === this.tracker.endCrystalType // ignore players.
      );
      if (!res) return console.log("no entity.");

      if (info.id === res.id) {
        hitLook = res.intersection;
      }

      // technically unnecessary check since only hit will be crystals.
      else if (res.entityType === this.tracker.endCrystalType) {
        hitLook = rayPos;
        hitId = res.id;
        console.log("new entity to hit ig", info.id, res.id, res.entityType);
      }

      if (hitLook === null) return console.log("failed."); // cannot hit entity since all raytracing failed.
    }

    if (this.options.breaking.rotate) this.bot.lookAt(hitLook, true);
    (this.bot as any).attack(info, this.options.breaking.swingArm); // todo add off-hand functionality.
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
