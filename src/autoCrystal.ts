import { EventEmitter } from "events";
import type { Bot } from "mineflayer";
import type { Entity } from "prismarine-entity";
import merge from "ts-deepmerge";
import { Vec3 } from "vec3";
import { DeepPartial } from "./types";
import { botEventOnce, crystalOnBlockFilter, DefaultOptions, sleep } from "./util/constants";
import { EntityController } from "./util/entityController";
import { oldFindPosition, predictivePositioning, testFindPosition } from "./util/getPositions";

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
  private target?: Entity;
  private entityController: EntityController;
  private positions: Vec3[] | null = null;
  private running: boolean = false;

  private endCrystalType: number;

  private perTickAttemptedPlacements: Set<string> = new Set();

  constructor(public readonly bot: Bot, options: DeepPartial<AutoCrystalOptions> = {}) {
    super();
    this.entityController = new EntityController(bot);
    this.options = merge({}, DefaultOptions, options as AutoCrystalOptions);
    this.placeableBlocks.add(bot.registry.blocksByName.obsidian.id);
    this.placeableBlocks.add(bot.registry.blocksByName.bedrock.id);
    this.endCrystalType = Object.values(bot.registry.entitiesByName).find((k) => k.name.includes("_crystal"))!.id;
    console.log(this.endCrystalType);
  }

  public stop() {
    this.running = false;
    this.target = undefined;
    this.bot.off("entitySpawn", this.onEntitySpawn);
    this.bot._client.off("explosion", this.onExplosion);
  }

  public attack(entity?: Entity) {
    if (this.running) return;
    if (!this.target && !entity) return;
    if (!this.target) this.target = entity;
    this.running = true;
    this.options.tpsSync.enabled ? null : this.desyncedAttackThread();
    if (this.options.positionLookup.async) this.asyncPositionThread();
    this.bot.on("entitySpawn", this.onEntitySpawn);
    this.bot._client.on("explosion", this.onExplosion);
    this.bot.on("hardcodedSoundEffectHeard", this.onSound);
  }

  protected asyncPositionThread = async () => {
    while (this.running && this.target?.isValid && this.options.positionLookup.async) {
      this.positions = this.getPositions();
      await sleep(1000000);
      //   await botEventOnce(this.bot, "entityMoved", (e) => e.id === this.target?.id);
    }
  };

  protected getPositions = (): Vec3[] => {
    if (!this.target) return [];
    const positions = oldFindPosition(this, this.target);
    if (!positions) return [];
    const getDamage = (pos: Vec3) => this.bot.getExplosionDamages(this.target!, pos, 6, false) ?? 0;
    switch (this.options.placement.placementPriority) {
      case "damage":
        const killPosition = positions.find((pos) => getDamage(pos.offset(0.5, 1, 0.5)) >= (this.target!.health ?? 20));
        if (killPosition) return [killPosition];
        positions.sort((a, b) => getDamage(b.offset(0.5, 1, 0.5)) - getDamage(a.offset(0.5, 1, 0.5)));
        return positions;
    }
  };

  protected onEntitySpawn = (entity: CheckedEntity) => {
    if (entity.entityType === this.endCrystalType) {
      // if good to break
      this.breakCrystal(entity);
      this.placeCrystal(entity.position.offset(-0.5, -1, -0.5));
    }
  };

  protected onExplosion = (packet: any) => {
    const explodePos = new Vec3(packet.x, packet.y, packet.z);

    // if good placement
    this.placeCrystal(explodePos.floored().translate(0, -1, 0));
    if (!this.options.fastMode?.includes("ghost")) return;
    const entity = Object.values(this.bot.entities).find((e) => e.position.equals(explodePos));
    if (entity) entity.isValid = false;
  };

  protected onSound = (soundId: number, soundCategory: number, pt: Vec3, volume: number, pitch: number) => {
    if (!this.options.fastMode?.includes("sound")) return;
    const entity = this.bot.nearestEntity(
      (e) => e.position.distanceTo(pt) === 0 && e.entityType === this.endCrystalType
    );
    if (!entity) return;
    entity.isValid = false;
    // console.log(soundId, soundCategory, pt);
  };

  protected desyncedAttackThread = async () => {
    return false;
    while (this.running && this.target?.isValid) {
      if (!this.options.positionLookup.async) {
        this.positions = this.getPositions();
      }

      if (this.positions === null) {
        await botEventOnce(this.bot, "entityMoved", (e) => e.id === this.target?.id);
        continue;
      }
    }
    this.running = false;
  };

  // ========================
  //     crystal logic
  // ========================

  public placeCrystal = async (pos: Vec3) => {
    if (!(await this.equipCrystal())) return this.stop();
    const str = pos.toString();
    // if (this.perTickAttemptedPlacements.has(str)) return console.log("already tried!");
    const block = this.bot.blockAt(pos);
    // this.bot.util.move.forceLookAt(block!.position.offset(0, 1, 0));
    this.bot._genericPlace(block!, new Vec3(0, 1, 0), {forceLook: "ignore", offhand: this.options.placement.useOffhand });
    // this.perTickAttemptedPlacements.add(str);
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
