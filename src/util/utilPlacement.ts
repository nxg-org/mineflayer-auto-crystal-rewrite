import type { Block } from "prismarine-block";
import type { Entity } from "prismarine-entity";
import type { Bot } from "mineflayer";
import { Vec3 } from "vec3";
import { AABB, AABBUtils, BlockFace, RaycastIterator } from "@nxg-org/mineflayer-util-plugin";
import { CrystalTracker } from "./crystalTracker";
import { AutoCrystalOptions } from "../autoCrystal";
import { blockFaceToVec } from "./randoms";
import { Ctx, EntityRaycastReturn, PlaceType } from "../types";
import { getAABBsFromOption } from "./utilBoth";

export function isPosGood(ctx: Ctx, entity: Entity, blockPos: Vec3): PlaceType | false {
  const eyePos = ctx.bot.entity.position.offset(0, 1.62, 0);
  const playerBBs = Object.values(ctx.bot.entities)
    .filter((e) => e.type === "player")
    .map(AABBUtils.getEntityAABB);

  const crystalBBs = getAABBsFromOption(ctx);

  if (eyePos.distanceTo(blockPos) > ctx.options.placement.placeDistance) return false;
  const { x, y, z } = blockPos;
  const newCrystalBox = new AABB(x - 0.5, y + 1, z - 0.5, x + 1.5, y + 3, z + 1.5); //.expand(0.005, 0, 0.005);
  if (crystalBBs.filter((aabb) => aabb.intersects(newCrystalBox)).length !== 0) return false;
  newCrystalBox.expand(-0.5, 0, -0.5);
  if (playerBBs.filter((aabb) => aabb.intersects(newCrystalBox)).length !== 0) return false;
  if (ctx.bot.blockAt(blockPos.offset(0, 1, 0))?.name !== "air") return false;

  const offset = blockPos.offset(0.5, 1, 0.5);
  const dmg = ctx.bot.getExplosionDamages(entity, offset, 6) ?? -1;

  if (ctx.options.placement.minDamage > 0) {
    if (dmg < ctx.options.placement.minDamage) return false;
  }

  if (ctx.options.placement.raycast) {
    let placeRef = new Vec3(0, 1, 0);
    const checkPts = AABB.fromBlock(blockPos).toVertices().reverse();
    checkPts.unshift(offset);
    for (const rayPos of checkPts) {
      const rayBlock = ctx.bot.world.raycast(
        eyePos,
        rayPos.minus(eyePos).normalize(),
        ctx.options.placement.placeDistance
      );
      if (rayBlock === null) {
        console.log("null")
        continue;
      }
      if (!rayBlock.position.equals(blockPos)) {
        continue;
      }
      placeRef = blockFaceToVec(rayBlock.face);
      return { block: blockPos, lookHere: rayBlock.intersect, placeRef, dmg };
    }
    console.log(blockPos, "failed.");
    return false;
  }

  return { block: blockPos, lookHere: blockPos.offset(0.5, 1, 0.5), placeRef: new Vec3(0, 1, 0), dmg };
}

export function testFindPosition(ctx: Ctx, entity: Entity): PlaceType[] {
  const playerBBs = Object.values(ctx.bot.entities)
    .filter((e) => e.type === "player")
    .map(AABBUtils.getEntityAABB);

  const crystalBBs = getAABBsFromOption(ctx);

  const eyePos = ctx.bot.entity.position.offset(0, 1.62, 0);
  const blockInfoFunc = (pos: Vec3) => {
    if (eyePos.distanceTo(pos) > ctx.options.placement.placeDistance) return false;
    const { x, y, z } = pos;
    const newCrystalBox = new AABB(x - 0.5, y + 1, z - 0.5, x + 1.5, y + 3, z + 1.5); //.expand(0.005, 0, 0.005);
    if (crystalBBs.filter((aabb) => aabb.intersects(newCrystalBox)).length !== 0) return false;
    newCrystalBox.expand(-0.5, 0, -0.5);
    if (playerBBs.filter((aabb) => aabb.intersects(newCrystalBox)).length !== 0) return false;

    return ctx.bot.blockAt(pos.offset(0, 1, 0))?.name === "air";
  };

  const findBlocksNearPoint = entity.position; // .plus(entity.velocity);
  let blocks = ctx.bot.customLookup.findBlocks({
    point: findBlocksNearPoint,
    matching: [ctx.bot.registry.blocksByName.obsidian.id, ctx.bot.registry.blocksByName.bedrock.id],
    maxDistance: ctx.options.placement.placeDistance + 2,
    count: 50,
  });

  const bbs: {[id: string]: AABB} = {};
  Object.values(ctx.bot.entities).filter(e=>e.type==="player" && e.id !== ctx.bot.entity.id).forEach(e=>bbs[e.id] = AABBUtils.getEntityAABB(e))
  const defaultPlaceRef = new Vec3(0, 1, 0);
  const raycastFunc = (loc: Vec3): PlaceType | null => {
    let placeRef = new Vec3(0, 1, 0);
    const checkPts = AABB.fromBlock(loc).toVertices().reverse();
    checkPts.unshift(loc.offset(0.5, 1, 0.5));
    for (const rayPos of checkPts) {
      const rayBlock = ctx.bot.util.raytrace.entityRaytraceRaw(
      // const rayBlock = ctx.bot.world.raycast(
        eyePos,
        rayPos.minus(eyePos).normalize(),
        bbs,
        ctx.options.placement.placeDistance
      );

      if (rayBlock === null) {
        continue;
      }
      if (!rayBlock.position.equals(loc)) {
        continue;
      }
      placeRef = blockFaceToVec(rayBlock.face);
      const dmg = ctx.bot.getExplosionDamages(entity, loc.offset(0.5, 1, 0.5), 6) ?? -1;
      if (dmg < ctx.options.placement.minDamage) return null;
      return { block: loc, lookHere: rayBlock.intersect, placeRef, dmg };
    }
    return null;
  };

  blocks = blocks.filter(blockInfoFunc);

 
  if (ctx.options.placement.raycast) {
    return blocks.map(raycastFunc).filter((bl) => bl !== null) as PlaceType[];
  } else {
    return blocks
      .map((loc) => {
        const dmg = ctx.bot.getExplosionDamages(entity, loc.offset(0.5, 1, 0.5), 6) ?? -1;
        if (dmg < ctx.options.placement.minDamage) return null;
        return { block: loc, lookHere: loc.offset(0.5, 1, 0.5), placeRef: defaultPlaceRef, dmg };
      })
      .filter((bl) => bl !== null) as PlaceType[];
  }
}

/**
 * Logic:
 *  1. Find every possible position for a crystal.
 *  2. Identify top three maximum damage placements.
 *  3. Per each spot identified, load secondary positions based around that crystal SEQUENTIALLY. (Load crystal hitboxes into register.)
 *  4. Compare the total damages of each crystal collection
 *  5. Return highest total damage.
 * @param ctx
 * @param entity
 */
export function predictiveFindPosition(ctx: Ctx, entity: Entity): PlaceType[] {
  if (!entity) return [];
  const predictedAABBs: { [base: string]: AABB[] } = {};

  function isValidPosition(org: Vec3, pos: Vec3) {
    const { x, y, z } = pos;
    const newCrystalBox = new AABB(x - 0.5, y + 1, z - 0.5, x + 1.5, y + 3, z + 1.5);
    if (ctx.options.positionLookup.positionDistanceFromOrigin !== undefined) {
      if (predictedAABBs[org.toString()][0]?.distanceToVec(pos) > ctx.options.positionLookup.positionDistanceFromOrigin)
        return false;
    }
    return predictedAABBs[org.toString()].filter((aabb) => aabb.intersects(newCrystalBox)).length === 0;
  }

  function getSortedRecursive(places: PlaceType[]) {
    return places.map((b) => {
      if (!b) return [];
      const finalBlocks: PlaceType[] = [b];
      const index = b.block.toString();
      predictedAABBs[index] = predictedAABBs[index] ?? [
        AABBUtils.getEntityAABBRaw({ position: b.block.offset(0.5, 1, 0.5), height: 2.0 }),
      ];

      for (let i = 1; i < count && i < places.length; i++) {
        const foundBlock = places.filter((bl) => isValidPosition(b.block, bl.block))[0];
        if (!foundBlock) break;
        const foundAABB = AABBUtils.getEntityAABBRaw({ position: foundBlock.block.offset(0.5, 1, 0.5), height: 2.0 });
        if (!predictedAABBs[index].some((aabb) => aabb.equals(foundAABB))) {
          predictedAABBs[index].push(foundAABB);
          finalBlocks.push(foundBlock);
        }
      }

      delete predictedAABBs[index];
      return finalBlocks;
    });
  }

  let places = testFindPosition(ctx, entity);

  places = places.filter((p) => p.dmg >= ctx.options.placement.minDamage);
  const count = ctx.options.placement.useBackupPositions
    ? ctx.options.positionLookup.positionCount
    : ctx.options.placement.placesPerTry;

  switch (ctx.options.placement.placementPriority) {
    case "closest":
      places.sort((a, b) => a.block.distanceSquared(entity.position) - b.block.distanceSquared(entity.position));
      return getSortedRecursive(places)[0] || [];
    case "farthest":
      places.sort((a, b) => b.block.distanceSquared(entity.position) - a.block.distanceSquared(entity.position));
      return getSortedRecursive(places)[0] || [];
    case "damage":
      places.sort((a, b) => b.dmg - a.dmg);

      const killDmg = entity.health ?? 20;
      for (const info of places) {
        if (info.dmg >= killDmg) {
          return [info];
        }
      }

      const finalFound = getSortedRecursive(places);
      finalFound.sort(
        (a, b) =>
          b
            .slice(0, ctx.options.placement.placesPerTry)
            .map((a) => a.dmg)
            .reduce((a, b) => a + b) -
          a
            .slice(0, ctx.options.placement.placesPerTry)
            .map((a) => a.dmg)
            .reduce((a, b) => a + b)
      );
      return finalFound[0] || [];
    case "none":
      return getSortedRecursive(places)[0] || [];
  }

  return [];
  // const sixth = performance.now();
  // console.log("final sort:", sixth - fourth)

  // console.log("TOTAL:", sixth - first);
  // console.log(finalFound, blocks);
  //   console.log(finalFound[0], count);
}
