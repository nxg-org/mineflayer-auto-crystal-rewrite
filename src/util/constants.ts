import { AutoCrystalOptions } from "../autoCrystal";
import type { Bot, BotEvents } from "mineflayer";
import type { Entity } from "prismarine-entity";
import type { Vec3 } from "vec3";

export const DefaultOptions: AutoCrystalOptions = {
  tpsSync: {
    enabled: false,
    placeDelay: 50,
    breakDelay: 50,
  },
  positionLookup: {
    async: true,
  },
  placement: {
    async: false,
    tickDelay: 0,
    placementPriority: "damage",
    placesPerTick: 2,
    placeDistance: 3,
    useOffhand: false,
  },
  breaking: {
    async: false,
    tickDelay: 0,
    breaksPerTick: 2,
    breakDistance: 3,
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
    emitter.on(event, listener);
  });
}
