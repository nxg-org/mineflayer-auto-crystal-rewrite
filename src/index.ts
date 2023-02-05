import type { Bot } from "mineflayer";
import type { Block } from "prismarine-block";
import type { Vec3 } from "vec3";
import type {Entity} from "prismarine-entity";
import { AutoCrystal, AutoCrystalOptions } from "./autoCrystal";
import type { DeepPartial, genericPlaceOptions } from "./types";
import customDamageInject, { CustomLookup } from "./util/customImpls";

import utilPlugin, { AABB } from "@nxg-org/mineflayer-util-plugin"

declare module "mineflayer" {
  interface Bot {
    autoCrystal: AutoCrystal;
    customLookup: CustomLookup;
    _genericPlace: (referenceBlock: Block, faceVector: Vec3, options?: Partial<genericPlaceOptions>) => Promise<Vec3>;
    _placeEntityWithOptions: (referenceBlock: Block, faceVector: Vec3, options?: Partial<genericPlaceOptions>) => Promise<Entity>;
    getExplosionDamages: (targetEntity: Entity, position: Vec3, power: number, rawDamages?: boolean) => number | null;
    getExplosionDamagesAABB: (targetBB: AABB, position: Vec3, power: number, rawDamages?: boolean) => number;
    selfExplosionDamages: (sourcePos: Vec3, power: number, rawDamages?: boolean) => number | null;
  }
}

declare module "prismarine-entity" {
    interface Entity {
        attributes: { [index: string]: { value: number; modifiers: any[] } };
        objectData: any
    }
}


export function getPlugin(options: DeepPartial<AutoCrystalOptions> = {}) {
    return (bot: Bot) => {
        if (!bot.hasPlugin(utilPlugin)) bot.loadPlugin(utilPlugin)
        bot.autoCrystal = new AutoCrystal(bot, options);
        bot.customLookup = new CustomLookup(bot);
        bot.loadPlugin(customDamageInject);
       
    }
}


export {AutoCrystalOptions} from "./autoCrystal"