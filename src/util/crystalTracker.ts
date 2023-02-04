import { AABB } from "@nxg-org/mineflayer-util-plugin";
import type { Bot } from "mineflayer";
import type { Entity } from "prismarine-entity";
import { Vec3 } from "vec3";
import {EventEmitter} from "events";
import { botEventOnce, clientEventOnce, sleep } from "./constants";
import type {Block} from "prismarine-block";
import StrictEventEmitter from "strict-event-emitter-types/types/src/index";

let time = performance.now();

interface CrystalTrackerEvents {
  serverCrystalDestroyed: (entity: Entity) => void;
  fastCrystalDestroyed: (reason: "explosion" | "sound", position: Vec3) => void;
}


export class CrystalTracker extends (EventEmitter as {new(): StrictEventEmitter<EventEmitter, CrystalTrackerEvents>}) {
  public readonly endCrystalType: number;
  public _attemptedPlacements = new Set<string>();
  public _spawnedEntities = new Map<string, Entity>();
  public _fastModeKills = new Set<string>();

  constructor(private bot: Bot) {
    super();
    this.endCrystalType = Object.values(bot.registry.entitiesByName).find((k) => k.name.includes("_crystal"))!.id;
    this.bot.prependListener("entitySpawn", this.onEntitySpawn);
    this.bot.prependListener("entityGone", this.onEntityDestroy);
    this.bot.prependListener("hardcodedSoundEffectHeard", this.onSound);
    this.bot.prependListener("blockUpdate", this.onBlockUpdate)
    this.bot._client.prependListener("explosion", this.onExplosion);
  }

  public reset() {
    this._attemptedPlacements.clear();
    this._fastModeKills.clear();
    this._spawnedEntities.clear();
  }

  public getAllEntityAABBs(): AABB[] {
    const vec: AABB[] = [];

    // console.log("HI", this._attemptedPlacements, this._attemptedPlacements.keys());
    let positions = this._attemptedPlacements.keys();
    let pos;
    // while (!(pos = positions.next()).done) {
    //   const key = pos.value;
    //   if (this._fastModeKills.has(key)) continue;
    //   const [first, second, third] = key
    //     .slice(1, key.length - 1)
    //     .split(", ")
    //     .map(Number);
    //   const position = new Vec3(first, second, third);
    //   vec.push(
    //     new AABB(position.x - 0.5, position.y + 1, position.z - 0.5, position.x + 1.5, position.y + 3, position.z + 1.5)
    //   );
    // }

    positions = this._spawnedEntities.keys();
    while (!(pos = positions.next()).done) {
      const key = pos.value;
      if (this._fastModeKills.has(key)) continue;
      const { position } = this._spawnedEntities.get(key)!;
      vec.push(
        new AABB(position.x - 0.5, position.y + 1, position.z - 0.5, position.x + 1.5, position.y + 3, position.z + 1.5)
      );
    }

    // for (const key in this._attemptedPlacements) {
    //   console.log("HJEY")
    //   const [first, second, third] = key.slice(2, key.length - 2).split(", ").map(Number)
    //   console.log(first, second, third);
    //   if (this._fastModeKills.has(key)) continue;
    //   const {position} = this._spawnedEntities.get(key)!;
    //   vec.push(new AABB(position.x - 0.5, position.y + 1, position.z - 0.5, position.x + 1.5, position.y + 3, position.z + 1.5))
    // }

    // for (const key of this._spawnedEntities.keys()) {
    //   if (this._fastModeKills.has(key)) continue;
    //   const {position} = this._spawnedEntities.get(key)!;
    //   vec.push(new AABB(position.x - 0.5, position.y + 1, position.z - 0.5, position.x + 1.5, position.y + 3, position.z + 1.5))
    // }

    return vec;
  }

  public addPlacement(pos: Vec3) {
    const posStr = pos.toString();
    this._attemptedPlacements.add(posStr);
    // this.cleanupPos(posStr);
  }

  public canPlace(pos: Vec3) {
    const posStr = pos.toString();
    // if (!(!this._attemptedPlacements.has(posStr) || this._fastModeKills.has(posStr))) {
    //   console.log("CANT PLACE", posStr, this._attemptedPlacements, this._spawnedEntities.keys(), this._fastModeKills);
    // }  

    // return !this._attemptedPlacements.has(posStr) || this._fastModeKills.has(posStr); //|| !this._spawnedEntities.has(posStr);
    return true;
  }

  public isOurCrystal(pos: Vec3) {
    const posStr = pos.offset(-0.5, -1, -0.5).toString();
    // console.log(
    //   "OUR CRYSTAL",
    //   posStr,
    //   this._attemptedPlacements.has(posStr) || this._spawnedEntities.has(posStr) || this._fastModeKills.has(posStr),
    //   this._attemptedPlacements,
    //   this._spawnedEntities.keys(),
    //   this._fastModeKills
    // );
    console.log(posStr, this._attemptedPlacements, this._spawnedEntities.keys(), this._fastModeKills)
    return (
      this._attemptedPlacements.has(posStr) || this._spawnedEntities.has(posStr) || this._fastModeKills.has(posStr)
    );
    // return !this._attemptedPlacements.has(posStr) && this._spawnedEntities.has(posStr);
  }

  protected onBlockUpdate = (oldBlock: Block | null, newBlock: Block) => {
    const posStr = newBlock.position.offset(0, -1, 0).toString();
    if (this._attemptedPlacements.has(posStr) && newBlock.type === this.bot.registry.blocksByName.air.id) {
      // this._attemptedPlacements.delete(posStr);
    }
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
    // console.log(entity.id);
    const posStr = entity.position.offset(-0.5, -1, -0.5).toString();
    const now = performance.now();
    console.log(now - time);
    time = now;

    if (this._attemptedPlacements.has(posStr) || this._spawnedEntities.has(posStr)) {
      this.emit("serverCrystalDestroyed", entity);
      this._attemptedPlacements.delete(posStr)
      this._spawnedEntities.delete(posStr);
    }
 
  };

  protected onExplosion = async (packet: any) => {
    const explodePos = new Vec3(packet.x, packet.y, packet.z);
    const entity = Object.values(this.bot.entities).find((e) => e.position.equals(explodePos));
    if (entity) {
      const posStr = explodePos.translate(-0.5, -1, -0.5).toString();
      if (this._attemptedPlacements.has(posStr) || this._spawnedEntities.has(posStr)) {
        this._attemptedPlacements.delete(posStr);
        this._spawnedEntities.delete(posStr);
        if (!this._fastModeKills.has(posStr)) this.emit("fastCrystalDestroyed", "explosion", explodePos);
        this._fastModeKills.add(posStr);
        await clientEventOnce(this.bot._client, "explosion")
        this._fastModeKills.delete(posStr);
      }
    }
  };

  protected onSound = async (soundId: number, soundCategory: number, pt: Vec3, volume: number, pitch: number) => {
    const entity = this.bot.nearestEntity(
      (e) => e.position.distanceTo(pt) === 0 && e.entityType === this.endCrystalType
    );
    if (entity) {
      const posStr = pt.translate(-0.5, -1, -0.5).toString();
      if (this._attemptedPlacements.has(posStr) || this._spawnedEntities.has(posStr)) {
        this._attemptedPlacements.delete(posStr);
        this._spawnedEntities.delete(posStr);
        if (!this._fastModeKills.has(posStr)) this.emit("fastCrystalDestroyed", "sound", pt);
        this._fastModeKills.add(posStr);
        await botEventOnce(this.bot, "hardcodedSoundEffectHeard") // todo only match to end crystals.
        this._fastModeKills.delete(posStr);
      }
    }
  };

  public waitFor = <K extends keyof CrystalTrackerEvents>(event: K, matches?: (...args: Parameters<CrystalTrackerEvents[K]>) => boolean) => {
    return new Promise((res, rej) => {
      const listener: any = (...args: Parameters<CrystalTrackerEvents[K]>) => {
        console.log("hi")
        if (matches !== undefined) {
          if (!matches(...args)) return;
        }
        this.off(event, listener);
        res(undefined);
      };
      this.on(event, listener);
    });
  }
}
