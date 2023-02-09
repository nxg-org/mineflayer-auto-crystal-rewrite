import { AABB } from "@nxg-org/mineflayer-util-plugin";
import type { Bot } from "mineflayer";
import type { Entity } from "prismarine-entity";
import { Vec3 } from "vec3";
import { EventEmitter } from "events";
import { botEventOnce, clientEventOnce,  sleep, strToVec3 } from "./randoms";
import type { Block } from "prismarine-block";
import StrictEventEmitter from "strict-event-emitter-types/types/src/index";
import { AutoCrystalOptions } from "../autoCrystal";
import { PlaceType } from "../types";

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
  public _attemptedPlacements = new Set<string>();
  public _spawnedEntities = new Map<string, Entity>();
  public _fastModeKills = new Set<string>();

  constructor(private bot: Bot, public readonly fastModes: Partial<AutoCrystalOptions["fastModes"]> = {}) {
    super();
    this.fastModes = Object.assign({ sound: false, explosion: false }, fastModes);
    this.endCrystalType = Object.values(bot.registry.entitiesByName).find((k) => k.name.includes("_crystal"))!.id;
    let count = 0;
    let time = performance.now();
    this.bot.prependListener("entityGone", (e) => {
      count++;
      const now = performance.now();
      if (now - time > 1000) {
        console.log("Placed", count, "cps");
        time = now;
        count = 0;
      }
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

  public getAllEntityAABBs(): AABB[] {
    const vec: AABB[] = [];
    const positions = this._spawnedEntities.keys();
    let info;
    while (!(info = positions.next()).done) {
      const key = info.value;
      if (this._fastModeKills.has(key)) continue;
      const { position: pos } = this._spawnedEntities.get(key)!;
      vec.push(new AABB(pos.x - 0.5, pos.y + 1, pos.z - 0.5, pos.x + 1.5, pos.y + 3, pos.z + 1.5));
    }

    return vec;
  }

  public addPlacement(pos: Vec3) {
    const posStr = pos.toString();
    this._attemptedPlacements.add(posStr);
  }

  public canPlace(pos: PlaceType) {
    const posStr = pos.block.toString();
    // console.log(this._attemptedPlacements, this._fastModeKills)
    const botPos = this.bot.entity.position.offset(0, 1.62, 0);
    return !this._attemptedPlacements.has(posStr) || this._fastModeKills.has(posStr);
    // return (!this._attemptedPlacements.has(posStr) && !this._spawnedEntities.has(posStr))
    // return !this._spawnedEntities.has(posStr) || this._fastModeKills.has(posStr);
    // return (!this._attemptedPlacements.has(posStr) && !this._spawnedEntities.has(posStr)) || this._fastModeKills.has(posStr);
    return true;
  }

  public shouldBreak(pos: Vec3) {
    return !this._fastModeKills.has(pos.toString());
  }

  public isOurCrystal(pos: Vec3) {
    const posStr = pos.offset(-0.5, -1, -0.5).toString();
    return (
      this._attemptedPlacements.has(posStr) || this._spawnedEntities.has(posStr) || this._fastModeKills.has(posStr)
    );
  }

  protected onEntitySpawn = (entity: Entity) => {
    if (entity.entityType !== this.endCrystalType) return;
    const pos = entity.position.offset(-0.5, -1, -0.5);
    const posStr = pos.toString();
    if (this._attemptedPlacements.has(posStr)) {
      this._attemptedPlacements.delete(posStr);
      this._spawnedEntities.set(posStr, entity);
    }
  };

  protected onEntityDestroy = (entity: Entity) => {
    const posStr = entity.position.offset(-0.5, -1, -0.5).toString();
    if (this._attemptedPlacements.has(posStr)) console.log("not possible.");
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
    if (!this.fastModes.explosion) return;
    const explodePos = new Vec3(packet.x, packet.y, packet.z);
    const explodePosBlock = explodePos.offset(-0.5, -1, -0.5);
    this.checkDmg("explosion", explodePosBlock, explodePos);

    let vals = this._spawnedEntities.keys();
    let pos: IteratorResult<string, undefined>;
    while ((pos = vals.next()).value !== undefined) {
      this.checkDmg("explosion", strToVec3(pos.value), explodePos);
    }
  };

  protected onSound = async (soundId: number, soundCategory: number, pt: Vec3, volume: number, pitch: number) => {
    if (!this.fastModes.sound) return;
    const explodePosBlock = pt.offset(-0.5, -1, -0.5);
    this.checkDmg("sound", explodePosBlock, pt);
    let vals = this._spawnedEntities.keys();
    let pos: IteratorResult<string, undefined>;
    while ((pos = vals.next()).value !== undefined) {
      this.checkDmg("sound", strToVec3(pos.value), pt);
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
      this._attemptedPlacements.delete(posStr);
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
