import type { Block } from "prismarine-block";
import type { Entity } from "prismarine-entity";
import type { Bot } from "mineflayer";
import { Vec3 } from "vec3";
import { AABB } from "@nxg-org/mineflayer-util-plugin";
import { CrystalTracker } from "./crystalTracker";

export function getEntityAABB(entity: { position: Vec3; height: number }) {
    const w = entity.height / 2;
    const { x, y, z } = entity.position;
    return new AABB(-w, 0, -w, w, entity.height, w).offset(x, y, z);
}

export function oldFindPosition(ctx: {bot: Bot, options: {placement: {placeDistance: number, placesPerTick: number}}}, entity: Entity): Vec3[] {
    const bot = ctx.bot;
    const entityPosition = entity.position;
    return bot.findBlocks({
        point: entityPosition,
        maxDistance: 5,
        count: 50,
        matching: [ctx.bot.registry.blocksByName.obsidian.id, ctx.bot.registry.blocksByName.bedrock.id],
        //@ts-expect-error
        useExtraInfo: (block: Block) => {
            const isAboveAir = bot.blockAt(block.position.offset(0, 1, 0))?.name === "air" && bot.blockAt(block.position.offset(0, 2, 0))?.name === "air";
            const entityDistances = block.position.xzDistanceTo(entityPosition) <= 90 && block.position.xzDistanceTo(entityPosition) >= 1.3;
            const botDistance = bot.entity.position.distanceTo(block.position) <= ctx.options.placement.placeDistance;
            return isAboveAir && entityDistances && botDistance;
        },
    });
}

// useExtraInfo: (block: Block) => {
//     const isAboveAir =
//         bot.blockAt(block.position.offset(0, 1, 0))?.name === "air" && bot.blockAt(block.position.offset(0, 2, 0))?.name === "air";
//     // const entityDistances =
//     //     block.position.xzDistanceTo(entity_position) <= 90 && block.position.xzDistanceTo(entity_position) >= 1.3;
//     const botDistance = bot.entity.position.distanceTo(block.position) <= ctx.placeDistance;
//     // const { x: aboveX, y: aboveY, z: aboveZ } = block.position.offset(0, 1, 0);
//     const {x: playerX, y: playerY, z: playerZ} = entity.position
//     const blockBoundingBox = new AABB(-0.4, 0, -0.4, 0.4, entity.height, 0.4).offset(playerX, playerY, playerZ)
//     const entityAABBs = (Object.values(bot.entities) as Entity[])
//     .filter((e) => e.name?.includes("_crystal"))
//     .map((et: Entity) => {
//         // taken from taken from https://github.com/PrismarineJS/prismarine-physics/blob/d145e54a4bb8604300258badd7563f59f2101922/index.js#L92
//         const w = et.height / 3;
//         const { x, y, z } = et.position;
//         return new AABB(-w, 0, -w, w, et.height, w).offset(x, y, z);
//     });
//     const hasNoIntersectingEntities = entityAABBs.filter((aabb) => aabb.intersects(blockBoundingBox)).length === 0;
//     // const entityClear =
//     return isAboveAir && botDistance && hasNoIntersectingEntities;
// },

export function testFindPosition(ctx: {bot: Bot, tracker: CrystalTracker, options: {placement: {placeDistance: number, placesPerTick: number}}}, entity: Entity): Vec3[] {
    const bot = ctx.bot;
    const crystalBBs: AABB[] = ctx.tracker.getAllEntityAABBs();
    // crystalBBs.push(...Object.values(ctx.bot.entities).filter(e => e.entityType === ctx.tracker.endCrystalType).map(e => bot.util.entity.getEntityAABB(e).expand(0.005, 0, 0.005)))
    const playerBBs = Object.values(ctx.bot.entities).filter(e => e.type === "player").map(e => bot.util.entity.getEntityAABB(e));
    crystalBBs.forEach(e=>e.expand(0.005, 0, 0.005))
    const blockInfoFunc = (pos: Vec3) => {
        if (pos.xzDistanceTo(bot.entity.position) <= 1) return false;
        if (bot.entity.position.offset(0, 1.62, 0).distanceTo(pos) > ctx.options.placement.placeDistance) return false;
        const {x, y, z} = pos;
        const newCrystalBox = new AABB(x -0.5, y + 1, z -0.5, x + 1.5, y + 3, z + 1.5).expand(0.005, 0, 0.005);

        if (crystalBBs.filter((aabb) => aabb.intersects(newCrystalBox)).length !== 0) return false;
        newCrystalBox.expand(-0.305, 0, -0.305);
        if (playerBBs.filter(aabb => aabb.intersects(newCrystalBox)).length !== 0) return false;
        return bot.blockAt(pos.offset(0, 1, 0))?.name === "air";
    };

    const findBlocksNearPoint = entity.position // .plus(entity.velocity);
    // find the crystal
    let blocks = bot.findBlocks({
        point: findBlocksNearPoint,
        matching: [ctx.bot.registry.blocksByName.obsidian.id, ctx.bot.registry.blocksByName.bedrock.id],
        maxDistance: 5,
        count: 30,
    });

    return blocks.filter(b => blockInfoFunc(b))
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
export function predictiveFindPosition(ctx: {bot: Bot, tracker: CrystalTracker, options: {placement: {placeDistance: number, placesPerTick: number}}}, entity: Entity): Vec3[] {
    const bot = ctx.bot;
    const predictedAABBs: { [base: string]: AABB[] } = {};

    const crystalBBs: AABB[] = ctx.tracker.getAllEntityAABBs();
    // crystalBBs.push(...Object.values(ctx.bot.entities).filter(e => e.entityType === ctx.tracker.endCrystalType).map(e => bot.util.entity.getEntityAABB(e).expand(0.005, 0, 0.005)))
    const playerBBs = Object.values(ctx.bot.entities).filter(e => e.type === "player").map(e => bot.util.entity.getEntityAABB(e));
    crystalBBs.forEach(e=>e.expand(0.005, 0, 0.005))
    let blocks = testFindPosition(ctx, entity);

    const isValidPosition = (org: Vec3, pos: Vec3) => {
        if (pos.xzDistanceTo(bot.entity.position) <= 1) return false;
        if (pos.xzDistanceTo(entity.position) <= 1) return false;
        if (bot.entity.position.offset(0, 1.62, 0).distanceTo(pos) > ctx.options.placement.placeDistance) return false;
        const {x, y, z} = pos;
        const newCrystalBox = new AABB(x -0.5, y + 1, z -0.5, x + 1.5, y + 3, z + 1.5).expand(0.005, 0, 0.005);
        const entityAABBs = predictedAABBs[org.toString()];
        if (entityAABBs.filter((aabb) => aabb.intersects(newCrystalBox)).length !== 0) return false;
        if (crystalBBs.filter((aabb) => aabb.intersects(newCrystalBox)).length !== 0) return false;
        newCrystalBox.expand(-0.305, 0, -0.305);
        if (playerBBs.filter(aabb => aabb.intersects(newCrystalBox)).length !== 0) return false;
        if (bot.blockAt(pos.offset(0, 1, 0))?.name !== "air") return false;
        return true
    };

    function sortBlocksByDamage(positions: Vec3[]) {
        return positions.sort(
            (a, b) =>
                (ctx.bot.getExplosionDamages(entity, b.offset(0.5, 1, 0.5), 6, true) ?? 0) -
                (ctx.bot.getExplosionDamages(entity, a.offset(0.5, 1, 0.5), 6, true) ?? 0)
        );
    }

    blocks = sortBlocksByDamage(blocks);

    let finalFound = blocks.slice(0, 5).map((b) => {
        if (!b) return [];
        const finalBlocks: Vec3[] = [b];
        const index = b.toString();
        predictedAABBs[index] = predictedAABBs[index] ?? [
            getEntityAABB({ position: b.offset(0.5, 1, 0.5), height: 2.01 }),
        ];

        //getEntityAABB(bot.entity)
        for (let i = 1; i < ctx.options.placement.placesPerTick && i < blocks.length; i++) {
            let foundBlocks = blocks.filter((bl) => isValidPosition(b, bl));
            foundBlocks = sortBlocksByDamage(foundBlocks);
            const foundBlock = foundBlocks[0];

            if (foundBlock) {
                const foundAABB = getEntityAABB({ position: foundBlock.offset(0.5, 1, 0.5), height: 2.01 });
                if (!predictedAABBs[index].some((aabb) => aabb.equals(foundAABB))) {
                    predictedAABBs[index].push(foundAABB);
                    finalBlocks.push(foundBlock);
                }
            }
        }
     
        delete predictedAABBs[index];
        return finalBlocks;
    });

    finalFound = finalFound.sort(
        (a, b) =>
            b.map((pos) => ctx.bot.getExplosionDamages(entity, pos.offset(0.5, 1, 0.5), 6, true) ?? 0).reduce((a, b) => a + b) -
            a.map((pos) => ctx.bot.getExplosionDamages(entity, pos.offset(0.5, 1, 0.5), 6, true) ?? 0).reduce((a, b) => a + b)
    );

    // console.log(finalFound[0], ctx.placementsPerTick);
    return finalFound[0];
}
