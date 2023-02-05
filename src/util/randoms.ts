import { AutoCrystalOptions } from "../autoCrystal";
import type { Bot, BotEvents } from "mineflayer";
import type { Entity } from "prismarine-entity";
import { Vec3 } from "vec3";
import type {Client} from "minecraft-protocol"


export function strToVec3(posStr: string) {
  const [first, second, third] = posStr
    .slice(1, posStr.length - 1)
    .split(", ")
    .map(Number);
  return new Vec3(first, second, third);
}

export const DefaultOptions: AutoCrystalOptions = {
  tpsSync: {
    enabled: false,
    placeDelay: 50,
    breakDelay: 50,
  },
  positionLookup: {
    async: true,
    positionCount: 1,
  },
  fastModes: {
    sound: true,
    explosion: true,
  },
  placement: {
    stagger: false,
    placementPriority: "damage",
    minDamage: 0,
    placesPerTick: 1,
    placeDistance: 5,
    useBackupPositions: false,
    useOffhand: false,
  },
  breaking: {
    breaksPerTick: 1,
    breakDistance: 5,
    useOffHand: false,
  },
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
  :
  never;

type CustomOverloadedParameters<T extends (...args: any[]) => any> = Parameters<
  CustomOverload<T>
>;

type ClientFuncs = CustomOverloadedParameters<Client["on"]>
type ClientEvents = ClientFuncs[0]
type ClientListeners = ClientFuncs[1]

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
