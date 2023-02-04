import { EventEmitter } from "events";
import type { Bot } from "mineflayer";
import type { Entity } from "prismarine-entity";
import merge from "ts-deepmerge";
import { Vec3 } from "vec3";
import { CrystalTracker } from "./util/crystalTracker";
import { DeepPartial } from "./types";
import { botEventOnce, crystalOnBlockFilter, DefaultOptions, sleep } from "./util/constants";
import { EntityController } from "./util/entityController";
import { oldFindPosition, predictiveFindPosition, testFindPosition } from "./util/getPositions";

export interface AutoCrystalOptions {
  tpsSync:
    | { enabled: false; placeDelay: number; breakDelay: number }
    | { enabled: true; placeTicks: number; breakTicks: number };
  positionLookup: {
    async: boolean;
  };
  fastMode?: "ghost" | "sound" | "ghostsound";
  placement:
    | {
        async: false;
        tickDelay: number;
        placementPriority: "damage";
        placesPerTick: number;
        placeDistance: number;
        useOffhand: boolean;
      }
    | {
        async: true;
        tickDelay: number;
        placementPriority: "damage";
        placesPerTick: number;
        placeDistance: number;
        updateDelay: number;
        useOffhand: boolean;
      };
  breaking: {
    async: boolean;
    tickDelay: number;
    breaksPerTick: number;
    breakDistance: number;
  };
}


type CheckedEntity = Entity & {packetHit?: true}

export class AutoCrystal extends EventEmitter {
  public readonly placeableBlocks = new Set<number>();

  public options: AutoCrystalOptions;
  public readonly tracker: CrystalTracker;
  private target?: Entity;
  private positions: Vec3[] | null = null;
  private running: boolean = false;

  constructor(public readonly bot: Bot, options: DeepPartial<AutoCrystalOptions> = {}) {
    super();
    this.tracker = new CrystalTracker(bot);
    this.options = merge({}, DefaultOptions, options as AutoCrystalOptions);
    this.placeableBlocks.add(bot.registry.blocksByName.obsidian.id);
    this.placeableBlocks.add(bot.registry.blocksByName.bedrock.id);
  }

  public stop() {
    this.running = false;
    this.target = undefined;
    this.tracker.reset();
    // this.bot.off("entitySpawn", this.onEntitySpawn);
    // this.bot._client.off("explosion", this.onExplosion);
  }

  public attack(entity?: Entity) {
    if (this.running) return;
    if (!this.target && !entity) return;
    if (!this.target) this.target = entity;
    this.running = true;
    this.options.tpsSync.enabled ? null : this.desyncedAttackThread();
    if (this.options.positionLookup.async) this.asyncPositionThread();
    // this.bot.on("entitySpawn", this.onEntitySpawn);
    // this.bot._client.on("explosion", this.onExplosion);
    // this.bot.on("hardcodedSoundEffectHeard", this.onSound);
  }

  protected asyncPositionThread = async () => {
   
    while (this.running && this.target?.isValid && this.options.positionLookup.async) {
      this.positions = this.getPositions();
      await new Promise((res, rej) => {
        const botChecker = (e: Entity) => e.id === this.target!.id //&& e.position.equals(lastPos)
        const botListener = (e: Entity) => {
          if (botChecker(e)) {
            this.bot.off("entityMoved", botListener)
            this.tracker.removeListener("fastCrystalDestroyed", crystalListener);
            res(undefined);
          }
        }

        const crystalListener = (...args: any[]) => {
          this.bot.off("entityMoved", botListener)
          this.tracker.removeListener("fastCrystalDestroyed", crystalListener);
          res(undefined);
        }
        this.bot.on("entityMoved", botListener);
        this.tracker.on("fastCrystalDestroyed", crystalListener);
      })
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
      // if good to break
      if (this.tracker.isOurCrystal(entity.position)) {
        // this.breakCrystal(entity);
      } else {
        console.log("CANNOT BREAK ENTITY")
      }
    }
  };

  protected desyncedAttackThread = async () => {
    // return false;
    while (this.running && this.target?.isValid) {
      if (!this.options.positionLookup.async) {
        this.positions = this.getPositions();
      }

      if (this.positions === null) {
        await botEventOnce(this.bot, "entityMoved", (e) => e.id === this.target?.id);
        continue;
      }


   
      let breakLim = this.options.placement.placesPerTick
      for (let i = 0; i < breakLim && i < this.positions!.length; i++) {
        const pos = this.positions![i];
        if (!this.tracker.canPlace(pos)) {
            if (this.positions!.length < breakLim) {
              break;
            }
            breakLim++
            continue;
        }

        this.placeCrystal(pos);
      };

      for (const e of Object.values(this.bot.entities).filter(e => e.entityType === this.tracker.endCrystalType)) {
        this.breakCrystal(e);
      }
      await sleep(50);
    //  await this.tracker.waitFor("fastCrystalDestroyed")
    }
    this.running = false;
  };

  // ========================
  //     crystal logic
  // ========================

  public placeCrystal = async (pos: Vec3) => {
    if (!(await this.equipCrystal())) {
      console.log("fuck")
      return this.stop();
    }
    const block = this.bot.blockAt(pos);
    this.bot.util.move.forceLookAt(block!.position.offset(0, 1, 0));
    this.bot._genericPlace(block!, new Vec3(0, 1, 0), {forceLook: "ignore", offhand: this.options.placement.useOffhand });
    this.tracker.addPlacement(pos);
    return;
  };

  public breakCrystal = (info: CheckedEntity) => {
    if (info.id < 0 || info.packetHit) return;
    // this.bot.util.move.forceLookAt(info.position);
    this.bot.attack(info);
    if (this.options.fastMode?.includes("ghost")) info.isValid = false;
    return true;
  }

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