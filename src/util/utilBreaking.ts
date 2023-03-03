import type { Bot } from "mineflayer";
import { Vec3 } from "vec3";
import type { Entity } from "prismarine-entity";
import { AutoCrystalOptions } from "../autoCrystal";
import { CrystalTracker } from "./crystalTracker";
import { AABB, AABBUtils } from "@nxg-org/mineflayer-util-plugin";
import { isRaycastEntity } from "./randoms";
import { BreakType, Ctx } from "../types";

export function shouldAttemptAttack(ctx: Ctx, target: Entity, crystal: Entity): BreakType | false {
  if (crystal.entityType !== ctx.tracker.endCrystalType) return false;
  if (!ctx.bot.entities[crystal.id]) return false;

  if (ctx.bot.util.entity.eyeDistanceToEntity(crystal) > ctx.options.breaking.breakDistance + 1) return false;
  let hitLook: Vec3 | null = crystal.position;
  let hitId: number = crystal.id;

  if (ctx.options.breaking.raytrace) {
    hitLook = null;
    const players: { [id: string]: AABB } = {};
    const eyePos = ctx.bot.entity.position.offset(0, ctx.bot.entity.height, 0);
    const aabb = AABBUtils.getEntityAABB(crystal);
    const checkPts = aabb.toVertices();
    checkPts.unshift(crystal.position);

    Object.values(ctx.bot.entities).forEach((e) => {
      if (e.type === "player" && e.id !== ctx.bot.entity.id) players[e.id] = AABBUtils.getEntityAABB(e);
    });

    for (const rayPos of checkPts) {
      const res = ctx.bot.util.raytrace.entityRaytrace(
        eyePos,
        rayPos.minus(eyePos).normalize(),
        ctx.options.breaking.breakDistance + 1,
        (e) => (e.type === "player" && e.id !== ctx.bot.entity.id) || e.entityType === ctx.tracker.endCrystalType
      );
      if (!res) {
        console.log("no entity or block.");
        continue;
      }
      if (isRaycastEntity(res)) {
        if (crystal.id === res.id) {
          const distance = Math.min(aabb.distanceToVec(ctx.bot.entity.position), aabb.distanceToVec(eyePos));
          if (distance > ctx.options.breaking.breakDistance) continue;
          return { lookHere: rayPos, id: res.id };
        } else if (res.entityType === ctx.tracker.endCrystalType) {
          hitLook = rayPos;
          hitId = res.id;
        } else {
          console.log("failed on", rayPos, "for", crystal.id, "got", res.id, res, ctx.tracker.endCrystalType);
          continue;
        }
      }
    }

    if (hitLook === null) {
      console.log("failed."); // cannot hit entity since all raytracing failed.
      return false;
    }
  }

  if (ctx.options.breaking.minDamage > 0) {
    if (ctx.bot.getExplosionDamages(target, crystal.position, 6) ?? -1 < ctx.options.breaking.minDamage) return false;
  }

  return { lookHere: hitLook, id: hitId };
}
