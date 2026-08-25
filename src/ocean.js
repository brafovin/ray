import * as THREE from 'three';
import { WAVE_GLSL } from './math.js';

/**
 * A single huge plane that follows the camera. The vertex stage displaces it
 * with the shared wave model, the fragment stage re-derives the normal per
 * pixel so small ripples survive far past the tessellation limit.
 */
export function createOcean() {
  const size = 9000;
  const geo = new THREE.PlaneGeometry(size, size, 320, 320);
  geo.rotateX(-Math.PI / 2);

  const uniforms = {
    uTime: { value: 0 },
    uOffset: { value: new THREE.Vector2() },
    uDeep: { value: new THREE.Color(0x0a3a58) },
    uShallow: { value: new THREE.Color(0x35a6c9) },
    uFoam: { value: new THREE.Color(0xcfeaf3) },
  };

  const mat = new THREE.MeshStandardMaterial({
    color: 0x1d6b8d,
    roughness: 0.13,
    metalness: 0.02,
  });

  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);

    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
        uniform float uTime;
        uniform vec2 uOffset;
        varying vec2 vWorldXZ;
        varying float vWaveH;
        ${WAVE_GLSL}`
      )
      .replace(
        '#include <beginnormal_vertex>',
        `vec2 wxz = position.xz + uOffset;
         vec3 objectNormal = waveNormal(wxz, uTime);`
      )
      .replace(
        '#include <begin_vertex>',
        `float wh = waveHeight(wxz, uTime);
         vec3 transformed = vec3(position.x, position.y + wh, position.z);
         vWorldXZ = wxz;
         vWaveH = wh;`
      );

    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
        uniform float uTime;
        uniform vec3 uDeep;
        uniform vec3 uShallow;
        uniform vec3 uFoam;
        varying vec2 vWorldXZ;
        varying float vWaveH;
        ${WAVE_GLSL}`
      )
      .replace(
        '#include <normal_fragment_begin>',
        `#include <normal_fragment_begin>
         vec3 wNormal = waveNormal(vWorldXZ, uTime);
         normal = normalize((viewMatrix * vec4(wNormal, 0.0)).xyz);`
      )
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
         float crest = smoothstep(0.55, 1.45, vWaveH);
         float steep = smoothstep(0.55, 1.0, 1.0 - waveNormal(vWorldXZ, uTime).y);
         vec3 water = mix(uDeep, uShallow, smoothstep(-1.2, 1.2, vWaveH));
         diffuseColor.rgb *= 0.0;
         diffuseColor.rgb += mix(water, uFoam, clamp(crest * 0.35 + steep * 0.9, 0.0, 0.75));`
      );
  };

  mat.envMapIntensity = 0.55;

  const mesh = new THREE.Mesh(geo, mat);
  mesh.frustumCulled = false;
  mesh.receiveShadow = true;
  mesh.renderOrder = -1;

  return {
    mesh,
    /** Keep the plane under the camera, snapped so the waves never swim. */
    update(time, camera) {
      uniforms.uTime.value = time;
      const step = 200;
      const px = Math.round(camera.position.x / step) * step;
      const pz = Math.round(camera.position.z / step) * step;
      mesh.position.set(px, 0, pz);
      uniforms.uOffset.value.set(px, pz);
    },
  };
}
