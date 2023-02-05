import type { Block } from "prismarine-block";
import type { Entity } from "prismarine-entity";
import type { Bot, FindBlockOptions } from "mineflayer";
import { Vec3 } from "vec3";
import { AABB } from "@nxg-org/mineflayer-util-plugin";
import { CrystalTracker } from "./crystalTracker";
import { AutoCrystalOptions } from "../autoCrystal";
import { strToVec3 } from "./randoms";

export function getEntityAABB(entity: { position: Vec3; height: number }) {
  const w = entity.height / 2;
  const { x, y, z } = entity.position;
  return new AABB(-w, 0, -w, w, entity.height, w).offset(x, y, z);
}

export function testFindPosition(
  ctx: { bot: Bot; tracker: CrystalTracker; options: { placement: { placeDistance: number; placesPerTick: number } } },
  entity: Entity
): Vec3[] {
  const bot = ctx.bot;
  const crystalBBs: AABB[] = [];
  // const crystalBBs = ctx.tracker.getAllEntityAABBs();
  // const crystalBBs = Object.values(ctx.bot.entities).filter(e => e.entityType === ctx.tracker.endCrystalType).map(e => bot.util.entity.getEntityAABB(e))
  // crystalBBs.push(...ctx.tracker.getAllEntityAABBs())
  const playerBBs = Object.values(ctx.bot.entities)
    .filter((e) => e.type === "player")
    .map((e) => bot.util.entity.getEntityAABB(e));
  // crystalBBs.forEach(e=>e.expand(0.005, 0, 0.005))


  const first = performance.now();
  const blockInfoFunc = (pos: Vec3) => {
    if (bot.entity.position.offset(0, 1.62, 0).distanceTo(pos) > ctx.options.placement.placeDistance) return false;
    const { x, y, z } = pos;
    const newCrystalBox = new AABB(x - 0.5, y + 1, z - 0.5, x + 1.5, y + 3, z + 1.5); //.expand(0.005, 0, 0.005);
    if (crystalBBs.filter((aabb) => aabb.intersects(newCrystalBox)).length !== 0) return false;
    newCrystalBox.expand(-0.5, 0, -0.5);
    if (playerBBs.filter((aabb) => aabb.intersects(newCrystalBox)).length !== 0) return false;
    return bot.blockAt(pos.offset(0, 1, 0))?.name === "air";
  };

  const findBlocksNearPoint = entity.position.floored(); // .plus(entity.velocity);
  // find the crystal
  let blocks = bot.customLookup.findBlocks({
    point: findBlocksNearPoint,
    matching: [ctx.bot.registry.blocksByName.obsidian.id, ctx.bot.registry.blocksByName.bedrock.id],
    maxDistance: 5,
    useExtraInfo: false,
    count: 50,
  });
  // bot.customLookup.clearBlockCache();
  return blocks.filter((b) => blockInfoFunc(b));

  // if (!blocks) return bot.chat("Couldn't find bedrock or obsidian block that has air above it near myself.");
  // blocks = blocks.sort((a, b) => a.distanceTo(findBlocksNearPoint) - b.distanceTo(findBlocksNearPoint));
  return blocks;
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
): Vec3[] {
  const bot = ctx.bot;
  const predictedAABBs: { [base: string]: AABB[] } = {};
  // const crystalBBs: AABB[] =ctx.tracker.getAllEntityAABBs();
  // const playerBBs = Object.values(ctx.bot.entities).filter(e => e.type === "player").map(e => bot.util.entity.getEntityAABB(e));
  // crystalBBs.forEach(e=>e.expand(0.005, 0, 0.005))

   
  // const first = performance.now();

  let blocks = testFindPosition(ctx, entity)
  // console.log("BLOCK!", blocks)
  // let blocks = testFindPosition(ctx, entity);
  // const second = performance.now() ;
  // console.log("getting positions", second - first)

  const isValidPosition = (org: Vec3, pos: Vec3) => {
    // if (pos.xzDistanceTo(bot.entity.position) <= 1) return false;
    // if (pos.xzDistanceTo(entity.position) <= 1) return false;
    if (bot.entity.position.offset(0, 1.62, 0).distanceTo(pos) > ctx.options.placement.placeDistance) return false;
    const { x, y, z } = pos;
    const newCrystalBox = new AABB(x - 0.5, y + 1, z - 0.5, x + 1.5, y + 3, z + 1.5); //.expand(-0.005, 0, -0.005);
    const entityAABBs = predictedAABBs[org.toString()];
    if (entityAABBs.filter((aabb) => aabb.intersects(newCrystalBox)).length !== 0) return false;
    // if (crystalBBs.filter((aabb) => aabb.intersects(newCrystalBox)).length !== 0) return false;
    // newCrystalBox.expand(-0.305, 0, -0.305);
    // if (playerBBs.filter(aabb => aabb.intersects(newCrystalBox)).length !== 0) return false;
    // if (bot.blockAt(pos.offset(0, 1, 0))?.name !== "air") return false;
    return true;
  };

  const sortBlocksByDamage = (positions: Vec3[]) => {
    positions.sort(
      (a, b) =>
        (ctx.bot.getExplosionDamages(entity, b.offset(0.5, 1, 0.5), 6, true) ?? 0) -
        (ctx.bot.getExplosionDamages(entity, a.offset(0.5, 1, 0.5), 6, true) ?? 0)
    );
  };

  const sortBlocksByDistance = (positions: Vec3[]) => {
    positions.sort(
      (a, b) =>
        a.offset(0.5, 1, 0.5).distanceSquared(entity.position) - b.offset(0.5, 1, 0.5).distanceSquared(entity.position)
    );
  };


  // const third = performance.now();
  let blockDmgs = blocks.map((bl) => {
    return { block: bl, dmg: ctx.bot.getExplosionDamages(entity, bl.offset(0.5, 1, 0.5), 6) ?? 0 };
  });
 
  blockDmgs.sort((a, b) => b.dmg - a.dmg);
  blocks = blocks.filter((p) => blockDmgs.find((info) => info.block === p)!.dmg >= ctx.options.placement.minDamage);
  blocks.sort((a, b) => blockDmgs.findIndex(bl => bl.block === a) - blockDmgs.findIndex(bl => bl.block === b))


  // const third = performance.now();
  // console.log("block sorting:", third - second)

  switch (ctx.options.placement.placementPriority) {
    case "damage":
      const killDmg = entity.health ?? 20;
      for (const info of blockDmgs) {
       
        if (info.dmg >= killDmg) {
          // console.log(info, killDmg)
          // console.log("damage, finished early:", third - first);
          return [info.block];
        }
      }
      break;
  }

  let count = ctx.options.placement.useBackupPositions
    ? ctx.options.positionLookup.positionCount
    : ctx.options.placement.placesPerTick;


  // const fourth = performance.now();
  let finalFound = blocks.map((b) => {
    if (!b) return [];
    const finalBlocks: Vec3[] = [b];
    const index = b.toString();
    predictedAABBs[index] = predictedAABBs[index] ?? [getEntityAABB({ position: b.offset(0.5, 1, 0.5), height: 2.0 })];

    //getEntityAABB(bot.entity)

    for (let i = 1; i < count && i < blocks.length; i++) {
      let foundBlocks = blocks.filter((bl) => isValidPosition(b, bl));
      const foundBlock = foundBlocks[0];

      if (foundBlock) {
        const foundAABB = getEntityAABB({ position: foundBlock.offset(0.5, 1, 0.5), height: 2.0 });
        if (!predictedAABBs[index].some((aabb) => aabb.equals(foundAABB))) {
          predictedAABBs[index].push(foundAABB);
          finalBlocks.push(foundBlock);
        }
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

    // const sixth = performance.now();
    // console.log("final sort:", sixth - fourth)

  // console.log("TOTAL:", sixth - first);
    // console.log(finalFound, blocks);
  //   console.log(finalFound[0], count);
  return finalFound[0] || [];
}
