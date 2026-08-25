import * as THREE from 'three';
import { ShaderPass } from '../vendor/jsm/postprocessing/ShaderPass.js';

/**
 * Final look pass: gentle colour grade, vignette, sensor grain, a touch of
 * chromatic aberration at the edges and a sun glare when you look into it.
 */
export const GradeShader = {
  name: 'GradeShader',
  uniforms: {
    tDiffuse: { value: null },
    uTime: { value: 0 },
    uSun: { value: new THREE.Vector3(0.5, 0.5, 1) },   // xy = screen pos, z = visible
    uVignette: { value: 0.32 },
    uGrain: { value: 0.035 },
    uAberration: { value: 0.0016 },
    uSaturation: { value: 1.12 },
    uContrast: { value: 1.06 },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }`,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform float uTime, uVignette, uGrain, uAberration, uSaturation, uContrast;
    uniform vec3 uSun;
    varying vec2 vUv;

    float hash(vec2 p) {
      return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
    }

    void main() {
      vec2 uv = vUv;
      vec2 c = uv - 0.5;
      float r2 = dot(c, c);

      // chromatic aberration grows towards the corners
      float a = uAberration * r2 * 4.0;
      vec3 col;
      col.r = texture2D(tDiffuse, uv + c * a).r;
      col.g = texture2D(tDiffuse, uv).g;
      col.b = texture2D(tDiffuse, uv - c * a).b;

      // sun glare: a soft halo plus an anamorphic streak
      if (uSun.z > 0.0) {
        vec2 d = uv - uSun.xy;
        d.x *= 1.7;
        float dist = length(d);
        float halo = exp(-dist * 7.0) * 0.55 + exp(-dist * 2.2) * 0.12;
        float streak = exp(-abs(d.y) * 90.0) * exp(-abs(d.x) * 2.6) * 0.35;
        col += vec3(1.0, 0.86, 0.66) * (halo + streak) * uSun.z;
      }

      // grade
      float l = dot(col, vec3(0.2126, 0.7152, 0.0722));
      col = mix(vec3(l), col, uSaturation);
      col = (col - 0.5) * uContrast + 0.5;
      col *= mix(vec3(0.98, 0.99, 1.03), vec3(1.03, 1.0, 0.95), l);   // cool shadows, warm highs

      // vignette + grain
      col *= 1.0 - uVignette * r2 * 1.9;
      col += (hash(uv * 900.0 + fract(uTime) * 100.0) - 0.5) * uGrain;

      gl_FragColor = vec4(max(col, 0.0), 1.0);
    }`,
};

export function makeGradePass() {
  const pass = new ShaderPass(GradeShader);
  pass.material.toneMapped = false;
  return pass;
}
