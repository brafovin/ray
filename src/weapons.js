// Weapon catalogue. Every entry is data only - the firing logic lives in
// ship.js, the flight logic in projectiles.js.

export const GRAVITY = 38; // tuned so shell range matches the arena scale

export const WEAPONS = {
  gun130: {
    name: '2x130 mm Zwillingsturm', short: 'AK-130', kind: 'shell', icon: '◈',
    damage: 300, splash: 26, splashDamage: 110,
    speed: 300, cooldown: 2.6, salvo: 3, salvoDelay: 0.16, spread: 0.007,
    mag: 9, reload: 5.5, range: 1750, turret: true,
  },
  gun127: {
    name: '127 mm Schnellfeuerkanone', short: 'Mk-45', kind: 'shell', icon: '◈',
    damage: 190, splash: 20, splashDamage: 70,
    speed: 330, cooldown: 1.0, salvo: 1, salvoDelay: 0, spread: 0.006,
    mag: 12, reload: 4.0, range: 1650, turret: true,
  },
  autocannon: {
    name: '76 mm Autokanone', short: 'OTO-76', kind: 'shell', icon: '◈',
    damage: 70, splash: 12, splashDamage: 28,
    speed: 380, cooldown: 0.28, salvo: 1, salvoDelay: 0, spread: 0.011,
    mag: 30, reload: 3.5, range: 1400, turret: true,
  },
  railgun: {
    name: 'Elektromagnetische Railgun', short: 'RAILGUN', kind: 'rail', icon: '⌁',
    damage: 620, splash: 14, splashDamage: 80, pierce: true,
    speed: 1500, cooldown: 3.4, salvo: 1, salvoDelay: 0, spread: 0.0012,
    mag: 4, reload: 6.0, range: 2600, turret: true,
  },
  deckgun: {
    name: '100 mm Deckgeschütz', short: 'DECK', kind: 'shell', icon: '◈',
    damage: 110, splash: 14, splashDamage: 40,
    speed: 340, cooldown: 1.3, salvo: 1, salvoDelay: 0, spread: 0.009,
    mag: 8, reload: 4.5, range: 1300, turret: true, surfaceOnly: true,
  },
  cruiseMissile: {
    name: 'Kalibr Marschflugkörper', short: 'CRUISE', kind: 'missile', icon: '➶',
    damage: 340, splash: 34, splashDamage: 150,
    speed: 210, accel: 90, turnRate: 1.5, cruiseHeight: 42, lifetime: 22,
    cooldown: 0.5, salvo: 4, salvoDelay: 0.5, spread: 0.05,
    mag: 4, reload: 12.0, range: 2400, needsLock: true,
  },
  guidedMissile: {
    name: 'Präzisions-Lenkflugkörper', short: 'GUIDED', kind: 'missile', icon: '➶',
    damage: 260, splash: 26, splashDamage: 110,
    speed: 260, accel: 130, turnRate: 2.4, cruiseHeight: 30, lifetime: 18,
    cooldown: 0.4, salvo: 3, salvoDelay: 0.35, spread: 0.03,
    mag: 3, reload: 9.5, range: 2200, needsLock: true,
  },
  missileSalvo: {
    name: 'VLS-Schwarmsalve', short: 'VLS', kind: 'missile', icon: '➶',
    damage: 140, splash: 22, splashDamage: 65,
    speed: 230, accel: 110, turnRate: 2.9, cruiseHeight: 55, lifetime: 20,
    cooldown: 0.28, salvo: 8, salvoDelay: 0.22, spread: 0.09,
    mag: 8, reload: 13.0, range: 2300, needsLock: true,
  },
  samBattery: {
    name: 'Sea-Sparrow Batterie', short: 'SAM', kind: 'missile', icon: '➶',
    damage: 130, splash: 18, splashDamage: 55,
    speed: 300, accel: 150, turnRate: 3.4, cruiseHeight: 60, lifetime: 14,
    cooldown: 0.3, salvo: 4, salvoDelay: 0.25, spread: 0.06,
    mag: 4, reload: 10.0, range: 1900, needsLock: true,
  },
  torpedo: {
    name: 'Doppel-Torpedorohr', short: 'TORPEDO', kind: 'torpedo', icon: '⌖',
    damage: 480, splash: 30, splashDamage: 170,
    speed: 42, turnRate: 0.5, lifetime: 40,
    cooldown: 0.6, salvo: 2, salvoDelay: 0.6, spread: 0.05,
    mag: 2, reload: 16.0, range: 1500,
  },
  heavyTorpedo: {
    name: '650 mm Schwerer Torpedo', short: 'HEAVY TORP', kind: 'torpedo', icon: '⌖',
    damage: 620, splash: 38, splashDamage: 200,
    speed: 48, turnRate: 0.7, lifetime: 45,
    cooldown: 0.8, salvo: 3, salvoDelay: 0.8, spread: 0.04,
    mag: 3, reload: 18.0, range: 1800,
  },
  ciws: {
    name: 'CIWS Nahbereichsverteidigung', short: 'CIWS', kind: 'flak', icon: '✳',
    damage: 5, splash: 0, splashDamage: 0,
    speed: 620, cooldown: 0.06, salvo: 1, salvoDelay: 0, spread: 0.02,
    mag: 90, reload: 4.4, range: 620, turret: true, intercepts: true,
  },
  ciwsHeavy: {
    name: 'Phalanx-Batterie', short: 'PHALANX', kind: 'flak', icon: '✳',
    damage: 7, splash: 0, splashDamage: 0,
    speed: 640, cooldown: 0.05, salvo: 2, salvoDelay: 0.02, spread: 0.025,
    mag: 140, reload: 4.0, range: 760, turret: true, intercepts: true,
  },
  airstrike: {
    name: 'Kampfdrohnen-Staffel', short: 'AIRSTRIKE', kind: 'drone', icon: '✈',
    damage: 210, splash: 30, splashDamage: 120,
    speed: 145, accel: 60, turnRate: 1.1, cruiseHeight: 95, lifetime: 34,
    cooldown: 0.9, salvo: 4, salvoDelay: 0.9, spread: 0.04,
    mag: 4, reload: 20.0, range: 2600, needsLock: true,
  },
};

export function weaponRuntime(id) {
  const def = WEAPONS[id];
  return {
    id,
    def,
    ammo: def.mag,
    cooldown: 0,
    reloading: 0,
    queue: 0,      // rounds left in the current salvo
    queueTimer: 0,
    aim: null,
  };
}
