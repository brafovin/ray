import * as THREE from 'three';
import { TAU } from './math.js';

// Procedural warship meshes. Local space: +Z is the bow, +X starboard, +Y up,
// y = 0 is the waterline.

const mat = (color, opts = {}) =>
  new THREE.MeshStandardMaterial({
    color,
    roughness: opts.roughness ?? 0.72,
    metalness: opts.metalness ?? 0.22,
    flatShading: opts.flat ?? true,
    emissive: opts.emissive ?? 0x000000,
    emissiveIntensity: opts.emissiveIntensity ?? 1,
  });

/** Box whose top face is scaled in - the standard naval deckhouse shape. */
function taperedBox(w, h, d, topX = 0.82, topZ = 0.88) {
  const geo = new THREE.BoxGeometry(w, h, d);
  const p = geo.attributes.position;
  for (let i = 0; i < p.count; i++) {
    if (p.getY(i) > 0) {
      p.setX(i, p.getX(i) * topX);
      p.setZ(i, p.getZ(i) * topZ);
    }
  }
  geo.translate(0, h / 2, 0);
  geo.computeVertexNormals();
  return geo;
}

/** Lofted hull: waterline outline extruded down to the keel, then narrowed. */
function buildHull(hull, colors) {
  const { length: L, beam: B, draft, deck } = hull;
  const half = B / 2;
  const pts = [];
  const bowSharp = hull.type === 'corvette' || hull.type === 'stealth' ? 0.72 : 0.6;
  const sternFull = hull.type === 'carrier' ? 1.0 : 0.86;

  const width = (t) => {
    if (t > 0.42) return Math.pow(Math.max(0, 1 - (t - 0.42) / 0.58), bowSharp);
    if (t < -0.78) return sternFull * (1 - (Math.abs(t) - 0.78) * 1.4);
    return 1;
  };

  const N = 30;
  for (let i = 0; i <= N; i++) {
    const t = -1 + (2 * i) / N;
    pts.push(new THREE.Vector2(half * width(t) + 0.001, (t * L) / 2));
  }
  for (let i = N; i >= 0; i--) {
    const t = -1 + (2 * i) / N;
    pts.push(new THREE.Vector2(-half * width(t) - 0.001, (t * L) / 2));
  }

  const shape = new THREE.Shape(pts);
  const depth = draft + deck;
  const geo = new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: false, steps: 1 });
  geo.rotateX(Math.PI / 2);
  geo.translate(0, depth - draft, 0);

  // Pull the keel in, and for stealth hulls slope the sides inward (tumblehome).
  const p = geo.attributes.position;
  const topY = deck - 0.001;
  for (let i = 0; i < p.count; i++) {
    const y = p.getY(i);
    if (y < -draft + 0.01) {
      p.setX(i, p.getX(i) * (hull.type === 'submarine' ? 0.85 : 0.5));
      p.setZ(i, p.getZ(i) * 0.985);
    } else if (hull.type === 'stealth' && y > topY) {
      p.setX(i, p.getX(i) * 0.74);
    }
  }
  geo.computeVertexNormals();

  const hullMesh = new THREE.Mesh(geo, mat(colors.hull, { metalness: 0.3 }));

  const group = new THREE.Group();
  group.add(hullMesh);

  // Deck plate + boot-topping stripe at the waterline.
  const deckPlate = new THREE.Mesh(
    new THREE.ExtrudeGeometry(shape, { depth: 0.35, bevelEnabled: false, steps: 1 }),
    mat(colors.deck, { roughness: 0.9, metalness: 0.05 })
  );
  deckPlate.geometry.rotateX(Math.PI / 2);
  deckPlate.geometry.translate(0, deck + 0.36, 0);
  deckPlate.scale.set(hull.type === 'stealth' ? 0.74 : 0.94, 1, 0.985);
  group.add(deckPlate);

  // Boot-topping: the dark band at the waterline that makes a hull read as a hull.
  const stripe = new THREE.Mesh(
    new THREE.ExtrudeGeometry(shape, { depth: 0.9, bevelEnabled: false, steps: 1 }),
    mat(0x2a1714, { roughness: 0.9, metalness: 0.05 })
  );
  stripe.geometry.rotateX(Math.PI / 2);
  stripe.geometry.translate(0, 0.55, 0);
  stripe.scale.set(1.012, 1, 1.002);
  group.add(stripe);

  return group;
}

function radarDish(scale = 1) {
  const g = new THREE.Group();
  const post = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, 1.1, 6), mat(0x2a2f34));
  post.position.y = 0.55;
  g.add(post);
  const dish = new THREE.Mesh(new THREE.BoxGeometry(3.2, 0.9, 0.22), mat(0xd7dbdd, { metalness: 0.4 }));
  dish.position.y = 1.15;
  g.add(dish);
  g.scale.setScalar(scale);
  g.userData.spin = 1.6;
  return g;
}

function mast(height, colors, radars) {
  const g = new THREE.Group();
  const core = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.55, height, 6), mat(colors.trim));
  core.position.y = height / 2;
  g.add(core);
  for (let i = 0; i < 2; i++) {
    const arm = new THREE.Mesh(new THREE.BoxGeometry(3.6 - i, 0.16, 0.5), mat(colors.trim));
    arm.position.y = height * (0.55 + i * 0.22);
    g.add(arm);
  }
  const panel = new THREE.Mesh(new THREE.BoxGeometry(1.6, 2.0, 0.25), mat(0x8d959b, { metalness: 0.5 }));
  panel.position.set(0, height * 0.4, 0.5);
  panel.rotation.x = -0.12;
  g.add(panel);
  const r = radarDish(0.9);
  r.position.y = height;
  g.add(r);
  radars.push(r);
  return g;
}

function funnel(w, h, colors) {
  const g = new THREE.Group();
  const body = new THREE.Mesh(taperedBox(w, h, w * 1.25, 0.78, 0.8), mat(colors.trim));
  g.add(body);
  const cap = new THREE.Mesh(new THREE.BoxGeometry(w * 0.8, 0.3, w * 1.0), mat(0x14171a));
  cap.position.y = h;
  g.add(cap);
  return g;
}

/** Rotating gun turret with barrels; returns the aiming pivots. */
function buildTurret(colors, scale, opts = {}) {
  const s = scale;
  const root = new THREE.Group();
  const barbette = new THREE.Mesh(new THREE.CylinderGeometry(1.7 * s, 1.9 * s, 0.8 * s, 12), mat(colors.trim));
  barbette.position.y = 0.4 * s;
  root.add(barbette);

  const yaw = new THREE.Group();
  yaw.position.y = 0.8 * s;
  root.add(yaw);

  const house = new THREE.Mesh(
    taperedBox(3.0 * s, 1.7 * s, 3.9 * s, 0.72, 0.62),
    mat(colors.deck, { metalness: 0.35 })
  );
  yaw.add(house);

  const pitch = new THREE.Group();
  pitch.position.set(0, 1.0 * s, 1.1 * s);
  yaw.add(pitch);

  const muzzles = [];
  const barrelMat = mat(0x1d2226, { metalness: 0.6, roughness: 0.45 });

  if (opts.railgun) {
    const len = 8.4 * s;
    const barrel = new THREE.Mesh(new THREE.BoxGeometry(0.55 * s, 0.5 * s, len), barrelMat);
    barrel.position.z = len / 2;
    pitch.add(barrel);
    for (const side of [-1, 1]) {
      const rail = new THREE.Mesh(
        new THREE.BoxGeometry(0.14 * s, 0.16 * s, len * 0.92),
        mat(colors.accent, { emissive: colors.accent, emissiveIntensity: 0.9, metalness: 0.7 })
      );
      rail.position.set(side * 0.36 * s, 0.16 * s, len / 2);
      pitch.add(rail);
    }
    const m = new THREE.Object3D();
    m.position.z = len;
    pitch.add(m);
    muzzles.push(m);
  } else {
    const count = opts.barrels ?? 2;
    const len = 5.6 * s;
    for (let i = 0; i < count; i++) {
      const off = count === 1 ? 0 : (i - (count - 1) / 2) * 0.85 * s;
      const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.24 * s, 0.3 * s, len, 8), barrelMat);
      barrel.rotation.x = Math.PI / 2;
      barrel.position.set(off, 0, len / 2);
      pitch.add(barrel);
      const m = new THREE.Object3D();
      m.position.set(off, 0, len + 0.2);
      pitch.add(m);
      muzzles.push(m);
    }
  }
  return { root, yaw, pitch, muzzles };
}

/** Close-in weapon system: white dome plus gatling. */
function buildCiws(colors) {
  const root = new THREE.Group();
  const base = new THREE.Mesh(new THREE.CylinderGeometry(0.75, 0.9, 0.6, 10), mat(colors.trim));
  root.add(base);
  const yaw = new THREE.Group();
  yaw.position.y = 0.6;
  root.add(yaw);
  const dome = new THREE.Mesh(new THREE.SphereGeometry(0.95, 12, 8), mat(0xe8eced, { roughness: 0.5, flat: false }));
  dome.scale.y = 1.15;
  yaw.add(dome);
  const pitch = new THREE.Group();
  pitch.position.set(0, 0.35, 0.5);
  yaw.add(pitch);
  const gun = new THREE.Mesh(new THREE.CylinderGeometry(0.24, 0.28, 2.0, 8), mat(0x22272b, { metalness: 0.6 }));
  gun.rotation.x = Math.PI / 2;
  gun.position.z = 1.0;
  pitch.add(gun);
  const m = new THREE.Object3D();
  m.position.z = 2.1;
  pitch.add(m);
  return { root, yaw, pitch, muzzles: [m] };
}

/** Vertical launch cells - missiles come straight up out of these. */
function buildVLS(colors, cells = [4, 3]) {
  const [cols, rows] = cells;
  const root = new THREE.Group();
  const w = cols * 1.15;
  const d = rows * 1.15;
  const block = new THREE.Mesh(new THREE.BoxGeometry(w, 0.8, d), mat(colors.trim));
  block.position.y = 0.4;
  root.add(block);
  const hatchMat = mat(0x15181b, { metalness: 0.5, roughness: 0.5 });
  const muzzles = [];
  for (let i = 0; i < cols; i++) {
    for (let j = 0; j < rows; j++) {
      const x = (i - (cols - 1) / 2) * 1.15;
      const z = (j - (rows - 1) / 2) * 1.15;
      const hatch = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.12, 0.9), hatchMat);
      hatch.position.set(x, 0.83, z);
      root.add(hatch);
      const m = new THREE.Object3D();
      m.position.set(x, 1.0, z);
      m.userData.up = true;
      root.add(m);
      muzzles.push(m);
    }
  }
  return { root, muzzles, up: true };
}

/** Trainable torpedo tubes, angled off the beam. */
function buildTubes(colors, side) {
  const root = new THREE.Group();
  const yaw = new THREE.Group();
  root.add(yaw);
  yaw.rotation.y = side * 0.55;
  const muzzles = [];
  for (let i = 0; i < 2; i++) {
    const tube = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.42, 5.2, 10), mat(colors.trim, { metalness: 0.45 }));
    tube.rotation.x = Math.PI / 2;
    tube.position.set((i - 0.5) * 1.0, 0.45, 1.2);
    yaw.add(tube);
    const m = new THREE.Object3D();
    m.position.set((i - 0.5) * 1.0, 0.45, 3.9);
    yaw.add(m);
    muzzles.push(m);
  }
  return { root, yaw, pitch: null, muzzles };
}

function parkedJet(colors, folded = true) {
  const g = new THREE.Group();
  const body = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.55, 7.5, 7), mat(0x6f7780, { metalness: 0.4 }));
  body.rotation.x = Math.PI / 2;
  g.add(body);
  const nose = new THREE.Mesh(new THREE.ConeGeometry(0.35, 1.8, 7), mat(0x6f7780));
  nose.rotation.x = Math.PI / 2;
  nose.position.z = 4.4;
  g.add(nose);
  const wing = new THREE.Mesh(new THREE.BoxGeometry(folded ? 3.2 : 8.5, 0.16, 2.1), mat(0x5f666e));
  wing.position.z = -0.4;
  if (folded) wing.rotation.z = 0.5;
  g.add(wing);
  const tail = new THREE.Mesh(new THREE.BoxGeometry(0.14, 1.3, 1.4), mat(colors.accent));
  tail.position.set(0, 0.7, -3.2);
  g.add(tail);
  return g;
}

// --- per-class superstructures -------------------------------------------

function superBattlecruiser(g, hull, colors, radars) {
  const c = colors;
  const bridge = new THREE.Mesh(taperedBox(9, 7.5, 16, 0.7, 0.75), mat(c.deck));
  bridge.position.set(0, hull.deck, 4);
  g.add(bridge);
  const win = new THREE.Mesh(new THREE.BoxGeometry(7.4, 1.1, 0.4), mat(0x0d1418, { emissive: 0x14303d, metalness: 0.6 }));
  win.position.set(0, hull.deck + 6.2, 12.1);
  g.add(win);
  const m = mast(11, c, radars);
  m.position.set(0, hull.deck + 7.4, 2);
  g.add(m);
  const f1 = funnel(5.5, 6.5, c);
  f1.position.set(0, hull.deck + 0.3, -14);
  g.add(f1);
  const aft = new THREE.Mesh(taperedBox(8, 3.4, 12, 0.8, 0.85), mat(c.deck));
  aft.position.set(0, hull.deck, -22);
  g.add(aft);
  const stripe = new THREE.Mesh(new THREE.BoxGeometry(9.2, 0.5, 1.2), mat(c.accent, { emissive: c.accent, emissiveIntensity: 0.35 }));
  stripe.position.set(0, hull.deck + 4.0, -14);
  g.add(stripe);
  return { funnels: [new THREE.Vector3(0, hull.deck + 7.2, -14)] };
}

function superStealth(g, hull, colors, radars) {
  const c = colors;
  const tower = new THREE.Mesh(taperedBox(10, 12.5, 26, 0.42, 0.5), mat(c.deck, { metalness: 0.45 }));
  tower.position.set(0, hull.deck, -6);
  g.add(tower);
  for (const side of [-1, 1]) {
    const panel = new THREE.Mesh(new THREE.BoxGeometry(0.3, 2.4, 5.0), mat(c.accent, { emissive: c.accent, emissiveIntensity: 0.5 }));
    panel.position.set(side * 3.6, hull.deck + 7.5, 1.5);
    panel.rotation.z = side * 0.22;
    g.add(panel);
  }
  const apex = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.9, 5, 5), mat(c.trim));
  apex.position.set(0, hull.deck + 12.4, -6);
  g.add(apex);
  const r = radarDish(0.7);
  r.position.set(0, hull.deck + 14.6, -6);
  g.add(r);
  radars.push(r);
  return { funnels: [new THREE.Vector3(0, hull.deck + 12, -14)] };
}

function superDestroyer(g, hull, colors, radars) {
  const c = colors;
  const bridge = new THREE.Mesh(taperedBox(8.5, 8.5, 15, 0.72, 0.7), mat(c.deck));
  bridge.position.set(0, hull.deck, 6);
  g.add(bridge);
  for (const side of [-1, 1]) {
    const spy = new THREE.Mesh(new THREE.BoxGeometry(0.35, 3.2, 3.2), mat(0x8e959a, { metalness: 0.55 }));
    spy.position.set(side * 3.2, hull.deck + 4.6, 12.2);
    spy.rotation.y = side * 0.3;
    g.add(spy);
  }
  const m = mast(10, c, radars);
  m.position.set(0, hull.deck + 8.4, 4);
  g.add(m);
  const f = funnel(4.6, 5.5, c);
  f.position.set(0, hull.deck + 0.2, -8);
  g.add(f);
  const hangar = new THREE.Mesh(taperedBox(9, 4.2, 13, 0.86, 0.9), mat(c.deck));
  hangar.position.set(0, hull.deck, -20);
  g.add(hangar);
  const pad = new THREE.Mesh(new THREE.CircleGeometry(4.2, 20), mat(0x2b3238, { roughness: 1 }));
  pad.rotation.x = -Math.PI / 2;
  pad.position.set(0, hull.deck + 0.45, -31);
  g.add(pad);
  return { funnels: [new THREE.Vector3(0, hull.deck + 6, -8)] };
}

function superCorvette(g, hull, colors, radars) {
  const c = colors;
  const house = new THREE.Mesh(taperedBox(6, 5.2, 13, 0.6, 0.62), mat(c.deck));
  house.position.set(0, hull.deck, 2);
  g.add(house);
  const m = mast(6.5, c, radars);
  m.position.set(0, hull.deck + 5.0, -0.5);
  g.add(m);
  const exhaust = new THREE.Mesh(new THREE.BoxGeometry(3.4, 1.4, 3.0), mat(c.trim));
  exhaust.position.set(0, hull.deck + 0.7, -10);
  g.add(exhaust);
  return { funnels: [new THREE.Vector3(0, hull.deck + 1.8, -10)] };
}

function superCarrier(g, hull, colors, radars) {
  const c = colors;
  const deckY = hull.deck + 0.6;
  const flight = new THREE.Mesh(new THREE.BoxGeometry(hull.beam + 12, 0.9, hull.length * 0.96), mat(0x2f3439, { roughness: 1, metalness: 0.05 }));
  flight.position.set(0, deckY, 0);
  g.add(flight);
  const angled = new THREE.Mesh(new THREE.BoxGeometry(11, 0.9, hull.length * 0.5), mat(0x2f3439, { roughness: 1 }));
  angled.position.set(-11, deckY, 16);
  angled.rotation.y = 0.16;
  g.add(angled);

  const line = mat(0xe6ebee, { roughness: 1, metalness: 0 });
  for (let i = 0; i < 9; i++) {
    const dash = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.06, 5), line);
    dash.position.set(-6.2, deckY + 0.5, -55 + i * 13);
    dash.rotation.y = 0.16;
    g.add(dash);
  }
  for (const side of [-1, 1]) {
    const edge = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.08, hull.length * 0.9), line);
    edge.position.set(side * (hull.beam / 2 + 5.4), deckY + 0.5, 0);
    g.add(edge);
  }

  const island = new THREE.Group();
  island.position.set(hull.beam / 2 + 1.5, deckY + 0.45, -6);
  const tower = new THREE.Mesh(taperedBox(7, 11, 18, 0.75, 0.8), mat(c.deck));
  island.add(tower);
  const bridgeWin = new THREE.Mesh(new THREE.BoxGeometry(6, 1.2, 0.4), mat(0x0d1418, { emissive: 0x16323f }));
  bridgeWin.position.set(0, 7.2, 7.2);
  island.add(bridgeWin);
  const f = funnel(3.6, 4.0, c);
  f.position.set(0, 11, -4);
  island.add(f);
  const m = mast(9, c, radars);
  m.position.set(0, 11, 3);
  island.add(m);
  g.add(island);

  for (let i = 0; i < 5; i++) {
    const jet = parkedJet(c, true);
    jet.position.set(hull.beam / 2 + 0.5, deckY + 1.4, 40 - i * 11);
    jet.rotation.y = 0.35;
    jet.scale.setScalar(0.85);
    g.add(jet);
  }
  const ready = parkedJet(c, false);
  ready.position.set(-6.2, deckY + 1.4, 34);
  ready.rotation.y = 0.16;
  g.add(ready);

  return { funnels: [new THREE.Vector3(hull.beam / 2 + 1.5, deckY + 15, -10)], deckY };
}

function superSubmarine(g, hull, colors, radars) {
  const c = colors;
  const sail = new THREE.Mesh(taperedBox(3.2, 6.0, 11, 0.72, 0.78), mat(c.deck, { metalness: 0.35 }));
  sail.position.set(0, hull.deck - 0.4, 6);
  g.add(sail);
  for (const side of [-1, 1]) {
    const plane = new THREE.Mesh(new THREE.BoxGeometry(5.0, 0.3, 2.0), mat(c.trim));
    plane.position.set(side * 3.2, hull.deck + 3.4, 6);
    g.add(plane);
  }
  const periscope = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, 3.2, 6), mat(0x101315));
  periscope.position.set(0.5, hull.deck + 6.6, 6);
  g.add(periscope);
  const rudder = new THREE.Mesh(new THREE.BoxGeometry(0.4, 6.5, 5.0), mat(c.trim));
  rudder.position.set(0, hull.deck - 1.5, -hull.length / 2 + 5);
  g.add(rudder);
  const sternPlane = new THREE.Mesh(new THREE.BoxGeometry(11, 0.35, 4.0), mat(c.trim));
  sternPlane.position.set(0, -1.2, -hull.length / 2 + 6);
  g.add(sternPlane);
  const prop = new THREE.Mesh(new THREE.ConeGeometry(1.6, 2.4, 7), mat(0x8a7a45, { metalness: 0.7, roughness: 0.4 }));
  prop.rotation.x = Math.PI / 2;
  prop.position.set(0, -1.2, -hull.length / 2 - 0.5);
  g.add(prop);
  return { funnels: [] };
}

const SUPERS = {
  battlecruiser: superBattlecruiser,
  stealth: superStealth,
  destroyer: superDestroyer,
  corvette: superCorvette,
  carrier: superCarrier,
  submarine: superSubmarine,
};

/** Submarines get a pressure hull instead of a lofted surface hull. */
function buildSubHull(hull, colors) {
  const g = new THREE.Group();
  const body = new THREE.Mesh(
    new THREE.CapsuleGeometry(hull.beam / 2, hull.length - hull.beam, 6, 16),
    mat(colors.hull, { metalness: 0.35, roughness: 0.6, flat: false })
  );
  body.rotation.x = Math.PI / 2;
  body.position.y = hull.deck - hull.beam / 2 - 0.6;
  g.add(body);
  const casing = new THREE.Mesh(new THREE.BoxGeometry(hull.beam * 0.55, 0.5, hull.length * 0.72), mat(colors.deck, { roughness: 0.95 }));
  casing.position.y = hull.deck - 0.2;
  g.add(casing);
  return g;
}

/**
 * Build a complete warship from its definition.
 * Returns the root group plus the hardware the ship logic drives.
 */
export function buildShipMesh(def) {
  const root = new THREE.Group();
  const radars = [];
  const hullGroup = def.hull.type === 'submarine' ? buildSubHull(def.hull, def.colors) : buildHull(def.hull, def.colors);
  root.add(hullGroup);

  const extra = SUPERS[def.hull.type](root, def.hull, def.colors, radars) || {};

  const mounts = [];
  for (const m of def.mounts) {
    let hw;
    if (m.type === 'turret') {
      hw = buildTurret(def.colors, m.scale ?? 1, {
        railgun: m.railgun,
        barrels: m.railgun ? 1 : m.scale >= 1.2 ? 2 : 1,
      });
    } else if (m.type === 'ciws') {
      hw = buildCiws(def.colors);
    } else if (m.type === 'vls') {
      hw = buildVLS(def.colors, m.cells);
    } else if (m.type === 'tube') {
      hw = buildTubes(def.colors, Math.sign(m.pos[0]) || 1);
    } else {
      // 'deck' - a launch spot, no visible hardware of its own
      const o = new THREE.Object3D();
      const marker = new THREE.Object3D();
      o.add(marker);
      hw = { root: o, muzzles: [marker], up: true };
    }
    hw.root.position.set(m.pos[0], m.pos[1], m.pos[2]);
    if (m.rear) hw.root.rotation.y = Math.PI;
    root.add(hw.root);
    mounts.push({
      def: m,
      weapon: m.weapon,
      type: m.type,
      root: hw.root,
      yaw: hw.yaw ?? null,
      pitch: hw.pitch ?? null,
      muzzles: hw.muzzles,
      vertical: !!hw.up,
      pitchRest: hw.pitch ? hw.pitch.position.z : 0,
      rear: !!m.rear,
      next: 0,
    });
  }

  root.traverse((o) => {
    if (o.isMesh) {
      o.castShadow = true;
      o.receiveShadow = true;
      if (o.material) o.material.envMapIntensity = 0.85;
    }
  });

  return { root, mounts, radars, funnels: extra.funnels ?? [], deckY: extra.deckY };
}

/** Small silhouette used by the ship-select screen. */
export function buildPreview(def) {
  const { root, radars } = buildShipMesh(def);
  root.userData.radars = radars;
  return root;
}

export { TAU };
