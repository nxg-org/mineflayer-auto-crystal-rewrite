import { AABB, AABBUtils, BlockFace, RaycastIterator } from "@nxg-org/mineflayer-util-plugin";
import type { Bot, FindBlockOptions } from "mineflayer";
import { Block } from "prismarine-block";
import type { Entity } from "prismarine-entity";
import type { Item, NormalizedEnchant } from "prismarine-item";
import { Vec3 } from "vec3";

const armorPieces = ["head", "torso", "legs", "feet"];

// https://minecraft.fandom.com/wiki/Explosion
// Use bot.world, there's no typing yet.
function calcExposure(playerPos: Vec3, explosionPos: Vec3, world: any /* prismarine-world*/) {
  const dx = 1 / (0.6 * 2 + 1);
  const dy = 1 / (1.8 * 2 + 1);
  const dz = 1 / (0.6 * 2 + 1);

  const d3 = (1 - Math.floor(1 / dx) * dx) / 2;
  const d4 = (1 - Math.floor(1 / dz) * dz) / 2;

  let sampled = 0;
  let exposed = 0;
  const pos = new Vec3(0, 0, 0);
  for (pos.y = playerPos.y; pos.y <= playerPos.y + 1.8; pos.y += 1.8 * dy) {
    for (pos.x = playerPos.x - 0.3 + d3; pos.x <= playerPos.x + 0.3; pos.x += 0.6 * dx) {
      for (pos.z = playerPos.z - 0.3 + d4; pos.z <= playerPos.z + 0.3; pos.z += 0.6 * dz) {
        const dir = pos.minus(explosionPos);
        const range = dir.norm();
        if (world.raycast(explosionPos, dir.normalize(), range) === null) {
          exposed++;
        }
        sampled++;
      }
    }
  }
  return exposed / sampled;
}

function calcExposureAABB(entityBB: AABB, explosionPos: Vec3, world: any /* prismarine-world*/) {
  const xWidth = entityBB.maxX - entityBB.minX;
  const yWidth = entityBB.maxY - entityBB.minY;
  const zWidth = entityBB.maxZ - entityBB.minZ;
  const dx = 1 / (xWidth * 2 + 1);
  const dy = 1 / (yWidth * 2 + 1);
  const dz = 1 / (zWidth * 2 + 1);

  const d3 = (1 - Math.floor(1 / dx) * dx) / 2;
  const d4 = (1 - Math.floor(1 / dz) * dz) / 2;

  let sampled = 0;
  let exposed = 0;
  const pos = new Vec3(0, 0, 0);
  for (pos.y = entityBB.minY; pos.y <= entityBB.maxY; pos.y += yWidth * dy) {
    for (pos.x = entityBB.minX + d3; pos.x <= entityBB.maxX; pos.x += xWidth * dx) {
      for (pos.z = entityBB.minZ + d4; pos.z <= entityBB.maxZ; pos.z += zWidth * dz) {
        const dir = pos.minus(explosionPos);
        const range = dir.norm();
        if (world.raycast(explosionPos, dir.normalize(), range) === null) {
          exposed++;
        }
        sampled++;
      }
    }
  }
  return exposed / sampled;
}

// https://minecraft.fandom.com/wiki/Attribute#Operations
function getAttributeValue(prop: any) {
  let X = prop.value;
  for (const mod of prop.modifiers) {
    if (mod.operation !== 0) continue;
    X += mod.amount;
  }
  let Y = X;
  for (const mod of prop.modifiers) {
    if (mod.operation !== 1) continue;
    Y += X * mod.amount;
  }
  for (const mod of prop.modifiers) {
    if (mod.operation !== 2) continue;
    Y += Y * mod.amount;
  }
  return Y;
}

// https://minecraft.fandom.com/wiki/Armor#Damage_protection
function getDamageAfterAbsorb(damages: number, armorValue: number, toughness: number) {
  // const var3 = 2 + toughness / 4;
  // const var4 = Math.min(Math.max(armorValue - damages / var3, armorValue * 0.2), 20);
  // return damages * (1 - var4 / 25);
  const var1 = armorValue / 5;
  const var2 = armorValue - (4 * damages) / (toughness + 8);
  const var4 = Math.max(var1, var2);
  return damages * (1 - var4 / 25);
}

function getDamageWithEnchantments(damage: number, equipment: Item[]) {
  const enchantments = equipment.some((e) => !!e)
    ? equipment
        .map(
          (armor) =>
            armor?.enchants
              .map((enchant) => {
                switch (enchant?.name) {
                  case "protection":
                    return enchant.lvl;
                  case "blast_protection":
                    return enchant.lvl * 2;
                  default:
                    return 0;
                }
              })
              .reduce((b: number, a: number) => b + a, 0) ?? [0]
        )
        .reduce((b: number, a: number) => b + a, 0)
    : 0;
  return damage * (1 - Math.min(enchantments, 20) / 25);
}

export function customDamageInject(bot: Bot) {
  const effects = bot.registry.effects;
  let resistanceIndex = 11; // constant from 1.7.10 to 1.19.2
  for (const effectId in effects) {
    const effect = effects[effectId];
    if (effect.name.includes("esistance")) {
      resistanceIndex = Number(effectId);
      break;
    }
  }
  const damageMultiplier = bot.registry.version[">="]("1.9") ? 8 : 7; // for 1.12+ 8 for 1.8 TODO check when the change occur (likely 1.9)
  const armorToughnessKey = bot.registry.version[">="]("1.16")
    ? "minecraft:generic.armor_toughness"
    : "generic.armorToughness"; // was renamed in 1.16
  const armorProtectionKey = bot.registry.version[">="]("1.16") ? "minecraft:generic.armor" : "generic.armor"; // was renamed in 1.16

  const difficultyValues = {
    peaceful: 0,
    easy: 1,
    normal: 2,
    hard: 3,
  };

  //There's a mistyping in mineflayer. Effect[] is not accurate. You cannot map over it.
  function getDamageWithEffects(
    damage: number,
    effects: { [id: string]: { id: number; amplifier: number; duration: number } }
  ) {
    const resistanceLevel = effects?.[resistanceIndex]?.amplifier ?? 0;
    return damage * (1 - resistanceLevel / 5);
  }

  //TODO: This apparently breaks on higher versions than 1.12.2. Weird.
  bot.selfExplosionDamages = (sourcePos: Vec3, power: number, rawDamages = false) => {
    const distance = bot.entity.position.distanceTo(sourcePos);
    const radius = 2 * power;
    if (distance >= radius) return 0;
    const exposure = calcExposure(bot.entity.position, sourcePos, bot.world);
    const impact = (1 - distance / radius) * exposure;
    let damages = Math.floor((impact * impact + impact) * damageMultiplier * power + 1);

    // The following modifiers are constant for the input bot.entity and doesnt depend
    // on the source position, so if the goal is to compare between positions they can be
    // ignored to save computations
    if (!rawDamages && bot.entity.attributes[armorProtectionKey]) {
      const armor = getAttributeValue(bot.entity.attributes[armorProtectionKey]);
      const armorToughness = getAttributeValue(bot.entity.attributes[armorToughnessKey]);
      const equipment = armorPieces.map((piece) => bot.inventory.slots[bot.getEquipmentDestSlot(piece)]);

      damages = getDamageAfterAbsorb(damages, armor, armorToughness);
      damages = getDamageWithEnchantments(damages, equipment);
      damages = getDamageWithEffects(damages, bot.entity.effects as any);
      damages *= difficultyValues[bot.game.difficulty] * 0.5;
    } else if (!rawDamages && !bot.entity.attributes[armorProtectionKey]) {
      return null;
    }
    return Math.floor(damages);
  };

  bot.getExplosionDamages = (targetEntity: Entity, sourcePos: Vec3, power: number, rawDamages = false) => {
    const distance = targetEntity.position.distanceTo(sourcePos);
    const radius = 2 * power;
    if (distance >= radius) return 0;

    const exposure = calcExposureAABB(AABBUtils.getEntityAABB(targetEntity), sourcePos, bot.world);
    const impact = (1 - distance / radius) * exposure;
    let damages = Math.floor((impact * impact + impact) * damageMultiplier * power + 1);
    // The following modifiers are constant for the input targetEntity and doesnt depend
    // on the source position, so if the goal is to compare between positions they can be
    // ignored to save computations
    if (!rawDamages && targetEntity.attributes[armorProtectionKey]) {
      const armor = getAttributeValue(targetEntity.attributes[armorProtectionKey]);
      const armorToughness = getAttributeValue(targetEntity.attributes[armorToughnessKey]);
      damages = getDamageAfterAbsorb(damages, armor, armorToughness);
      damages = getDamageWithEnchantments(damages, targetEntity.equipment);
      damages = getDamageWithEffects(damages, targetEntity.effects as any);

      // console.log(targetEntity.username, targetEntity.equipment, damages)
      // const allEnchants = allButCheckingArmor.map(armor => armor.enchants.map(enchantFunc).reduce(add, 0)).reduce(add, 0) + enchantments.map(enchantFunc).reduce(add, 0)
      // TODO: protection enchantment and resistance effects

      if (targetEntity.type === "player") {
        damages *= difficultyValues[bot.game.difficulty] * 0.5;
      }
    } else if (!rawDamages && !targetEntity.attributes[armorProtectionKey]) {
      return null;
    }
    return Math.floor(damages);
  };

  bot.getExplosionDamagesAABB = (targetBB: AABB, sourcePos: Vec3, power: number) => {
    const distance = targetBB.distanceToVec(sourcePos);
    const radius = 2 * power;
    if (distance >= radius) return 0;

    const exposure = calcExposureAABB(targetBB, sourcePos, bot.world);
    const impact = (1 - distance / radius) * exposure;
    return Math.floor((impact * impact + impact) * damageMultiplier * power + 1);
  };
}

export function customAttackImpl(bot: Bot) {
  bot.attack = attack;

  function swingArm(arm = "right", showHand = true) {
    const hand = arm === "right" ? 0 : 1;
    const packet: { hand?: 0 | 1 } = {};
    if (showHand) packet.hand = hand;
    bot._client.write("arm_animation", packet);
  }

  function attack(target: { id: number }, swing = true, offhand = false) {

    // arm animation comes before the use_entity packet on 1.8
    if (bot.supportFeature("armAnimationBeforeUse")) {
      if (swing) {
        swingArm(offhand ? "left" : "right");
      }
      useEntity(target, 1);
    } else {
      useEntity(target, 1);
      if (swing) {
        swingArm(offhand ? "left" : "right");
      }
    }
  }

  function useEntity(target: { id: number }, leftClick: 0 | 1, x?: number, y?: number, z?: number) {
    const sneaking = bot.getControlState("sneak");
    if (x && y && z) {
      bot._client.write("use_entity", {
        target: target.id,
        mouse: leftClick,
        x,
        y,
        z,
        sneaking,
      });
    } else {
      bot._client.write("use_entity", {
        target: target.id,
        mouse: leftClick,
        sneaking,
      });
    }
  }
}

import * as pblock from "prismarine-block";
const { OctahedronIterator } = require("prismarine-world").iterators;
export class CustomLookup {
  public PBlock: typeof Block;

  public visitedColumns = new Map<string, any>();

  constructor(private bot: Bot) {
    this.PBlock = (pblock as any).default(bot.registry);
  }

  public clearBlockCache = () => {
    this.visitedColumns.clear();
  };

  findBlocks = (options: FindBlockOptions & { matching: number[] }) => {
    const matcher = this.getMatchingFunction(options.matching);
    const point = (options.point || this.bot.entity.position).floored();
    const maxDistance = options.maxDistance || 16;
    const count = options.count || 1;
    const useExtraInfo = options.useExtraInfo || false;
    const fullMatcher = this.getFullMatchingFunction(matcher, useExtraInfo);
    const start = new Vec3(Math.floor(point.x / 16), Math.floor(point.y / 16), Math.floor(point.z / 16));
    const it = new OctahedronIterator(start, Math.ceil((maxDistance + 8) / 16));
    // the octahedron iterator can sometime go through the same section again
    // we use a set to keep track of visited sections
    const visitedSections = new Set();

    let blocks = [];
    let startedLayer = 0;
    let next = start;
    let tick = 0;

    while (next) {
      const column = this.bot.world.getColumn(next.x, next.z);
      // const nextColStr = `${next.x},${next.z}`;
      // if (!this.visitedColumns.has(nextColStr))
      //   this.visitedColumns.set(nextColStr, this.bot.world.getColumn(next.x, next.z));
      // const column = this.visitedColumns.get(nextColStr);
      const sectionY = next.y + Math.abs((this.bot.game as any).minY >> 4);
      const totalSections = (this.bot.game as any).height >> 4;
      if (sectionY >= 0 && sectionY < totalSections && column && !visitedSections.has(next.toString())) {
        const section = column.sections[sectionY];
        if (useExtraInfo === true || this.isBlockInSection(section, matcher)) {
          const begin = new Vec3(next.x * 16, sectionY * 16 + (this.bot.game as any).minY, next.z * 16);
          const cursor = begin.clone();
          const end = cursor.offset(16, 16, 16);

          // console.log(begin, point, end, this.between(begin, point, end));
          // if (this.between(begin, point, end)) {
          if (false) {
            let yOff = 0;
            let yNeg = false;
            for (cursor.y = point.y; begin.y <= cursor.y && cursor.y < end.y; ) {
              let xOff = 0;
              let xNeg = false;
              for (cursor.x = point.x; begin.x <= cursor.x && cursor.x < end.x; ) {
                let zOff = 0;
                let zNeg = false;
                for (cursor.z = point.z; begin.z <= cursor.z && cursor.z < end.z; ) {
                  // tick++;
                  // console.log(cursor)
                  if (fullMatcher(cursor) && cursor.distanceTo(point) <= maxDistance) {
                    blocks.push(cursor.clone());
                  }
                  zOff += 1;
                  zNeg = !zNeg;
                  cursor.z += zNeg ? -zOff : zOff;
                }
                xOff += 1;
                xNeg = !xNeg;
                cursor.x += xNeg ? -xOff : xOff;
              }
              yOff += 1;
              yNeg = !yNeg;
              cursor.y += yNeg ? -yOff : yOff;
            }
          } else {
            for (cursor.y = begin.y; cursor.y < end.y; cursor.y++) {
              for (cursor.x = begin.x; cursor.x < end.x; cursor.x++) {
                for (cursor.z = begin.z; cursor.z < end.z; cursor.z++) {
                  // tick++;
                  if (fullMatcher(cursor) && cursor.distanceTo(point) <= maxDistance) {
                    blocks.push(cursor.clone());
                  }
                }
              }
            }
          }

          // for (cursor.y = begin.y; cursor.y < end.y; cursor.y++) {
          //   for (cursor.x = begin.x; cursor.x < end.x; cursor.x++) {
          //     for (cursor.z = begin.z; cursor.z < end.z; cursor.z++) {
          //       tick++;
          //       if (cursor.distanceTo(point) <= maxDistance) {
          //         blocks.push(cursor.clone());
          //       }
          //     }
          //   }
          // }
        }
        visitedSections.add(next.toString());
      }

      // If we started a layer, we have to finish it otherwise we might miss closer blocks
      if (startedLayer !== it.apothem && blocks.length >= count) {
        break;
      }
      startedLayer = it.apothem;
      next = it.next();
    }

    // console.log(tick)
    blocks.sort((a, b) => {
      return a.distanceTo(point) - b.distanceTo(point);
    });
    // We found more blocks than needed, shorten the array to not confuse people
    if (blocks.length > count) {
      blocks = blocks.slice(0, count);
    }
    return blocks;
  };

  getMatchingFunction(matching: any) {
    if (typeof matching !== "function") {
      if (!Array.isArray(matching)) {
        matching = [matching];
      }
      return isMatchingType;
    }
    return matching;

    function isMatchingType(block: any) {
      return block === null ? false : matching.indexOf(block.type) >= 0;
    }
  }

  isBlockInSection(section: any, matcher: any) {
    if (!section) return false; // section is empty, skip it (yay!)
    // If the chunk use a palette we can speed up the search by first
    // checking the palette which usually contains less than 20 ids
    // vs checking the 4096 block of the section. If we don't have a
    // match in the palette, we can skip this section.
    if (section.palette) {
      for (const stateId of section.palette) {
        if (matcher(this.PBlock.fromStateId(stateId, 0))) {
          return true; // the block is in the palette
        }
      }
      return false; // skip
    }
    return true; // global palette, the block might be in there
  }

  getFullMatchingFunction = (matcher: any, useExtraInfo: any) => {
    const nonFullSearchMatcher = (point: any) => {
      const block = this.bot.blockAt(point, true);
      return matcher(block) && useExtraInfo(block);
    };

    const fullSearchMatcher = (point: any) => {
      return matcher(this.bot.blockAt(point, useExtraInfo));
    };

    if (typeof useExtraInfo === "boolean") {
      return fullSearchMatcher;
    }

    return nonFullSearchMatcher;
  };

  private between = (first: Vec3, second: Vec3, third: Vec3) => {
    return (
      first.x <= second.x &&
      second.x <= third.x &&
      first.y <= second.y &&
      second.y <= third.y &&
      first.z <= second.z &&
      second.z <= third.z
    );
  };
}
