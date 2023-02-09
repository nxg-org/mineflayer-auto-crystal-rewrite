import type { Bot } from "mineflayer";
import { Vec3 } from "vec3";
import type { Entity } from "prismarine-entity";
import { AutoCrystalOptions } from "../autoCrystal";
import { CrystalTracker } from "./crystalTracker";
import { AABB, AABBUtils } from "@nxg-org/mineflayer-util-plugin";
import { isRaycastEntity } from "./randoms";
import { Ctx } from "../types";

export function shouldAttemptAttack(ctx: Ctx, target: Entity, crystal: Entity): { lookHere: Vec3; id: number } | false {
  if (crystal.entityType !== ctx.tracker.endCrystalType) return false;
  if (!ctx.bot.entities[crystal.id]) return false;
  
  const naiveHit = crystal.position.offset(0, 1.95, 0);
  let hitLook: Vec3 | null = naiveHit;
  let hitId: number = crystal.id;
  
  if (ctx.options.breaking.raytrace) {
    hitLook = null;
    const players: { [id: string]: AABB } = {};
    const eyePos = ctx.bot.entity.position.offset(0, ctx.bot.entity.height, 0);
    const checkPts = AABBUtils.getEntityAABB(crystal).expand(-0.05, -0.05, -0.05).toVertices().reverse();
    checkPts.unshift(naiveHit);

    Object.values(ctx.bot.entities).forEach((e) => {
      if (e.type === "player" && e.id !== ctx.bot.entity.id) players[e.id] = AABBUtils.getEntityAABB(e);
    });

    for (const rayPos of checkPts) {
      const res = ctx.bot.util.raytrace.entityRaytrace(
        eyePos,
        rayPos.minus(eyePos).normalize(),
        // players,
        ctx.options.breaking.breakDistance
      );
      if (!res) {
        console.log("no entity or block.")
        continue;
      }
      if (isRaycastEntity(res)) {
        if (crystal.id === res.id) {
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
