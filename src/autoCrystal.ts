import { EventEmitter } from "events";
import type { Bot } from "mineflayer";
import type { Entity } from "prismarine-entity";
import merge from "ts-deepmerge";
import { Vec3 } from "vec3";
import { CrystalTracker } from "./util/crystalTracker";
import { DeepPartial } from "./types";
import { DefaultOptions, sleep } from "./util/constants";
import { predictiveFindPosition, testFindPosition } from "./util/getPositions";

export interface AutoCrystalOptions {
  tpsSync:
    | { enabled: false; placeDelay: number; breakDelay: number }
    | { enabled: true; placeTicks: number; breakTicks: number };
  positionLookup: {
    async: boolean;
  };
  fastModes: {
    sound: boolean;
    explosion: boolean;
  };
  placement: {
    async: boolean;
    stagger: boolean;
    useBackupPositions: boolean;
    tickDelay: number;
    placementPriority: "damage";
    placesPerTick: number;
    placeDistance: number;
    useOffhand: boolean;
  };
  breaking: {
    async: boolean;
    tickDelay: number;
    breaksPerTick: number;
    breakDistance: number;
  };
}

type CheckedEntity = Entity & { packetHit?: true };

export class AutoCrystal extends EventEmitter {
  public readonly placeableBlocks = new Set<number>();

  public options: AutoCrystalOptions;
  public readonly tracker: CrystalTracker;
  private target?: Entity;
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
    this.target = undefined;
    this.tracker.stop();
    this.bot.off("entitySpawn", this.onEntitySpawn);
  }

  public attack(entity?: Entity) {
    if (this.running) return;
    if (!this.target && !entity) return;
    if (!this.target) this.target = entity;
    this.running = true;
    this.tracker.start();
    this.options.tpsSync.enabled ? null : this.desyncedPlaceThread();
    if (this.options.positionLookup.async) this.asyncPositionThread();
    this.bot.on("entitySpawn", this.onEntitySpawn);
  }

  private tickForPosUpdate = () => {
    if (!this.target) return Promise.resolve();
    let lastPos = this.target.position.clone();
    return new Promise((res, rej) => {
      const botChecker = (e: Entity) => !this.target || (e.id === this.target.id && !e.position.equals(lastPos));
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
    while (this.running && this.target?.isValid && this.options.positionLookup.async) {
      const time = performance.now();
      this.positions = this.getPositions();
      const now = performance.now();
      // const before = now - time;
      if (now - time > 50) await sleep(10);
      else await this.tickForPosUpdate();
      // const after = performance.now() - now;
      // console.log("search:", before, "wait:", after, "total:", before + after);
    }
  };

  protected getPositions = (): Vec3[] => {
    if (!this.target) return [];
    const positions = predictiveFindPosition(this, this.target);
    if (!positions) return [];
    const getDamage = (pos: Vec3) => this.bot.getExplosionDamages(this.target!, pos, 6, false) ?? 0;
    switch (this.options.placement.placementPriority) {
      case "damage":
        const killDmg = this.target!.health ?? 20;
        const killPosition = positions.find((pos) => getDamage(pos.offset(0.5, 1, 0.5)) >= killDmg);
        if (killPosition) return [killPosition];
        positions.sort((a, b) => getDamage(b.offset(0.5, 1, 0.5)) - getDamage(a.offset(0.5, 1, 0.5)));
        return positions;
    }
  };

  protected onEntitySpawn = (entity: CheckedEntity) => {
    if (entity.entityType === this.tracker.endCrystalType) {
      this.breakCrystal(entity);
    }
  };

  protected desyncedPlaceThread = async () => {
    // return false;
    while (this.running && this.target?.isValid) {
      if (!this.options.positionLookup.async) {
        this.positions = this.getPositions();
      }

      if (this.positions === null) {
        await this.tickForPosUpdate();
        continue;
      }

      // console.log("place cycle");
      const finalPlacements: [Vec3[], Vec3[]] = [[], []];
      let breakLim = this.options.placement.placesPerTick;
      let staggerFlag = false;
      for (let i = 0; i < breakLim && i < this.positions!.length; i++) {
        const p = this.positions[i];
        // console.log(p, this.tracker.canPlace(p), this.tracker._attemptedPlacements.size, staggerFlag);
        if (this.tracker.canPlace(p)) {
          finalPlacements[i % (staggerFlag ? 2 : 1)].push(p);
          if (this.options.placement.stagger) staggerFlag = !staggerFlag;
        }
        else if (this.options.placement.useBackupPositions) {
          breakLim++;
        }
      }

      finalPlacements[0].map(this.placeCrystal);
      if (this.options.placement.stagger && finalPlacements[1].length > 0) {
        await sleep(50);
        finalPlacements[1].map(this.placeCrystal);
      }

      // for (const e of Object.values(this.bot.entities).filter((e) => e.entityType === this.tracker.endCrystalType)) {
      //   this.breakCrystal(e);
      // }
      await sleep(50);
    }
    this.running = false;
  };

  // ========================
  //     crystal logic
  // ========================

  public placeCrystal = async (pos: Vec3) => {
    if (!(await this.equipCrystal())) {
      console.log("fuck");
      return this.stop();
    }
    const block = this.bot.blockAt(pos);
    this.bot._genericPlace(block!, new Vec3(0, 1, 0), { forceLook: true, offhand: this.options.placement.useOffhand });
    this.tracker.addPlacement(pos);
    return;
  };

  public breakCrystal = (info: CheckedEntity) => {
    if (info.id < 0 || info.packetHit) return;
    this.bot.util.move.forceLookAt(info.position, true);
    this.bot.attack(info);
    return true;
  };

  public breakCrystalBlock = (info: Vec3) => {
    const entities = Object.values(this.bot.entities).filter((e) =>
      e.position.equals(info.offset(0.5, 1, 0.5))
    ) as CheckedEntity[];
    entities.filter((e) => !e.packetHit).forEach((e) => this.breakCrystal(e));
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

// protected onExplosion = (packet: any) => {
//   const explodePos = new Vec3(packet.x, packet.y, packet.z);

//   // if good placement
//   // this.placeCrystal(explodePos.offset(-0.5, -1, -0.5));
//   if (!this.options.fastMode?.includes("ghost")) return;
//   const entity = Object.values(this.bot.entities).find((e) => e.position.equals(explodePos));
//   if (entity) entity.isValid = false;
// };

// protected onSound = (soundId: number, soundCategory: number, pt: Vec3, volume: number, pitch: number) => {
//   if (!this.options.fastMode?.includes("sound")) return;
//   const entity = this.bot.nearestEntity((e) => e.position.distanceTo(pt) === 0 && e.entityType === this.endCrystalType);
//   if (!entity) return;
//   entity.isValid = false;
// };
