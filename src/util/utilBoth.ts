import { AABB, AABBUtils } from "@nxg-org/mineflayer-util-plugin";
import { Ctx } from "../types";

export function getAABBsFromOption(ctx: Ctx) {
    let crystalBBs: AABB[];
    switch (ctx.options.positionLookup.aabbCheck) {
      case "all":
        crystalBBs = Object.values(ctx.bot.entities)
          .filter((e) => e.entityType === ctx.placer.endCrystalType)
          .map(AABBUtils.getEntityAABB);
        crystalBBs.push(...ctx.placer.getAllEntityAABBs());
        break;
      case "actual":
        crystalBBs = Object.values(ctx.bot.entities)
          .filter((e) => e.entityType === ctx.placer.endCrystalType)
          .map(AABBUtils.getEntityAABB);
        break;
      case "predictive":
        crystalBBs = ctx.placer.getAllEntityAABBs();
        break;
      case "none":
        crystalBBs = [];
        break;
    }
  
    return crystalBBs;
  }