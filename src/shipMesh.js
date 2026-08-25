import * as THREE from 'three';
import { Parts, railings } from './detail.js';
import { TAU } from './math.js';

// Procedural warship meshes. Local space: +Z is the bow, +X starboard, +Y up,
// y = 0 is the waterline. Everything static is merged per material by Parts,
// so a ship with several hundred fittings still costs a handful of draw calls.

const mat = (color, opts = {}) =>
  new THREE.MeshStandardMaterial({
    color,
    roughness: opts.roughness ?? 0.72,
    metalness: opts.metalness ?? 0.22,
    flatShading: opts.flat ?? true,
    emissive: opts.emissive ?? 0x000000,
    emissiveIntensity: opts.emissiveIntensity ?? 1,
  });

/** One material set per ship, so stealth fades and team colours stay local. */
function materials(colors) {
  return {
    hull: mat(colors.hull, { metalness: 0.34, roughness: 0.62, flat: false }),
    deck: mat(colors.deck, { roughness: 0.88, metalness: 0.08 }),
    trim: mat(colors.trim, { roughness: 0.7 }),
    dark: mat(0x1b1f23, { metalness: 0.55, roughness: 0.5 }),
    metal: mat(0x8d959b, { metalness: 0.72, roughness: 0.38 }),
    white: mat(0xdfe6e9, { roughness: 0.55, flat: false }),
    glass: mat(0x0a1418, { metalness: 0.85, roughness: 0.15, emissive: 0x0d2530, emissiveIntensity: 0.6 }),
    accent: mat(colors.accent, { emissive: colors.accent, emissiveIntensity: 0.3 }),
    rust: mat(0x6b4a3a, { roughness: 0.95, metalness: 0.05 }),
    rubber: mat(0x2a2d30, { roughness: 0.95, metalness: 0.02 }),
    brass: mat(0x8a7a45, { metalness: 0.8, roughness: 0.35 }),
  };
}

// Reusable primitives - cloned and baked into the merge by Parts.
const G = {
  box: new THREE.BoxGeometry(1, 1, 1),
  cyl: new THREE.CylinderGeometry(0.5, 0.5, 1, 10),
  cyl6: new THREE.CylinderGeometry(0.5, 0.5, 1, 6),
  cone: new THREE.ConeGeometry(0.5, 1, 8),
  sphere: new THREE.SphereGeometry(0.5, 12, 8),
  plane: new THREE.PlaneGeometry(1, 1),
  torus: new THREE.TorusGeometry(0.5, 0.12, 6, 14),
};

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

/** Deck plating: panel lines and non-skid patches, generated once per ship. */
function deckTexture() {
  // A modulation map: mostly white so it tints rather than darkens the deck.
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const g = c.getContext('2d');
  g.fillStyle = '#f2f2f2';
  g.fillRect(0, 0, 256, 256);
  g.strokeStyle = 'rgba(0,0,0,0.22)';
  g.lineWidth = 1;
  for (let i = 0; i < 256; i += 16) {
    g.beginPath();
    g.moveTo(i + 0.5, 0);
    g.lineTo(i + 0.5, 256);
    g.stroke();
  }
  for (let i = 0; i < 256; i += 32) {
    g.beginPath();
    g.moveTo(0, i + 0.5);
    g.lineTo(256, i + 0.5);
    g.stroke();
  }
  g.fillStyle = 'rgba(0,0,0,0.07)';
  for (let i = 0; i < 70; i++) {
    g.fillRect(Math.random() * 256, Math.random() * 256, Math.random() * 30 + 6, Math.random() * 12 + 3);
  }
  g.fillStyle = 'rgba(255,255,255,0.16)';
  for (let i = 0; i < 30; i++) {
    g.fillRect(Math.random() * 256, Math.random() * 256, Math.random() * 18 + 4, Math.random() * 8 + 2);
  }
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(0.12, 0.12);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/**
 * Lofted hull with sheer (the deck line rising fore and aft) and bow flare,
 * plus the deck outline used for the railings.
 */
function buildHull(hull, M) {
  const { length: L, beam: B, draft, deck } = hull;
  const half = B / 2;
  const bowSharp = hull.type === 'corvette' || hull.type === 'stealth' ? 0.8 : 0.46;
  const sternFull = hull.type === 'carrier' ? 1.0 : 0.86;

  const width = (t) => {
    if (t > 0.42) return Math.pow(Math.max(0, 1 - (t - 0.42) / 0.58), bowSharp);
    if (t < -0.78) return sternFull * (1 - (Math.abs(t) - 0.78) * 1.4);
    return 1;
  };
  const sheer = (t) => (t > 0 ? 1 : 0.4) * Math.pow(Math.abs(t), 2.3) * deck * 0.6;

  const pts = [];
  const N = 34;
  const stations = [];
  for (let i = 0; i <= N; i++) {
    const t = -1 + (2 * i) / N;
    stations.push(t);
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

  const p = geo.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i);
    const y = p.getY(i);
    const z = p.getZ(i);
    const t = z / (L / 2);
    const topness = THREE.MathUtils.clamp((y + draft) / depth, 0, 1);
    if (y < -draft + 0.01) {
      // keel: pull in and lift the forefoot
      p.setX(i, x * (hull.type === 'submarine' ? 0.85 : 0.48));
      p.setZ(i, z * 0.985);
      p.setY(i, y + Math.pow(Math.max(0, t), 3) * draft * 0.7);
    } else {
      p.setY(i, y + sheer(t) * topness);
      if (hull.type === 'stealth') p.setX(i, x * (1 - topness * 0.26));
      else p.setX(i, x * (1 + topness * 0.16 * Math.max(0, t)));   // bow flare
    }
  }
  geo.computeVertexNormals();

  const group = new THREE.Group();
  const hullMesh = new THREE.Mesh(geo, M.hull);
  group.add(hullMesh);

  // deck plate, following the sheer
  const deckGeo = new THREE.ExtrudeGeometry(shape, { depth: 0.3, bevelEnabled: false, steps: 1 });
  deckGeo.rotateX(Math.PI / 2);
  deckGeo.translate(0, deck + 0.32, 0);
  const dp = deckGeo.attributes.position;
  const shrink = hull.type === 'stealth' ? 0.74 : 0.95;
  for (let i = 0; i < dp.count; i++) {
    const z = dp.getZ(i);
    dp.setX(i, dp.getX(i) * shrink);
    dp.setY(i, dp.getY(i) + sheer(z / (L / 2)));
  }
  deckGeo.computeVertexNormals();
  const deckMat = M.deck.clone();
  deckMat.map = deckTexture();
  deckMat.flatShading = false;
  const deckPlate = new THREE.Mesh(deckGeo, deckMat);
  group.add(deckPlate);

  // boot topping at the waterline
  const stripe = new THREE.Mesh(
    new THREE.ExtrudeGeometry(shape, { depth: 1.0, bevelEnabled: false, steps: 1 }),
    mat(0x2a1714, { roughness: 0.9, metalness: 0.05 })
  );
  stripe.geometry.rotateX(Math.PI / 2);
  stripe.geometry.translate(0, 0.6, 0);
  stripe.scale.set(1.012, 1, 1.002);
  group.add(stripe);

  const outline = [];
  for (let i = 0; i <= N; i++) {
    const t = stations[i];
    outline.push(new THREE.Vector3(half * width(t) * shrink * 0.94, deck + 0.5 + sheer(t), (t * L) / 2));
  }
  for (let i = N; i >= 0; i--) {
    const t = stations[i];
    outline.push(new THREE.Vector3(-half * width(t) * shrink * 0.94, deck + 0.5 + sheer(t), (t * L) / 2));
  }
  outline.push(outline[0].clone());

  return { group, outline, sheer };
}

// ------------------------------------------------------------ deck fittings

function commonFittings(parts, hull, M, sheer, opts = {}) {
  const { length: L, beam: B, deck } = hull;
  const half = B / 2;
  const deckAt = (z) => deck + 0.6 + sheer(z / (L / 2));

  // knuckle strake: the fold in the plating that gives a hull its line
  for (let i = 0; i < 22; i++) {
    const t = -0.44 + (i / 21) * 0.9;
    const z = t * L;
    const w = half * (t > 0.2 ? 1 - (t - 0.2) * 1.5 : 1);
    if (w < 0.5) continue;
    parts.addPair(G.box, M.trim, [w * 1.0, deck - 0.9, z], [0, 0, 0], [0.22, 0.3, L / 22]);
  }

  // navigation lights: red to port, green to starboard, white aft
  parts.add(G.sphere, mat(0x2fbf4a, { emissive: 0x2fbf4a, emissiveIntensity: 3 }),
    [half * 0.9, deck + 1.6, L * 0.3], [0, 0, 0], 0.34);
  parts.add(G.sphere, mat(0xd83a2a, { emissive: 0xd83a2a, emissiveIntensity: 3 }),
    [-half * 0.9, deck + 1.6, L * 0.3], [0, 0, 0], 0.34);
  parts.add(G.sphere, mat(0xf2f0e6, { emissive: 0xf2f0e6, emissiveIntensity: 2.4 }),
    [0, deck + 1.4, -L * 0.47], [0, 0, 0], 0.3);

  // bollards and fairleads along both sides
  for (let i = 0; i < 7; i++) {
    const z = -L * 0.42 + (i / 6) * L * 0.84;
    const x = half * 0.86;
    parts.addPair(G.cyl, M.dark, [x, deckAt(z) + 0.25, z], [0, 0, 0], [0.34, 0.5, 0.34]);
  }

  // portholes down the hull sides
  const rows = hull.type === 'carrier' ? 2 : 1;
  for (let r = 0; r < rows; r++) {
    for (let i = 0; i < 14; i++) {
      const z = -L * 0.35 + (i / 13) * L * 0.7;
      const y = deck - 1.6 - r * 1.6;
      parts.addPair(G.cyl, M.dark, [half * 0.99, y, z], [0, 0, Math.PI / 2], [0.28, 0.14, 0.28]);
    }
  }

  // anchors, hawse pipes and the windlass
  const bowZ = L * 0.42;
  parts.addPair(G.box, M.dark, [half * 0.92, deck - 1.2, bowZ], [0, 0, 0], [0.5, 1.5, 1.1]);
  parts.add(G.cyl, M.metal, [0, deckAt(bowZ) + 0.5, bowZ - 2], [0, 0, Math.PI / 2], [0.9, 2.4, 0.9]);
  parts.add(G.box, M.trim, [0, deckAt(bowZ) + 0.1, bowZ - 3.4], [0, 0, 0], [2.6, 0.6, 2.0]);

  // deck hatches and vents
  for (let i = 0; i < 5; i++) {
    const z = -L * 0.3 + (i / 4) * L * 0.55;
    parts.add(G.box, M.trim, [half * 0.4, deckAt(z) + 0.14, z], [0, 0, 0], [1.4, 0.28, 1.4]);
    parts.add(G.cyl, M.trim, [-half * 0.45, deckAt(z) + 0.5, z], [0, 0, 0], [0.5, 1.0, 0.5]);
  }

  // life raft canisters in their cradles
  const rafts = opts.rafts ?? 4;
  for (let i = 0; i < rafts; i++) {
    const z = -L * 0.2 + (i / Math.max(rafts - 1, 1)) * L * 0.34;
    parts.addPair(G.cyl, M.white, [half * 0.8, deckAt(z) + 0.5, z], [Math.PI / 2, 0, 0], [0.55, 1.5, 0.55]);
    parts.addPair(G.box, M.trim, [half * 0.8, deckAt(z) + 0.05, z], [0, 0, 0], [1.3, 0.2, 1.7]);
  }

  // stern gear: shafts, screws and rudders
  if (hull.type !== 'submarine') {
    const sternZ = -L * 0.46;
    const shafts = hull.type === 'carrier' ? 2 : 1;
    for (let i = 0; i < shafts; i++) {
      const x = (i + 0.6) * half * 0.42;
      parts.addPair(G.cyl, M.metal, [x, -hull.draft * 0.72, sternZ + 2.5], [Math.PI / 2, 0, 0], [0.32, 5, 0.32]);
      parts.addPair(G.cone, M.brass, [x, -hull.draft * 0.72, sternZ - 0.4], [-Math.PI / 2, 0, 0], [2.0, 1.6, 2.0]);
      parts.addPair(G.box, M.trim, [x, -hull.draft * 0.5, sternZ - 2.2], [0, 0, 0], [0.35, 3.0, 2.6]);
    }
    // transom and stern light
    parts.add(G.box, M.trim, [0, deckAt(sternZ) + 0.3, -L * 0.485], [0, 0, 0], [B * 0.5, 0.7, 0.4]);
  }
}

function windowBand(parts, M, pos, w, h = 0.9, rot = 0, count = 4) {
  for (let i = 0; i < count; i++) {
    const off = (i - (count - 1) / 2) * (w / count);
    parts.add(G.box, M.glass,
      [pos[0] + Math.cos(rot) * off, pos[1], pos[2] - Math.sin(rot) * off],
      [0, rot, 0], [w / count * 0.72, h, 0.35]);
  }
}

function ladder(parts, M, x, y0, y1, z, facing = 0) {
  const h = y1 - y0;
  parts.add(G.box, M.metal, [x, y0 + h / 2, z], [0, facing, 0], [0.06, h, 0.06]);
  parts.add(G.box, M.metal, [x, y0 + h / 2, z + 0.5], [0, facing, 0], [0.06, h, 0.06]);
  const rungs = Math.max(2, Math.round(h / 0.45));
  for (let i = 0; i < rungs; i++) {
    parts.add(G.box, M.metal, [x, y0 + (i / rungs) * h, z + 0.25], [0, facing, 0], [0.06, 0.05, 0.5]);
  }
}

function satDome(parts, M, pos, r = 1.1) {
  parts.add(G.sphere, M.white, pos, [0, 0, 0], [r * 2, r * 1.8, r * 2]);
  parts.add(G.cyl, M.trim, [pos[0], pos[1] - r * 0.9, pos[2]], [0, 0, 0], [r * 1.4, r * 0.5, r * 1.4]);
}

function antenna(parts, M, pos, h = 4, tilt = 0) {
  parts.add(G.cyl6, M.metal, [pos[0], pos[1] + h / 2, pos[2]], [tilt, 0, 0], [0.09, h, 0.09]);
  parts.add(G.sphere, M.accent, [pos[0], pos[1] + h, pos[2]], [0, 0, 0], 0.18);
}

function boat(parts, M, pos, mirror = 1) {
  // RHIB in its davit
  parts.add(G.box, M.white, pos, [0, 0, 0], [1.7, 0.75, 5.2]);
  parts.add(G.box, M.rubber, [pos[0], pos[1] + 0.42, pos[2]], [0, 0, 0], [1.9, 0.28, 5.0]);
  parts.add(G.box, M.dark, [pos[0], pos[1] + 0.6, pos[2] - 0.6], [0, 0, 0], [0.9, 0.6, 1.2]);
  parts.add(G.cyl, M.metal, [pos[0] + mirror * 1.2, pos[1] + 1.6, pos[2] + 2.0], [0, 0, 0], [0.16, 3.4, 0.16]);
  parts.add(G.cyl, M.metal, [pos[0] + mirror * 1.2, pos[1] + 1.6, pos[2] - 2.0], [0, 0, 0], [0.16, 3.4, 0.16]);
}

function helicopter(parts, M, pos, heading = 0) {
  const [x, y, z] = pos;
  parts.add(G.sphere, M.deck, [x, y + 1.0, z], [0, heading, 0], [3.0, 2.4, 5.6]);
  parts.add(G.box, M.glass, [x, y + 1.2, z + 2.0], [0, heading, 0], [2.0, 1.3, 1.4]);
  parts.add(G.cyl, M.deck, [x, y + 1.4, z - 4.2], [Math.PI / 2, heading, 0], [0.7, 5.0, 0.7]);
  parts.add(G.box, M.deck, [x, y + 2.4, z - 6.2], [0, heading, 0], [0.2, 1.8, 1.2]);
  parts.add(G.cyl, M.dark, [x, y + 2.5, z], [0, 0, 0], [0.4, 0.7, 0.4]);
  for (let i = 0; i < 4; i++) {
    parts.add(G.box, M.dark, [x, y + 2.8, z], [0, heading + (i * Math.PI) / 2, 0], [0.36, 0.07, 9.5]);
  }
  parts.addPair(G.box, M.metal, [x + 1.2, y - 0.1, z], [0, heading, 0], [0.12, 1.0, 4.0]);
}

function jet(parts, M, pos, heading, folded = true) {
  const [x, y, z] = pos;
  parts.add(G.cyl, M.metal, [x, y, z], [Math.PI / 2, heading, 0], [1.0, 8.0, 1.0]);
  parts.add(G.cone, M.metal, [x + Math.sin(heading) * 4.6, y, z + Math.cos(heading) * 4.6], [-Math.PI / 2, heading, 0], [1.0, 2.2, 1.0]);
  parts.add(G.box, M.glass, [x + Math.sin(heading) * 2.4, y + 0.5, z + Math.cos(heading) * 2.4], [0, heading, 0], [0.9, 0.5, 1.8]);
  if (folded) {
    parts.add(G.box, M.deck, [x, y + 0.6, z - 0.5], [0, heading, 0.6], [4.0, 0.16, 2.2]);
    parts.add(G.box, M.deck, [x, y + 0.6, z - 0.5], [0, heading, -0.6], [4.0, 0.16, 2.2]);
  } else {
    parts.add(G.box, M.deck, [x, y, z - 0.4], [0, heading, 0], [9.5, 0.16, 2.4]);
  }
  parts.add(G.box, M.accent, [x, y + 0.9, z - 3.2], [0, heading, 0], [0.14, 1.5, 1.6]);
  parts.add(G.box, M.deck, [x, y - 0.1, z - 3.4], [0, heading, 0], [4.2, 0.14, 1.2]);
}

function containerStack(parts, M, pos) {
  const cols = [0x8a5a2b, 0x2f6b8a, 0x6b6f2f];
  for (let i = 0; i < 3; i++) {
    parts.add(G.box, i === 0 ? M.rust : M.trim, [pos[0], pos[1] + i * 1.3, pos[2]], [0, 0, 0], [2.4, 1.2, 5.4]);
  }
  void cols;
}

// --------------------------------------------------------- weapon hardware

function radarDish(M, scale = 1, kind = 'bar') {
  const g = new THREE.Group();
  const post = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, 1.1, 6), M.trim);
  post.position.y = 0.55;
  g.add(post);
  if (kind === 'bar') {
    const dish = new THREE.Mesh(new THREE.BoxGeometry(3.4, 1.0, 0.22), M.metal);
    dish.position.y = 1.2;
    g.add(dish);
    const back = new THREE.Mesh(new THREE.BoxGeometry(3.0, 0.16, 0.5), M.trim);
    back.position.set(0, 1.2, -0.2);
    g.add(back);
  } else {
    const dish = new THREE.Mesh(new THREE.SphereGeometry(1.0, 12, 8, 0, TAU, 0, Math.PI / 2), M.white);
    dish.rotation.x = -0.9;
    dish.position.y = 1.3;
    g.add(dish);
  }
  g.scale.setScalar(scale);
  g.userData.spin = kind === 'bar' ? 1.7 : 0.9;
  return g;
}

function mast(parts, M, radars, root, x, y, z, height) {
  parts.add(G.cyl6, M.trim, [x, y + height / 2, z], [0, 0, 0], [0.55, height, 0.55]);
  for (let i = 0; i < 3; i++) {
    const yy = y + height * (0.34 + i * 0.22);
    parts.add(G.box, M.trim, [x, yy, z], [0, 0, 0], [4.2 - i * 0.9, 0.16, 0.4]);
    parts.addPair(G.cyl6, M.metal, [x + (2.0 - i * 0.45), yy + 0.6, z], [0, 0, 0], [0.07, 1.2, 0.07]);
  }
  // planar array faces
  for (let i = 0; i < 3; i++) {
    parts.add(G.box, M.metal, [x, y + height * 0.42, z + 0.55], [-0.14, (i * TAU) / 3, 0], [1.7, 2.1, 0.24]);
  }
  antenna(parts, M, [x, y + height, z], 3.2);
  const r = radarDish(M, 0.95, 'bar');
  r.position.set(x, y + height * 0.86, z);
  root.add(r);
  radars.push(r);
}

function funnel(parts, M, x, y, z, w, h) {
  parts.add(taperedBox(w, h, w * 1.3, 0.78, 0.8), M.trim, [x, y, z]);
  parts.add(G.box, M.dark, [x, y + h, z], [0, 0, 0], [w * 0.82, 0.34, w * 1.05]);
  for (const s of [-1, 1]) {
    parts.add(G.cyl, M.dark, [x + s * w * 0.22, y + h + 0.5, z], [0, 0, 0], [0.5, 1.2, 0.5]);
  }
  parts.add(G.box, M.accent, [x, y + h * 0.62, z], [0, 0, 0], [w * 0.95, 0.5, w * 1.36]);
}

/** Rotating gun turret with barrels; returns the aiming pivots. */
function buildTurret(M, scale, opts = {}) {
  const s = scale;
  const root = new THREE.Group();
  const barbette = new THREE.Mesh(new THREE.CylinderGeometry(1.8 * s, 2.0 * s, 0.85 * s, 14), M.trim);
  barbette.position.y = 0.42 * s;
  root.add(barbette);

  const yaw = new THREE.Group();
  yaw.position.y = 0.85 * s;
  root.add(yaw);

  const house = new THREE.Mesh(taperedBox(3.1 * s, 1.8 * s, 4.0 * s, 0.7, 0.6), M.deck);
  yaw.add(house);
  const cheek = new THREE.Mesh(new THREE.BoxGeometry(3.3 * s, 0.5 * s, 1.4 * s), M.trim);
  cheek.position.set(0, 1.3 * s, -1.2 * s);
  yaw.add(cheek);
  const optic = new THREE.Mesh(new THREE.BoxGeometry(0.7 * s, 0.5 * s, 0.5 * s), M.glass);
  optic.position.set(0, 1.55 * s, 0.9 * s);
  yaw.add(optic);

  const pitch = new THREE.Group();
  pitch.position.set(0, 1.0 * s, 1.1 * s);
  yaw.add(pitch);

  const muzzles = [];
  if (opts.railgun) {
    const len = 9.0 * s;
    const barrel = new THREE.Mesh(new THREE.BoxGeometry(0.6 * s, 0.55 * s, len), M.dark);
    barrel.position.z = len / 2;
    pitch.add(barrel);
    for (const side of [-1, 1]) {
      const rail = new THREE.Mesh(new THREE.BoxGeometry(0.15 * s, 0.18 * s, len * 0.93), M.accent);
      rail.position.set(side * 0.38 * s, 0.18 * s, len / 2);
      pitch.add(rail);
    }
    const coil = new THREE.Mesh(new THREE.TorusGeometry(0.55 * s, 0.1 * s, 6, 12), M.metal);
    coil.rotation.y = Math.PI / 2;
    coil.position.z = len * 0.55;
    pitch.add(coil);
    const m = new THREE.Object3D();
    m.position.z = len;
    pitch.add(m);
    muzzles.push(m);
  } else {
    const count = opts.barrels ?? 2;
    const len = 6.0 * s;
    for (let i = 0; i < count; i++) {
      const off = count === 1 ? 0 : (i - (count - 1) / 2) * 0.9 * s;
      const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.22 * s, 0.3 * s, len, 10), M.dark);
      barrel.rotation.x = Math.PI / 2;
      barrel.position.set(off, 0, len / 2);
      pitch.add(barrel);
      const brake = new THREE.Mesh(new THREE.CylinderGeometry(0.3 * s, 0.3 * s, 0.7 * s, 10), M.metal);
      brake.rotation.x = Math.PI / 2;
      brake.position.set(off, 0, len - 0.5 * s);
      pitch.add(brake);
      const sleeve = new THREE.Mesh(new THREE.CylinderGeometry(0.42 * s, 0.42 * s, 1.6 * s, 10), M.trim);
      sleeve.rotation.x = Math.PI / 2;
      sleeve.position.set(off, 0, 0.7 * s);
      pitch.add(sleeve);
      const m = new THREE.Object3D();
      m.position.set(off, 0, len + 0.2);
      pitch.add(m);
      muzzles.push(m);
    }
  }
  return { root, yaw, pitch, muzzles };
}

function buildCiws(M) {
  const root = new THREE.Group();
  const base = new THREE.Mesh(new THREE.CylinderGeometry(0.8, 0.95, 0.7, 12), M.trim);
  root.add(base);
  const yaw = new THREE.Group();
  yaw.position.y = 0.7;
  root.add(yaw);
  const dome = new THREE.Mesh(new THREE.SphereGeometry(1.0, 14, 10), M.white);
  dome.scale.y = 1.2;
  yaw.add(dome);
  const box = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.7, 1.1), M.trim);
  box.position.set(0, 0.1, -0.6);
  yaw.add(box);
  const pitch = new THREE.Group();
  pitch.position.set(0, 0.3, 0.55);
  yaw.add(pitch);
  const cluster = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.34, 2.2, 8), M.dark);
  cluster.rotation.x = Math.PI / 2;
  cluster.position.z = 1.1;
  pitch.add(cluster);
  for (let i = 0; i < 6; i++) {
    const b = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 2.3, 5), M.metal);
    b.rotation.x = Math.PI / 2;
    b.position.set(Math.cos((i / 6) * TAU) * 0.19, Math.sin((i / 6) * TAU) * 0.19, 1.2);
    pitch.add(b);
  }
  const m = new THREE.Object3D();
  m.position.z = 2.3;
  pitch.add(m);
  return { root, yaw, pitch, muzzles: [m] };
}

function buildVLS(M, cells = [4, 3]) {
  const [cols, rows] = cells;
  const root = new THREE.Group();
  const w = cols * 1.2;
  const d = rows * 1.2;
  const block = new THREE.Mesh(new THREE.BoxGeometry(w + 0.5, 0.9, d + 0.5), M.trim);
  block.position.y = 0.45;
  root.add(block);
  const muzzles = [];
  for (let i = 0; i < cols; i++) {
    for (let j = 0; j < rows; j++) {
      const x = (i - (cols - 1) / 2) * 1.2;
      const z = (j - (rows - 1) / 2) * 1.2;
      const hatch = new THREE.Mesh(new THREE.BoxGeometry(0.95, 0.16, 0.95), M.dark);
      hatch.position.set(x, 0.92, z);
      root.add(hatch);
      const rim = new THREE.Mesh(new THREE.BoxGeometry(1.08, 0.1, 1.08), M.metal);
      rim.position.set(x, 0.88, z);
      root.add(rim);
      const m = new THREE.Object3D();
      m.position.set(x, 1.1, z);
      root.add(m);
      muzzles.push(m);
    }
  }
  return { root, muzzles, up: true };
}

function buildTubes(M, side) {
  const root = new THREE.Group();
  const yaw = new THREE.Group();
  root.add(yaw);
  yaw.rotation.y = side * 0.55;
  const mount = new THREE.Mesh(new THREE.CylinderGeometry(0.9, 1.1, 0.6, 10), M.trim);
  root.add(mount);
  const muzzles = [];
  for (let i = 0; i < 2; i++) {
    for (let k = 0; k < 2; k++) {
      const tube = new THREE.Mesh(new THREE.CylinderGeometry(0.45, 0.45, 5.4, 12), M.trim);
      tube.rotation.x = Math.PI / 2;
      tube.position.set((i - 0.5) * 1.05, 0.5 + k * 0.95, 1.2);
      yaw.add(tube);
      const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.47, 0.47, 0.25, 12), M.dark);
      cap.rotation.x = Math.PI / 2;
      cap.position.set((i - 0.5) * 1.05, 0.5 + k * 0.95, 3.95);
      yaw.add(cap);
      if (k === 0) {
        const m = new THREE.Object3D();
        m.position.set((i - 0.5) * 1.05, 0.5, 4.1);
        yaw.add(m);
        muzzles.push(m);
      }
    }
  }
  return { root, yaw, pitch: null, muzzles };
}

// --------------------------------------------------- per-class superstructure

function superBattlecruiser(parts, root, hull, M, radars, sheer) {
  const { length: L, beam: B, deck } = hull;
  const d = (z) => deck + 0.6 + sheer(z / (L / 2));

  parts.add(taperedBox(10, 8.5, 18, 0.68, 0.74), M.deck, [0, d(4), 4]);
  parts.add(taperedBox(7.4, 3.2, 9, 0.8, 0.8), M.deck, [0, d(4) + 8.5, 2]);
  parts.add(G.box, M.glass, [0, d(4) + 6.6, 12.4], [0, 0, 0], [7.6, 1.3, 0.5]);
  parts.addPair(G.box, M.glass, [3.6, d(4) + 6.6, 10.5], [0, 0.5, 0], [3.0, 1.2, 0.4]);
  parts.addPair(G.box, M.deck, [5.4, d(4) + 5.6, 9.0], [0, 0, 0], [2.4, 0.4, 3.4]);   // bridge wings
  windowBand(parts, M, [0, d(4) + 3.4, 12.6], 7.4, 0.7, 0, 5);
  windowBand(parts, M, [4.6, d(4) + 3.4, 4.0], 12.0, 0.7, Math.PI / 2, 6);
  windowBand(parts, M, [-4.6, d(4) + 3.4, 4.0], 12.0, 0.7, Math.PI / 2, 6);
  parts.add(G.box, M.trim, [0, d(4) + 8.3, 4], [0, 0, 0], [10.4, 0.35, 18.4]);      // deck overhang
  ladder(parts, M, 4.6, d(4), d(4) + 8.4, -2);

  mast(parts, M, radars, root, 0, d(0) + 11.5, 1, 12);
  funnel(parts, M, 0, d(-14) + 0.2, -14, 5.8, 7.0);
  parts.add(taperedBox(9, 4.0, 13, 0.82, 0.86), M.deck, [0, d(-22), -22]);
  satDome(parts, M, [3.4, d(-8) + 5.6, -8], 1.3);
  satDome(parts, M, [-3.4, d(-8) + 5.6, -8], 1.3);
  boat(parts, M, [B * 0.42, d(-4) + 1.2, -4], 1);
  boat(parts, M, [-B * 0.42, d(-4) + 1.2, -4], -1);
  containerStack(parts, M, [0, d(-30) + 0.7, -32]);
  antenna(parts, M, [B * 0.36, d(-18) + 3, -18], 5);
  antenna(parts, M, [-B * 0.36, d(-18) + 3, -18], 5);
  return { funnels: [new THREE.Vector3(0, deck + 8.4, -14)] };
}

function superStealth(parts, root, hull, M, radars, sheer) {
  const { length: L, deck } = hull;
  const d = (z) => deck + 0.6 + sheer(z / (L / 2));

  parts.add(taperedBox(11, 13.5, 30, 0.4, 0.48), M.deck, [0, d(-6), -6]);
  for (const s of [-1, 1]) {
    parts.add(G.box, M.accent, [s * 3.8, d(0) + 8.2, 2.0], [0, 0, s * 0.22], [0.3, 2.6, 5.4]);
    parts.add(G.box, M.glass, [s * 3.2, d(0) + 9.6, 6.0], [0, s * 0.3, 0], [0.35, 1.1, 3.2]);
    parts.add(G.box, M.metal, [s * 3.9, d(0) + 5.0, -2.0], [0, 0, s * 0.2], [0.25, 2.4, 2.4]);
  }
  parts.add(G.cone, M.trim, [0, d(-6) + 13.5, -6], [0, 0, 0], [1.8, 6.0, 1.8]);
  antenna(parts, M, [0, d(-6) + 18.5, -6], 3.4);
  const r = radarDish(M, 0.8, 'dome');
  r.position.set(0, d(-6) + 14.0, -6);
  root.add(r);
  radars.push(r);
  parts.add(G.box, M.dark, [0, d(-30) + 0.3, -30], [0, 0, 0], [7.0, 0.4, 8.0]);   // flight deck
  parts.add(G.box, M.accent, [0, d(-30) + 0.55, -30], [0, 0, 0], [5.0, 0.06, 0.4]);
  return { funnels: [new THREE.Vector3(0, deck + 13, -12)] };
}

function superDestroyer(parts, root, hull, M, radars, sheer) {
  const { length: L, beam: B, deck } = hull;
  const d = (z) => deck + 0.6 + sheer(z / (L / 2));

  parts.add(taperedBox(9.2, 9.0, 17, 0.7, 0.7), M.deck, [0, d(6), 6]);
  parts.add(taperedBox(6.6, 3.0, 8, 0.82, 0.82), M.deck, [0, d(6) + 9.0, 5]);
  parts.add(G.box, M.glass, [0, d(6) + 7.0, 13.6], [0, 0, 0], [6.6, 1.3, 0.5]);
  for (const s of [-1, 1]) {
    parts.add(G.box, M.metal, [s * 3.4, d(6) + 4.8, 12.6], [0, s * 0.32, 0], [0.4, 3.4, 3.4]);
    parts.add(G.box, M.metal, [s * 3.9, d(6) + 4.8, 0.5], [0, s * 1.9, 0], [0.4, 3.4, 3.4]);
    parts.add(G.box, M.deck, [s * 5.2, d(6) + 6.0, 10.5], [0, 0, 0], [2.2, 0.35, 3.0]);
  }
  ladder(parts, M, 4.2, d(6), d(6) + 8.8, 0);
  windowBand(parts, M, [0, d(6) + 3.6, 14.0], 6.6, 0.7, 0, 5);
  windowBand(parts, M, [4.8, d(6) + 3.6, 6.0], 11.0, 0.7, Math.PI / 2, 6);
  windowBand(parts, M, [-4.8, d(6) + 3.6, 6.0], 11.0, 0.7, Math.PI / 2, 6);
  parts.add(G.box, M.trim, [0, d(6) + 8.8, 6], [0, 0, 0], [9.6, 0.32, 17.4]);

  mast(parts, M, radars, root, 0, d(2) + 10.5, 3, 10.5);
  funnel(parts, M, 0, d(-8) + 0.2, -8, 4.8, 5.6);
  funnel(parts, M, 0, d(-16) + 0.2, -16, 4.2, 4.6);
  parts.add(taperedBox(9.5, 4.6, 14, 0.86, 0.9), M.deck, [0, d(-22), -22]);
  satDome(parts, M, [2.8, d(-12) + 5.0, -12], 1.1);
  satDome(parts, M, [-2.8, d(-12) + 5.0, -12], 1.1);
  boat(parts, M, [B * 0.44, d(-2) + 1.2, -2], 1);

  // helipad with markings and a helicopter
  const padZ = -L * 0.4;
  parts.add(G.cyl, M.dark, [0, d(padZ) + 0.16, padZ], [0, 0, 0], [9.0, 0.12, 9.0]);
  parts.add(G.torus, M.white, [0, d(padZ) + 0.24, padZ], [Math.PI / 2, 0, 0], [7.0, 7.0, 7.0]);
  parts.add(G.box, M.white, [0, d(padZ) + 0.24, padZ], [0, 0, 0], [1.0, 0.06, 4.4]);
  parts.add(G.box, M.white, [0, d(padZ) + 0.24, padZ], [0, 0, 0], [4.4, 0.06, 1.0]);
  helicopter(parts, M, [0, d(padZ) + 0.9, padZ], 0);
  return { funnels: [new THREE.Vector3(0, deck + 6.5, -8)] };
}

function superCorvette(parts, root, hull, M, radars, sheer) {
  const { length: L, beam: B, deck } = hull;
  const d = (z) => deck + 0.6 + sheer(z / (L / 2));

  parts.add(taperedBox(6.4, 5.6, 14, 0.58, 0.6), M.deck, [0, d(2), 2]);
  parts.add(G.box, M.glass, [0, d(2) + 4.2, 8.6], [0, 0, 0], [4.4, 1.1, 0.4]);
  parts.addPair(G.box, M.glass, [2.0, d(2) + 4.2, 6.8], [0, 0.6, 0], [2.2, 1.0, 0.35]);
  parts.add(taperedBox(4.0, 2.2, 5.0, 0.7, 0.7), M.deck, [0, d(2) + 5.6, 0]);
  mast(parts, M, radars, root, 0, d(0) + 7.6, -0.5, 6.4);
  parts.add(G.box, M.trim, [0, d(-10) + 0.9, -10], [0, 0, 0], [3.8, 1.8, 3.2]);
  parts.addPair(G.cyl, M.dark, [1.1, d(-10) + 2.0, -10], [0, 0, 0], [0.5, 1.2, 0.5]);
  boat(parts, M, [B * 0.4, d(-6) + 0.9, -6], 1);
  antenna(parts, M, [B * 0.34, d(-4) + 2, -4], 3.6);
  antenna(parts, M, [-B * 0.34, d(-4) + 2, -4], 3.6);
  return { funnels: [new THREE.Vector3(0, deck + 2.6, -10)] };
}

function superCarrier(parts, root, hull, M, radars, sheer) {
  const { length: L, beam: B, deck } = hull;
  const deckY = deck + 1.4;

  // flight deck with sponsons and the angled landing strip
  parts.add(G.box, M.dark, [0, deckY, 0], [0, 0, 0], [B + 13, 1.1, L * 0.97]);
  parts.add(G.box, M.dark, [-11.5, deckY, 14], [0, 0.17, 0], [12, 1.05, L * 0.46]);
  for (const s of [-1, 1]) {
    for (let i = 0; i < 6; i++) {
      const z = -L * 0.36 + (i / 5) * L * 0.72;
      parts.add(G.box, M.trim, [s * (B / 2 + 6.4), deckY - 1.6, z], [0, 0, 0], [1.8, 1.6, 7.0]);
    }
  }
  // deck markings
  for (let i = 0; i < 11; i++) {
    parts.add(G.box, M.white, [-6.4, deckY + 0.58, -L * 0.4 + (i / 10) * L * 0.8], [0, 0.17, 0], [0.8, 0.06, 5.2]);
  }
  for (const s of [-1, 1]) {
    parts.add(G.box, M.white, [s * (B / 2 + 5.8), deckY + 0.58, 0], [0, 0, 0], [0.6, 0.06, L * 0.9]);
  }
  parts.add(G.box, M.accent, [-11.5, deckY + 0.58, L * 0.3], [0, 0.17, 0], [10, 0.07, 0.8]);
  // arrestor wires and catapults
  for (let i = 0; i < 4; i++) {
    parts.add(G.box, M.metal, [-9, deckY + 0.62, -L * 0.28 + i * 6], [0, 0.17, 0], [16, 0.08, 0.2]);
  }
  parts.add(G.box, M.metal, [4.0, deckY + 0.62, 10], [0, 0, 0], [0.5, 0.08, L * 0.42]);

  // island
  const ix = B / 2 + 2.0;
  const iy = deckY + 0.55;
  parts.add(taperedBox(7.5, 12, 20, 0.76, 0.82), M.deck, [ix, iy, -6]);
  parts.add(G.box, M.glass, [ix, iy + 7.6, 3.4], [0, 0, 0], [6.4, 1.4, 0.5]);
  parts.add(G.box, M.glass, [ix + 3.6, iy + 7.6, 0], [0, Math.PI / 2, 0], [8.0, 1.4, 0.5]);
  parts.add(taperedBox(5.0, 3.0, 8.0, 0.8, 0.8), M.deck, [ix, iy + 12, -6]);
  windowBand(parts, M, [ix, iy + 4.6, 3.6], 6.2, 0.7, 0, 5);
  windowBand(parts, M, [ix + 3.7, iy + 4.6, -6], 16.0, 0.7, Math.PI / 2, 7);
  parts.add(G.box, M.trim, [ix, iy + 12.2, -6], [0, 0, 0], [8.0, 0.3, 20.4]);
  funnel(parts, M, ix, iy + 12, -12, 4.0, 4.4);
  mast(parts, M, radars, root, ix, iy + 15, -2, 9);
  satDome(parts, M, [ix - 3.2, iy + 13.4, -9], 1.4);
  satDome(parts, M, [ix + 3.2, iy + 13.4, -3], 1.2);
  for (let i = 0; i < 4; i++) {
    parts.add(G.box, M.metal, [ix, iy + 4.5, -6], [0, (i * Math.PI) / 2, 0], [0.4, 3.6, 4.0]);
  }
  ladder(parts, M, ix - 4.0, iy, iy + 11.5, -12);

  // air wing on deck
  jet(parts, M, [ix - 4.5, deckY + 1.6, 40], 0.3, true);
  jet(parts, M, [ix - 4.5, deckY + 1.6, 28], 0.3, true);
  jet(parts, M, [ix - 4.5, deckY + 1.6, 16], 0.3, true);
  jet(parts, M, [ix - 3.5, deckY + 1.6, -26], 0.9, true);
  jet(parts, M, [ix - 3.5, deckY + 1.6, -40], 0.9, true);
  jet(parts, M, [-6.4, deckY + 1.6, 34], 0.17, false);
  jet(parts, M, [-6.4, deckY + 1.6, 6], 0.17, false);
  helicopter(parts, M, [-B * 0.55, deckY + 1.4, -L * 0.36], 0.5);
  // tow tractors and crates
  for (let i = 0; i < 3; i++) {
    parts.add(G.box, M.accent, [ix - 9, deckY + 1.2, -10 + i * 7], [0, 0, 0], [1.6, 1.0, 3.0]);
  }
  return { funnels: [new THREE.Vector3(ix, deckY + 17, -12)], deckY };
}

function superSubmarine(parts, root, hull, M, radars, sheer) {
  const { length: L, beam: B, deck } = hull;
  parts.add(taperedBox(3.4, 6.4, 12, 0.72, 0.78), M.deck, [0, deck - 0.4, 6]);
  parts.addPair(G.box, M.trim, [3.4, deck + 3.4, 6], [0, 0, 0], [5.2, 0.32, 2.1]);
  // periscopes and masts
  parts.add(G.cyl6, M.dark, [0.5, deck + 8.0, 6.6], [0, 0, 0], [0.16, 3.4, 0.16]);
  parts.add(G.cyl6, M.dark, [-0.5, deck + 7.4, 5.4], [0, 0, 0], [0.14, 2.6, 0.14]);
  parts.add(G.box, M.metal, [0, deck + 7.0, 4.0], [0, 0, 0], [0.9, 1.2, 0.5]);
  parts.add(G.box, M.accent, [0, deck + 3.0, 11.4], [0, 0, 0], [1.4, 0.5, 0.3]);
  // deck casing details
  for (let i = 0; i < 6; i++) {
    const z = -L * 0.3 + (i / 5) * L * 0.55;
    parts.add(G.box, M.trim, [0, deck + 0.1, z], [0, 0, 0], [2.0, 0.2, 1.4]);
  }
  parts.add(G.box, M.trim, [0, deck - 1.5, -L / 2 + 5], [0, 0, 0], [0.45, 7.0, 5.2]);
  parts.add(G.box, M.trim, [0, -1.2, -L / 2 + 6], [0, 0, 0], [11.5, 0.4, 4.2]);
  parts.add(G.cone, M.brass, [0, -1.2, -L / 2 - 0.6], [-Math.PI / 2, 0, 0], [3.4, 2.6, 3.4]);
  parts.add(G.torus, M.trim, [0, -1.2, -L / 2 + 1.2], [Math.PI / 2, 0, 0], [7.0, 7.0, 3.0]);
  void B;
  void radars;
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

function buildSubHull(hull, M) {
  const g = new THREE.Group();
  const body = new THREE.Mesh(
    new THREE.CapsuleGeometry(hull.beam / 2, hull.length - hull.beam, 8, 20),
    M.hull
  );
  body.rotation.x = Math.PI / 2;
  body.position.y = hull.deck - hull.beam / 2 - 0.6;
  g.add(body);
  const casing = new THREE.Mesh(
    new THREE.BoxGeometry(hull.beam * 0.5, 0.5, hull.length * 0.74),
    M.deck
  );
  casing.position.y = hull.deck - 0.2;
  g.add(casing);
  const outline = [];
  const n = 18;
  for (let i = 0; i <= n; i++) {
    const t = -0.37 + (i / n) * 0.74;
    outline.push(new THREE.Vector3(hull.beam * 0.24, hull.deck + 0.1, t * hull.length));
  }
  for (let i = n; i >= 0; i--) {
    const t = -0.37 + (i / n) * 0.74;
    outline.push(new THREE.Vector3(-hull.beam * 0.24, hull.deck + 0.1, t * hull.length));
  }
  return { group: g, outline, sheer: () => 0 };
}

/**
 * Build a complete warship from its definition.
 * Returns the root group plus the hardware the ship logic drives.
 */
export function buildShipMesh(def) {
  const root = new THREE.Group();
  const M = materials(def.colors);
  const radars = [];
  const parts = new Parts();

  const sub = def.hull.type === 'submarine';
  const { group: hullGroup, outline, sheer } = sub ? buildSubHull(def.hull, M) : buildHull(def.hull, M);
  root.add(hullGroup);

  if (!sub) commonFittings(parts, def.hull, M, sheer, { rafts: def.hull.length > 100 ? 6 : 4 });
  const extra = SUPERS[def.hull.type](parts, root, def.hull, M, radars, sheer) || {};

  // railings around the working deck
  if (!sub && def.hull.type !== 'carrier') {
    root.add(railings(outline, 0, M.metal, M.trim, { postEvery: 2 }));
  } else if (def.hull.type === 'carrier') {
    const edge = outline.map((p) => new THREE.Vector3(p.x * 1.42, extra.deckY + 0.6, p.z * 0.97));
    root.add(railings(edge, 0, M.metal, M.trim, { postEvery: 3 }));
  }

  const mounts = [];
  for (const m of def.mounts) {
    let hw;
    if (m.type === 'turret') {
      hw = buildTurret(M, m.scale ?? 1, {
        railgun: m.railgun,
        barrels: m.railgun ? 1 : (m.scale ?? 1) >= 1.2 ? 2 : 1,
      });
    } else if (m.type === 'ciws') {
      hw = buildCiws(M);
    } else if (m.type === 'vls') {
      hw = buildVLS(M, m.cells);
    } else if (m.type === 'tube') {
      hw = buildTubes(M, Math.sign(m.pos[0]) || 1);
    } else {
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

  parts.build(root);

  root.traverse((o) => {
    if (o.isMesh || o.isInstancedMesh) {
      o.castShadow = true;
      o.receiveShadow = true;
      if (o.material) o.material.envMapIntensity = 0.9;
    }
  });

  return { root, mounts, radars, funnels: extra.funnels ?? [], deckY: extra.deckY, materials: M };
}

/** Team colours: a stern flag and hull flashes so friend/foe reads at a glance. */
export function addTeamMarkings(root, def, colorHex) {
  const hull = def.hull;
  const m = new THREE.MeshStandardMaterial({
    color: colorHex,
    emissive: colorHex,
    emissiveIntensity: 0.22,
    roughness: 0.6,
    side: THREE.DoubleSide,
    flatShading: true,
  });
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, 5, 5), mat(0x22262a));
  pole.position.set(0, hull.deck + 2.5, -hull.length * 0.46);
  root.add(pole);
  const flag = new THREE.Mesh(new THREE.PlaneGeometry(4.4, 2.5), m);
  flag.position.set(2.2, hull.deck + 4.1, -hull.length * 0.46);
  root.add(flag);
  // a slim team stripe along the sheer strake, plus the pennant number band
  for (const side of [-1, 1]) {
    const stripe = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.35, hull.length * 0.22), m);
    stripe.position.set(side * (hull.beam * 0.5 + 0.12), hull.deck - 0.35, hull.length * 0.22);
    root.add(stripe);
  }
  return root;
}

/** Small silhouette used by the ship-select screen. */
export function buildPreview(def) {
  const { root, radars } = buildShipMesh(def);
  root.userData.radars = radars;
  return root;
}

export { TAU };
