import * as THREE from 'three';
import { mergeGeometries } from '../vendor/jsm/utils/BufferGeometryUtils.js';

/**
 * Collects hundreds of small deck fittings and merges them per material, so a
 * heavily detailed ship still costs only a handful of draw calls.
 */
export class Parts {
  constructor() {
    this.buckets = new Map();
    this._m = new THREE.Matrix4();
    this._q = new THREE.Quaternion();
    this._e = new THREE.Euler();
    this._p = new THREE.Vector3();
    this._s = new THREE.Vector3();
  }

  /** add(geometry, material, [x,y,z], [rx,ry,rz], scale|[sx,sy,sz]) */
  add(geo, mat, pos = [0, 0, 0], rot = [0, 0, 0], scale = 1) {
    const list = this.buckets.get(mat) ?? [];
    if (!list.length) this.buckets.set(mat, list);
    this._e.set(rot[0], rot[1], rot[2]);
    this._q.setFromEuler(this._e);
    this._p.set(pos[0], pos[1], pos[2]);
    const s = Array.isArray(scale) ? scale : [scale, scale, scale];
    this._s.set(s[0], s[1], s[2]);
    this._m.compose(this._p, this._q, this._s);
    const g = geo.clone().applyMatrix4(this._m);
    g.deleteAttribute('uv1');
    list.push(g);
    return this;
  }

  /** Mirror a fitting to both sides of the centreline. */
  addPair(geo, mat, pos, rot = [0, 0, 0], scale = 1) {
    this.add(geo, mat, pos, rot, scale);
    this.add(geo, mat, [-pos[0], pos[1], pos[2]], [rot[0], -rot[1], -rot[2]], scale);
    return this;
  }

  build(root) {
    for (const [mat, list] of this.buckets) {
      if (!list.length) continue;
      const merged = list.length === 1 ? list[0] : mergeGeometries(list, false);
      if (!merged) continue;
      merged.computeBoundingSphere();
      const mesh = new THREE.Mesh(merged, mat);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      root.add(mesh);
      for (const g of list) if (g !== merged) g.dispose();
    }
    this.buckets.clear();
    return root;
  }
}

/**
 * Deck railings: two wire strips plus stanchions, built as one geometry each.
 * `points` is the deck outline in XZ, `y` the deck height.
 */
export function railings(points, y, railMat, postMat, opts = {}) {
  const heights = opts.heights ?? [0.45, 0.95];
  const thickness = 0.05;
  const group = new THREE.Group();

  const pos = [];
  const idx = [];
  let v = 0;
  for (let i = 0; i < points.length - 1; i++) {
    const a = points[i];
    const b = points[i + 1];
    const dx = b.x - a.x;
    const dz = b.z - a.z;
    const len = Math.hypot(dx, dz);
    if (len < 0.001) continue;
    const nx = -dz / len;
    const nz = dx / len;
    for (const h of heights) {
      // a thin quad standing along the segment
      pos.push(
        a.x + nx * thickness, y + h - thickness, a.z + nz * thickness,
        b.x + nx * thickness, y + h - thickness, b.z + nz * thickness,
        b.x - nx * thickness, y + h + thickness, b.z - nz * thickness,
        a.x - nx * thickness, y + h + thickness, a.z - nz * thickness
      );
      idx.push(v, v + 1, v + 2, v, v + 2, v + 3);
      v += 4;
    }
  }
  if (pos.length) {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setIndex(idx);
    geo.computeVertexNormals();
    const rails = new THREE.Mesh(geo, railMat);
    rails.castShadow = false;
    group.add(rails);
  }

  const postGeo = new THREE.BoxGeometry(0.09, heights[heights.length - 1] + 0.1, 0.09);
  const every = opts.postEvery ?? 2;
  const count = Math.max(1, Math.floor((points.length - 1) / every));
  const posts = new THREE.InstancedMesh(postGeo, postMat, count);
  const m = new THREE.Matrix4();
  let n = 0;
  for (let i = 0; i < points.length - 1 && n < count; i += every) {
    const p = points[i];
    m.makeTranslation(p.x, y + (heights[heights.length - 1] + 0.1) / 2, p.z);
    posts.setMatrixAt(n++, m);
  }
  posts.count = n;
  posts.castShadow = false;
  group.add(posts);
  return group;
}
