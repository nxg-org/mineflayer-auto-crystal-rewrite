import { EventEmitter } from "events";
import type { Bot } from "mineflayer";
import type { Entity } from "prismarine-entity";
import merge from "ts-deepmerge";
import { Vec3 } from "vec3";
import { CrystalTracker } from "./util/crystalTracker";
import { DeepPartial } from "./types";
import { DefaultOptions, sleep } from "./util/randoms";
import { predictiveFindPosition, testFindPosition } from "./util/getPositions";

export interface AutoCrystalOptions {
  tpsSync:
    | { enabled: false; placeDelay: number; breakDelay: number }
    | { enabled: true; placeTicks: number; breakTicks: number };
  positionLookup: {
    async: boolean;
    positionCount: number;
  };
  fastModes: {
    sound: boolean;
    explosion: boolean;
  };
  placement: {
    stagger: boolean;
    useBackupPositions: boolean;
    placementPriority: "damage" | "none";
    minDamage: number;
    placesPerTick: number;
    placeDistance: number;
    useOffhand: boolean;
  };
  breaking: {
    breaksPerTick: number;
    breakDistance: number;
    useOffHand: boolean;
  };
}

export class AutoCrystal extends EventEmitter {
  public readonly placeableBlocks = new Set<number>();

  public options: AutoCrystalOptions;
  public readonly tracker: CrystalTracker;
  public get target() {
    return this._target;
  }
  private _target?: Entity;
  private positions: Vec3[] | null = null;
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
    this.running = true;
    this.tracker.start();
    this.options.tpsSync.enabled ? null : this.desyncedPlaceThread();
    if (this.options.positionLookup.async) this.asyncPositionThread();
    this.bot.on("entitySpawn", this.onEntitySpawn);
  }

  private tickForPosUpdate = () => {
    if (!this._target) return Promise.resolve();
    let lastPos = this._target.position.clone();
    return new Promise((res, rej) => {
      const botChecker = (e: Entity) => !this._target || (e.id === this._target.id && !e.position.equals(lastPos));
      const botListener = (e: Entity) => {
        if (botChecker(e)) {
          this.bot.off("entityMoved", botListener);
          this.tracker.removeListener("serverCrystalDestroyed", crystalListener);
          res(undefined);
        }
      };

      const crystalListener = (...args: any[]) => {
        this.bot.off("entityMoved", botListener);
        this.tracker.removeListener("serverCrystalDestroyed", crystalListener);
        res(undefined);
      };
      this.bot.on("entityMoved", botListener);
      this.tracker.on("serverCrystalDestroyed", crystalListener);
    });
  };

  protected asyncPositionThread = async () => {
    while (this.running && this._target?.isValid && this.options.positionLookup.async) {
      const time = performance.now();
      this.positions = this.getPositions();
      // console.log(this.positions.map(bl => [bl, this.bot.getExplosionDamages(this._target!, bl.offset(0.5, 1, 0.5), 6)]))
      const now = performance.now();
      const before = now - time;
      if (now - time > 50) await sleep(10);
      else await this.tickForPosUpdate();

      const after = performance.now() - now;
      console.log("search:", before, "wait:", after, "total:", before + after);
    }
  };

  protected getPositions = (): Vec3[] => {
    if (!this._target) return [];
    return predictiveFindPosition(this, this._target);
  };

  protected onEntitySpawn = (entity: Entity) => {
    if (entity.entityType === this.tracker.endCrystalType) {
      this.breakCrystal(entity);
    }
  };

  protected desyncedPlaceThread = async () => {
    if (this.options.tpsSync.enabled) return;

    let count = 0;
    while (this.running && this._target?.isValid) {
      if (!this.options.positionLookup.async) {
        this.positions = this.getPositions();
      }

      if (this.positions === null) {
        await this.tickForPosUpdate();
        continue;
      }

      // console.log("place loop");
      const finalPlacements: [Vec3[], Vec3[]] = [[], []];
      let breakLim = this.options.placement.placesPerTick;
      let staggerFlag = false;
      for (let i = 0; i < breakLim && i < this.positions!.length; i++) {
        const p = this.positions[i];
        // console.log(
        //   p,
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
      if (
        count++ %
          (this.options.placement.useBackupPositions
            ? Math.ceil(this.options.positionLookup.positionCount / this.options.placement.placesPerTick)
            : 1) ===
        0
      )
        this.tracker.clearAttempts();

      //   await sleep(this.options.tpsSync.placeDelay / 2);
      //   finalPlacements[1].map(this.placeCrystal);
      //   await sleep(this.options.tpsSync.placeDelay / 2);
      // } else {
      //   await sleep(this.options.tpsSync.placeDelay);
      // }
    }
    this.running = false;
  };

  // ========================
  //     crystal logic
  // ========================
  public placeCrystal = async (pos: Vec3) => {
    if (!(await this.equipCrystal())) return this.stop();
    const block = this.bot.blockAt(pos);
    // this.bot.util.move.forceLookAt(block!.position, true);
    this.bot._genericPlace(block!, new Vec3(0, 1, 0), {
      forceLook: true,
      offhand: this.options.placement.useOffhand,
      swingArm: this.options.placement.useOffhand ? "left" : "right",
    });
    this.tracker.addPlacement(pos);
    return;
  };

  public breakCrystal = (info: Entity) => {
    this.bot.util.move.forceLookAt(info.position, true);
    (this.bot as any).attack(info);
    return true;
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
