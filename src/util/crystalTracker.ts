import { AABB, MathUtils } from "@nxg-org/mineflayer-util-plugin";
import type { Bot } from "mineflayer";
import type { Entity } from "prismarine-entity";
import { Vec3 } from "vec3";
import { EventEmitter } from "events";
import { botEventOnce, clientEventOnce, sleep, strToVec3 } from "./randoms";
import type { Block } from "prismarine-block";
import StrictEventEmitter from "strict-event-emitter-types/types/src/index";
import { AutoCrystalOptions } from "../autoCrystal";
import { DeepPartial, PlaceType } from "../types";
import merge from "ts-deepmerge";

interface CrystalTrackerEvents {
  serverCrystalDestroyed: (entity: Entity) => void;
  fastCrystalDestroyed: (reason: "explosion" | "sound", position: Vec3) => void;
}

function blockPosToCrystalAABB(blockPos: Vec3) {
  return new AABB(
    blockPos.x - 0.5,
    blockPos.y + 1,
    blockPos.z - 0.5,
    blockPos.x + 1.5,
    blockPos.y + 2,
    blockPos.z + 1.5
  );
}

/**
 * This class only fails with attempted placements since our positions are bad.
 * Attempted positions should never actually fail. We attempt a placement EXPECTING a crystal to appear.
 * Under no circumstances should the placement actually fail.
 *
 * Once we fix that check, we can safely assume all placements and TRULY speed up. >:)
 */
export class CrystalTracker extends (EventEmitter as {
  new (): StrictEventEmitter<EventEmitter, CrystalTrackerEvents>;
}) {
  public readonly endCrystalType: number;
  public _attemptedPlacements = new Map<number, Set<string>>();
  public _spawnedEntities = new Map<string, Entity>();
  public _fastModeKills = new Set<string>();

  public currentTick = 0;

  public readonly options: AutoCrystalOptions["crystalTrackerOptions"];

  constructor(private bot: Bot, options: DeepPartial<AutoCrystalOptions["crystalTrackerOptions"]> = {}) {
    super();
    this.options = merge(
      { sound: false, explosion: false, careAboutPastPlacements: false, deletePlacementsBefore: 5 },
      options as AutoCrystalOptions["crystalTrackerOptions"]
    );
    this.endCrystalType = Object.values(bot.registry.entitiesByName).find((k) => k.name.includes("_crystal"))!.id;
    let count = 0;
    let time = performance.now();
    let time1 = performance.now();
    this.bot.prependListener("entityGone", (e) => {
      count++;

      const now = performance.now();
      if (now - time > 1000) {
        console.log("Placed", count, "cps");
        time = now;
        count = 0;
      }
      console.log("entity gone, time since last:", now - time1);
      time1 = now;
    });

    this.bot.on("physicsTick", () => {
      this.deletePlacementsBefore(this.currentTick - this.options.deletePlacementsAfter);
      this.currentTick++;
    });
  }

  public start() {
    this.bot.prependListener("entitySpawn", this.onEntitySpawn);
    this.bot.prependListener("entityGone", this.onEntityDestroy);
    // this.bot.prependListener("entityDead", this.onEntityDestroy);
    // this.bot.prependListener("entityUpdate", this.onEntityDestroy)
    this.bot.prependListener("hardcodedSoundEffectHeard", this.onSound);
    this.bot._client.prependListener("explosion", this.onExplosion);
  }

  public stop() {
    this.bot.off("entitySpawn", this.onEntitySpawn);
    this.bot.off("entityGone", this.onEntityDestroy);
    // this.bot.prependListener("entityDead", this.onEntityDestroy);
    // this.bot.prependListener("entityUpdate", this.onEntityDestroy)
    this.bot.off("hardcodedSoundEffectHeard", this.onSound);
    this.bot._client.off("explosion", this.onExplosion);
    this.reset();
  }

  public reset() {
    this._attemptedPlacements.clear();
    this._fastModeKills.clear();
    this._spawnedEntities.clear();
  }

  public clearAttempts() {
    this._attemptedPlacements.clear();
  }

  public getAllPlacementSize() {
    let count = 0;
    for (const data of this._attemptedPlacements.entries()) {
      count += data[1].size;
    }
    return count;
  }

  public getLatestPlacementTick() {
    let ret;
    for (const [key, val] of this._attemptedPlacements.entries()) {
      if (val.size > 0) ret = key;
    }
    return ret;
  }

  public getAllPlacementsBefore(latestTick: number) {
    let placements = new Set<string>();
    for (const [key, val] of this._attemptedPlacements.entries()) {
      if (key <= latestTick) val.forEach((key) => {placements.add(key)});
    }
    return placements;
  }

  public alreadyPlaced(posStr: string, ticksBack = 5) {
    let iter = this._attemptedPlacements.entries();
    let data: IteratorResult<[number, Set<string>]>;
    while ((data = iter.next()).value !== undefined) {
      if (data.value[1].has(posStr)) {
        return data.value[0];
      }
      if (this.currentTick - ticksBack > data.value[1]) {
        return false;
      }
    }
  }

  public getAllEntityAABBs(): AABB[] {
    const vec: AABB[] = [];
    let positions = this._spawnedEntities.keys();
    let info;
    while (!(info = positions.next()).done) {
      const key = info.value;
      if (this._fastModeKills.has(key)) continue;
      const { position: pos } = this._spawnedEntities.get(key)!;
      vec.push(new AABB(pos.x - 0.5, pos.y + 1, pos.z - 0.5, pos.x + 1.5, pos.y + 3, pos.z + 1.5));
    }

    positions = this.getAllPlacementsBefore(this.currentTick).values();
    while (!(info = positions.next()).done) {
      const key = info.value;
      if (this._fastModeKills.has(key)) continue;
      const pos = strToVec3(info.value);
      vec.push(new AABB(pos.x - 0.5, pos.y + 1, pos.z - 0.5, pos.x + 1.5, pos.y + 3, pos.z + 1.5));
    }

    return vec;
  }

  public addPlacement(pos: Vec3) {
    const posStr = pos.toString();
    if (!this._attemptedPlacements.has(this.currentTick)) {
      this._attemptedPlacements.set(this.currentTick, new Set([posStr]));
    } else {
      this._attemptedPlacements.get(this.currentTick)!.add(posStr);
    }
    this._fastModeKills.delete(posStr);
  }

  private deletePlacementsBefore(tick: number) {
    for (const key of this._attemptedPlacements.keys()) {
      if (key < tick) this._attemptedPlacements.delete(key); // all other placements should be invalidated now.
    }
  }

  public canPlace(pos: PlaceType) {
    const posStr = pos.block.toString();
    return !this.options.careAboutPastPlacements || !this.alreadyPlaced(posStr) || this._fastModeKills.has(posStr);
  }

  public shouldBreak(pos: Vec3) {
    return !this._fastModeKills.has(pos.toString());
  }

  public isOurCrystal(pos: Vec3) {
    const posStr = pos.offset(-0.5, -1, -0.5).toString();
    return this.alreadyPlaced(posStr) || this._spawnedEntities.has(posStr) || this._fastModeKills.has(posStr);
  }

  protected onEntitySpawn = (entity: Entity) => {
    if (entity.entityType !== this.endCrystalType) return;
    const pos = entity.position.offset(-0.5, -1, -0.5);
    const posStr = pos.toString();
    let afterPlace = true;
    for (const [key, places] of Array.from(this._attemptedPlacements.entries()).reverse()) {
  
      if (afterPlace) {
        if (places.has(posStr)) {
          places.delete(posStr);
          this._spawnedEntities.set(posStr, entity);
          afterPlace = false;
        }
      } else {
        // this._attemptedPlacements.delete(key); // all other placements should be invalidated now.
      }
    }
  };

  protected onEntityDestroy = (entity: Entity) => {
    const posStr = entity.position.offset(-0.5, -1, -0.5).toString();
    if (this._spawnedEntities.has(posStr) || this._fastModeKills.has(posStr)) {
      // console.log(posStr, this._spawnedEntities.keys(), this._fastModeKills)
      this.emit("serverCrystalDestroyed", entity);
      // this._attemptedPlacements.delete(posStr);
      this._spawnedEntities.delete(posStr);
      this._fastModeKills.delete(posStr);
    }

    // this._fastModeKills.clear();
  };

  protected onExplosion = async (packet: any) => {
    // console.log("explosion", this._spawnedEntities.keys(), this._attemptedPlacements, this._fastModeKills);
    if (!this.options.fastModes.explosion) return;
    const explodePos = new Vec3(packet.x, packet.y, packet.z);
    const explodePosBlock = explodePos.offset(-0.5, -1, -0.5);
    this.checkDmg("explosion", explodePosBlock, explodePos);

    let vals = this._spawnedEntities.keys();
    let pos: IteratorResult<string, undefined>;
    while ((pos = vals.next()).value !== undefined) {
      this.checkDmg("explosion", strToVec3(pos.value), explodePos);
    }
    vals = this.getAllPlacementsBefore(this.currentTick).values();
    while ((pos = vals.next()).value !== undefined) {
      this.checkDmg("explosion", strToVec3(pos.value), explodePos);
    }
  };

  protected onSound = async (soundId: number, soundCategory: number, pt: Vec3, volume: number, pitch: number) => {
    if (!this.options.fastModes.sound) return;
    const explodePosBlock = pt.offset(-0.5, -1, -0.5);
    this.checkDmg("sound", explodePosBlock, pt);
    let vals = this._spawnedEntities.keys();
    let pos: IteratorResult<string, undefined>;
    while ((pos = vals.next()).value !== undefined) {
      this.checkDmg("sound", strToVec3(pos.value), pt);
    }

    vals = this.getAllPlacementsBefore(this.currentTick).values();
    while ((pos = vals.next()).value !== undefined) {
      this.checkDmg("explosion", strToVec3(pos.value), pt);
    }
  };

  protected checkDmg = (
    reason: Parameters<CrystalTrackerEvents["fastCrystalDestroyed"]>[0],
    bPos: Vec3,
    explodePos: Vec3
  ) => {
    const posStr = bPos.toString();
    if (!this._spawnedEntities.has(posStr)) return;
    if (this.bot.getExplosionDamagesAABB(blockPosToCrystalAABB(bPos), explodePos, 6) > 0) {
      this._spawnedEntities.delete(posStr);
      this._fastModeKills.add(posStr);
      this.emit("fastCrystalDestroyed", reason, bPos.translate(0.5, 1, 0.5));
    }
  };

  public waitFor = <K extends keyof CrystalTrackerEvents>(
    event: K,
    matches?: (...args: Parameters<CrystalTrackerEvents[K]>) => boolean
  ) => {
    return new Promise((res, rej) => {
      const listener: any = (...args: Parameters<CrystalTrackerEvents[K]>) => {
        if (matches !== undefined) {
          if (!matches(...args)) return;
        }
        this.off(event, listener);
        res(undefined);
      };
      this.on(event, listener);
    });
  };
}
