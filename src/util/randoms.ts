
import { AutoCrystalOptions } from "../autoCrystal";
import type { Bot, BotEvents } from "mineflayer";
import type { Entity } from "prismarine-entity";
import { Vec3 } from "vec3";
import type { Client } from "minecraft-protocol";
import { BlockFace } from "@nxg-org/mineflayer-util-plugin";
import { EntityRaycastReturn } from "../types";

export function strToVec3(posStr: string) {
  const [first, second, third] = posStr
    .slice(1, posStr.length - 1)
    .split(", ")
    .map(Number);
  return new Vec3(first, second, third);
}

export function blockFaceToVec(face: BlockFace) {
  switch (face) {
    case BlockFace.UNKNOWN: // default to top
    case BlockFace.TOP:
      return new Vec3(0, 1, 0);
    case BlockFace.BOTTOM:
      return new Vec3(0, -1, 0);
    case BlockFace.NORTH:
      return new Vec3(0, 0, -1);
    case BlockFace.SOUTH:
      return new Vec3(0, 0, 1);
    case BlockFace.EAST:
      return new Vec3(1, 0, 0);
    case BlockFace.WEST:
      return new Vec3(-1, 0, 0)
  }
}

export const DefaultOptions: AutoCrystalOptions = {
  placeAndBreak: false,
  tpsSync: {
    enabled: false,
    placeSleep: 50,
    breakSleep: 50,
    breakWaitTimeout: 50,
    breakCrystalAge: 50,
  },
  positionLookup: {
    async: true,
    positionCount: 2,
    aabbCheck: "none",
  },
  crystalTrackerOptions: {
    fastModes: {
      sound: true,
      explosion: true,
    },
    careAboutPastPlaceAttempts: true,
    deletePlacementsAfter: 2,
  },
  placement: {
    skipPosIfCrystalThere: true,
    predictOnBreak: false,
    predictOnExplosion: false,
    stagger: true,
    staggerDelay: 50,
    raycast: true,
    entityRaycast: false,
    placementPriority: "damage",
    minDamage: 0,
    placesPerTry: 1,
    placeDistance: 5,
    useBackupPositions: false,
    useOffhand: false,
  },
  breaking: {
    predictOnSpawn: false,
    immediatelyRemove: false,
    hitAll: false,
    minDamage: 0,
    breaksPerTry: 1,
    breakDistance: 5,
    triesPerCrystal: 2,
    delayBetweenTries: 25,
    raytrace: false,
    swingArm: true,
    offhandSwing: false,
    offhandAttack: false,
  },
  rotation: {
    placement: true,
    breaking: true,
    lookDotThreshhold: 1.01,
    dontRotateIfCrystalAABBHit: false
  }
} as const;

export const sleep = (ms: number) => new Promise((res, rej) => setTimeout(res, ms));

export const crystalOnBlockFilter = (pos: Vec3) => (entity: Entity) =>
  entity.position.offset(-0.5, -1, -0.5).equals(pos);

export function botEventOnce<K extends keyof BotEvents>(
  emitter: Bot,
  event: K,
  matches?: (...args: Parameters<BotEvents[K]>) => boolean
) {
  return new Promise((res, rej) => {
    const listener: any = (...args: Parameters<BotEvents[K]>) => {
      if (matches !== undefined) {
        if (!matches(...args)) return;
      }
      emitter.off(event, listener);
      res(undefined);
    };
    emitter.prependListener(event, listener);
  });
}

/**
 * Note: this removes the string and raw-string implementations of emit from minecraft-protocol's client.
 */
type CustomOverload<T extends (...args: any[]) => any> = T extends {
  (...args: infer A1): infer R1;
  (...args: infer A2): infer R2;
  (...args: infer A3): infer R3;
  (...args: infer A4): infer R4;
  (...args: infer A5): infer R5;
  (...args: infer A6): infer R6;
  (...args: infer A7): infer R7;
  (...args: infer A8): infer R8;
  (...args: infer A9): infer R9;
  (...args: infer A10): infer R10;
  (...args: infer A11): infer R11;
}
  ?
      | ((...args: A1) => R1)
      | ((...args: A2) => R2)
      | ((...args: A3) => R3)
      | ((...args: A4) => R4)
      | ((...args: A5) => R5)
      | ((...args: A6) => R6)
      | ((...args: A7) => R7)
      | ((...args: A8) => R8)
      | ((...args: A10) => R10)
      | ((...args: A11) => R11)
  : never;

type CustomOverloadedParameters<T extends (...args: any[]) => any> = Parameters<CustomOverload<T>>;

type ClientFuncs = CustomOverloadedParameters<Client["on"]>;
type ClientEvents = ClientFuncs[0];
type ClientListeners = ClientFuncs[1];

export function clientEventOnce<K extends ClientEvents>(
  emitter: Client,
  event: K,
  matches?: (...args: Parameters<ClientListeners>) => boolean
) {
  return new Promise((res, rej) => {
    const listener: any = (...args: Parameters<ClientListeners>) => {
      if (matches !== undefined) {
        if (!matches(...args)) return;
      }
      emitter.off(event, listener);
      res(undefined);
    };
    emitter.prependListener(event, listener);
  });
}



export function isRaycastEntity(raycast: EntityRaycastReturn): raycast is Entity & { intersect: Vec3; face: BlockFace } {
  return !!(raycast as any).entityType;
}


export function getIterableKeys<K, V>(map: Iterable<readonly [K, V]>): Iterable<K> {
  return {
      [Symbol.iterator]: function* () {
          for (const [key, _] of map) {
              yield key;
          }
      }
  };
}

export function getIterableValues<K, V>(map: Iterable<readonly [K, V]>): Iterable<V> {
  return {
      [Symbol.iterator]: function* () {
          for (const [_, value] of map) {
              yield value;
          }
      }
  };
}

export function getViewDirection (pitch: number, yaw: number) {
  const csPitch = Math.cos(pitch)
  const snPitch = Math.sin(pitch)
  const csYaw = Math.cos(yaw)
  const snYaw = Math.sin(yaw)
  return new Vec3(-snYaw * csPitch, snPitch, -csYaw * csPitch)
}