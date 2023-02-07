import type { Block } from "prismarine-block";
import type { Entity } from "prismarine-entity";
import type { Bot } from "mineflayer";
import { Vec3 } from "vec3";
import { AABB } from "@nxg-org/mineflayer-util-plugin";
import { CrystalTracker } from "./crystalTracker";
import { AutoCrystalOptions } from "../autoCrystal";
import { blockFaceToVec, PlaceType } from "./randoms";

export function getEntityAABB(entity: { position: Vec3; height: number }) {
  const w = entity.height / 2;
  const { x, y, z } = entity.position;
  return new AABB(-w, 0, -w, w, entity.height, w).offset(x, y, z);
}

export function testFindPosition(
  ctx: { bot: Bot; tracker: CrystalTracker; options: AutoCrystalOptions },
  entity: Entity
): PlaceType[] {
  let crystalBBs: AABB[];
  switch (ctx.options.positionLookup.aabbCheck) {
    case "all":
      crystalBBs = Object.values(ctx.bot.entities)
        .filter((e) => e.entityType === ctx.tracker.endCrystalType)
        .map((e) => ctx.bot.util.entity.getEntityAABB(e));
      crystalBBs.push(...ctx.tracker.getAllEntityAABBs());
      break;
    case "actual":
      crystalBBs = Object.values(ctx.bot.entities)
        .filter((e) => e.entityType === ctx.tracker.endCrystalType)
        .map((e) => ctx.bot.util.entity.getEntityAABB(e));
      break;
    case "predictive":
      crystalBBs = ctx.tracker.getAllEntityAABBs();
      break;
    case "none":
      crystalBBs = [];
      break;
  }
  const playerBBs = Object.values(ctx.bot.entities)
    .filter((e) => e.type === "player")
    .map((e) => ctx.bot.util.entity.getEntityAABB(e));
  // crystalBBs.forEach(e=>e.expand(0.005, 0, 0.005))

  // const first = performance.now();

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
    maxDistance: 5,
    count: 50,
  });

  const defaultPlaceRef = new Vec3(0, 1, 0);
  const raycastFunc = (loc: Vec3): PlaceType | null => {
    let placeRef = new Vec3(0, 1, 0);
    const checkPts = AABB.fromBlock(loc).toVertices().reverse();
    checkPts.unshift(loc.offset(0.5, 1, 0.5));
    for (const rayPos of checkPts) {
      const rayBlock = ctx.bot.world.raycast(
        eyePos,
        rayPos.minus(eyePos).normalize(),
        ctx.options.placement.placeDistance
      );
      if (rayBlock === null) {
        continue;
      }
      if (!rayBlock.position.equals(loc)) {
        continue;
      }
      placeRef = blockFaceToVec(rayBlock.face);
      return { block: loc, lookHere: rayBlock.intersect, placeRef };
    }
    return null;
  };

  blocks = blocks.filter(blockInfoFunc);
  if (ctx.options.placement.raycast) {
    return blocks.map(raycastFunc).filter((bl) => bl !== null) as PlaceType[];
  } else {
    return blocks.map((loc) => {
      return { block: loc, lookHere: loc.offset(0.5, 1, 0.5), placeRef: defaultPlaceRef };
    });
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
export function predictiveFindPosition(
  ctx: { bot: Bot; tracker: CrystalTracker; options: AutoCrystalOptions },
  entity: Entity
): PlaceType[] {
  const predictedAABBs: { [base: string]: AABB[] } = {};

  // const first = performance.now();

  let blocks = testFindPosition(ctx, entity);
  // console.log("BLOCK!", blocks)
  // let blocks = testFindPosition(ctx, entity);
  // const second = performance.now() ;
  // console.log("getting positions", second - first)

  const isValidPosition = (org: Vec3, pos: Vec3) => {
    const { x, y, z } = pos;
    const newCrystalBox = new AABB(x - 0.5, y + 1, z - 0.5, x + 1.5, y + 3, z + 1.5);
    return predictedAABBs[org.toString()].filter((aabb) => aabb.intersects(newCrystalBox)).length === 0;
  };

  // const third = performance.now();
  let blockDmgs = blocks.map((bl) => {
    return { block: bl, dmg: ctx.bot.getExplosionDamages(entity, bl.block.offset(0.5, 1, 0.5), 6) ?? 0 };
  });

  blocks = blocks.filter((p) => blockDmgs.find((info) => info.block === p)!.dmg >= ctx.options.placement.minDamage);
  blockDmgs.sort((a, b) => b.dmg - a.dmg);
  blocks.sort((a, b) => blockDmgs.findIndex((bl) => bl.block === a) - blockDmgs.findIndex((bl) => bl.block === b));

  // const third = performance.now();
  // console.log("block sorting:", third - second)

  const count = ctx.options.placement.useBackupPositions
    ? ctx.options.positionLookup.positionCount
    : ctx.options.placement.placesPerTick;
  switch (ctx.options.placement.placementPriority) {
    case "closest":
      return blocks.sort((a, b) => a.block.distanceSquared(entity.position) - b.block.distanceSquared(entity.position));
    case "farthest":
      return blocks.sort((a, b) => b.block.distanceSquared(entity.position) - a.block.distanceSquared(entity.position));
    case "damage":
      const killDmg = entity.health ?? 20;
      for (const info of blockDmgs) {
        if (info.dmg >= killDmg) {
          return [info.block];
        }
      }

      // const fourth = performance.now();
      let finalFound = blocks.map((b) => {
        if (!b) return [];
        const finalBlocks: PlaceType[] = [b];
        const index = b.block.toString();
        predictedAABBs[index] = predictedAABBs[index] ?? [
          getEntityAABB({ position: b.block.offset(0.5, 1, 0.5), height: 2.0 }),
        ];

        for (let i = 1; i < count && i < blocks.length; i++) {
          let foundBlocks = blocks.filter((bl) => isValidPosition(b.block, bl.block));
          // console.log(foundBlocks.map((bl) => blockDmgs.find((info) => info.block === bl)!.dmg));
          const foundBlock = foundBlocks[0];

          if (!foundBlock) break;
          const foundAABB = getEntityAABB({ position: foundBlock.block.offset(0.5, 1, 0.5), height: 2.0 });
          if (!predictedAABBs[index].some((aabb) => aabb.equals(foundAABB))) {
            predictedAABBs[index].push(foundAABB);
            finalBlocks.push(foundBlock);
          }
        }

        delete predictedAABBs[index];
        return finalBlocks;
      });

      // const fifth = performance.now();
      // console.log("recursive", fifth - fourth)

      finalFound = finalFound.sort(
        (a, b) =>
          b
            .slice(0, ctx.options.placement.placesPerTick)
            .map((pos) => blockDmgs.find((info) => info.block === pos)!.dmg)
            .reduce((a, b) => a + b) -
          a
            .slice(0, ctx.options.placement.placesPerTick)
            .map((pos) => blockDmgs.find((info) => info.block === pos)!.dmg)
            .reduce((a, b) => a + b)
      );
      return finalFound[0] || [];
    case "none":
      return blocks;
  }

  // const sixth = performance.now();
  // console.log("final sort:", sixth - fourth)

  // console.log("TOTAL:", sixth - first);
  // console.log(finalFound, blocks);
  //   console.log(finalFound[0], count);
}
