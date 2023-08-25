import {AutoCrystalOptions, getPlugin} from '../src'
import { createBot } from 'mineflayer'



const hostStr = 'Generel2.aternos.me:12812';
const host = hostStr.split(':')[0]
const port = Number(hostStr.split(':')[1])


const bot = createBot({
    username: 'crystal_test1d',
    host,
    port,
    version: '1.19.4'
});


const opts: AutoCrystalOptions = {
    placeAndBreak: true,
    tpsSync: {
        enabled: false,
        placeSleep: 50,
        breakSleep: 10,
        breakCrystalAge: 0,
        breakWaitTimeout: 10
    },
    breaking: {
        breakDistance: 4,
        immediatelyRemove: false,
        breaksPerTry: 1,
        delayBetweenTries: 25,
        hitAll: false,
        minDamage: 0,
        offhandAttack: false,
        offhandSwing: false,
        predictOnSpawn: false,
        raytrace: true,
        swingArm: true,
        triesPerCrystal: 1
    },
    placement: {
        minDamage: 0,
        placeDistance: 4,
        placementPriority: 'damage',
        placesPerTry: 1,
        predictOnBreak: false,
        predictOnExplosion: false,
        raycast: true,
        skipPosIfCrystalThere: true,
        stagger: false,
        useBackupPositions: false,
        useOffhand: false,
        entityRaycast: false
    },
    rotation: {
        dontRotateIfCrystalAABBHit: true,
        breaking: true,
        lookDotThreshhold: 0.999,
        placement: true

    },
    positionLookup: {
        async: true,
        aabbCheck: 'none',
        // countAABBAfterXms: 10,
        positionCount: 1,
        positionDistanceFromOrigin: 2
    },
    crystalTrackerOptions: {
        careAboutPastPlaceAttempts: true,
        deletePlacementsAfter: 5,
        fastModes: {
            explosion: true,
            sound: true
        }
    }
  
  

}

const crystalAura = getPlugin(opts);

bot.loadPlugin(crystalAura)


bot.on('chat', (user, msg) => {

    const [cmd, ...args] = msg.split(' ')
    const target = bot.nearestEntity(e=>e.username === user)



    switch (cmd) {
        case "start":
            if (!target) return bot.chat(`Cannot find user ${user}`);
            bot.autoCrystal.attack(target)
            break;
        case "stop":
            bot.autoCrystal.stop();
            break;

    }

})


bot.once('spawn', () => {




})