import { Bot } from "mineflayer";
import prismarine_entity, {Entity} from "prismarine-entity";
import * as conv from "./conversions";
import { Vec3 } from "vec3";
import { randomUUID } from "crypto";

const defaultVelocity = new Vec3(0, 0, 0);


export class EntityController {
    private entitiesArray;
    private entities;
    private EntityBuilder: typeof Entity;
    constructor(public bot: Bot) {
        this.entities = this.bot.registry.entities;
        this.entitiesArray = this.bot.registry.entitiesArray;
        this.EntityBuilder = (prismarine_entity as any)(bot.version)
    }

    setEntityData(entity: Entity, type: number, entityData: any) {
        if (entityData === undefined) {
            entityData = this.entitiesArray.find((entity) => entity.internalId === type);
        }
        if (entityData) {
            entity.mobType = entityData.displayName;
            entity.objectType = entityData.displayName;
            entity.displayName = entityData.displayName;
            entity.entityType = entityData.id;
            entity.name = entityData.name;
            entity.kind = entityData.category;
            entity.height = entityData.height;
            entity.width = entityData.width;
        } else {
            // unknown entity
            entity.type = "other";
            entity.entityType = type;
            entity.mobType = "unknown";
            entity.displayName = "unknown";
            entity.name = "unknown";
            entity.kind = "unknown";
        }
    }

    generateEntity(
        id: number,
        type: number,
        position: Vec3,
        pitch: number = 0,
        yaw: number = 0,
        velocity: Vec3 = defaultVelocity,
        objectData: any = 0
    ) {
        const packet = {
            entityId: id,
            objectUUID: randomUUID(),
            type,
            x: position.x,
            y: position.y,
            z: position.z,
            pitch,
            yaw,
            objectData,
            velocityX: velocity.x,
            velocityY: velocity.y,
            velocityZ: velocity.z,
        };
        return this.spawnEntity(packet);
    }

    fetchEntity(id: number) {
        return this.bot.entities[id] || (this.bot.entities[id] = new this.EntityBuilder(id));
    }

    checkForEntity(id: number): boolean {
        return !!this.bot.entities[id];
    }

    spawnEntity(packet: any): Entity {
        // spawn object/vehicle
        if (this.checkForEntity(packet.entityId)) return this.fetchEntity(packet.entityId);

        const entity = this.fetchEntity(packet.entityId);
        const entityData = this.entities[packet.type];

        entity.type = "object";
        this.setEntityData(entity, packet.type, entityData);

        if (this.bot.supportFeature("fixedPointPosition")) {
            entity.position.set(packet.x / 32, packet.y / 32, packet.z / 32);
        } else if (this.bot.supportFeature("doublePosition")) {
            entity.position.set(packet.x, packet.y, packet.z);
        }

    
        entity.uuid = packet.objectUUID;
        entity.yaw = conv.fromNotchianYawByte(packet.yaw);
        entity.pitch = conv.fromNotchianPitchByte(packet.pitch);
        entity.objectData = packet.objectData;
        // this.bot.emit("entitySpawn", entity);
        return entity;
    }

    // destroyEntities(...entityIds: number[]) {
    //     // destroy entity
    //     for (const id of entityIds) {
    //         if (!this.checkForEntity(id)) continue;
    //         const entity = this.fetchEntity(id);
    //         this.bot.emit('entityGone', entity)
    //         entity.isValid = false;
    //         delete this.bot.entities[id];
         
    //     }
    // }

    invalidateEntities(...entityIds: number[]) {
        entityIds.forEach((id) => {
            const entity = this.fetchEntity(id);
            entity.isValid = false;
        });
    }

    updateEntityAttributes(packet: { entityId: any; properties: any }) {
        const entity = this.fetchEntity(packet.entityId);
        if (!entity.attributes) entity.attributes = {};
        for (const prop of packet.properties) {
            entity.attributes[prop.key] = {
                value: prop.value,
                modifiers: prop.modifiers,
            };
        }
        this.bot.emit("entityAttributes", entity);
    }
}
