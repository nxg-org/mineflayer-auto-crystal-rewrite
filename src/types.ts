import type { Block } from "prismarine-block";
import type { Entity } from "prismarine-entity";
import type { Vec3 } from "vec3";
import type { BlockFace } from "@nxg-org/mineflayer-util-plugin";
import { Bot } from "mineflayer";
import { CrystalTracker } from "./util/crystalTracker";
import { AutoCrystal, AutoCrystalOptions } from "./autoCrystal";

export type genericPlaceOptions = {
  half?: "top" | "bottom";
  delta?: import("vec3").Vec3;
  forceLook?: boolean | "ignore";
  offhand?: boolean;
  swingArm?: "right" | "left";
  showHand?: boolean;
};

export type DeepPartial<T> = T extends object
  ? {
      [P in keyof T]?: DeepPartial<T[P]>;
    }
  : T;

export type EntityRaycastReturn = (Block | Entity) & { intersect: Vec3; face: BlockFace };

export type PlaceType = { block: Vec3; lookHere: Vec3; placeRef: Vec3; dmg: number };

// export type Ctx = { bot: Bot; placer: CrystalTracker; options: AutoCrystalOptions };
export type Ctx = AutoCrystal;
