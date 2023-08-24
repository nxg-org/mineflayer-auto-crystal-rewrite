import {AutoCrystalOptions, getPlugin} from '../src'
import { createBot } from 'mineflayer'



const hostStr = 'Generel2.aternos.me:12812';
const host = hostStr.split(':')[0]
const port = Number(hostStr.split(':')[1])


const bot = createBot({
    username: 'crystal_test',
    host,
    port,
    version: '1.19.4'
});


const opts: AutoCrystalOptions = {
    placeAndBreak: true,
    tpsSync: {
        enabled: false,
        placeSleep: 50,
        breakSleep: 50,
        breakCrystalAge: 0,
        breakWaitTimeout: 100
    },
    breaking: {
        breakDistance: 4.5,
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
        raycast: false,
        skipPosIfCrystalThere: true,
        stagger: false,
        useBackupPositions: false,
        useOffhand: false,
        // entityRaycast: true
    },
    rotation: {
        dontRotateIfCrystalAABBHit: true,
        breaking: true,
        lookDotThreshhold: 0.999,
        placement: true

    },
    positionLookup: {
        async: true,
        aabbCheck: 'current_nohit',
        countAABBAfterXms: 10,
        positionCount: 2,
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