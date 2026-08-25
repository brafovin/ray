import * as THREE from 'three';
import { EffectComposer } from '../vendor/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from '../vendor/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from '../vendor/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from '../vendor/jsm/postprocessing/OutputPass.js';

export const QUALITY = ['Hoch', 'Mittel', 'Niedrig'];

/**
 * Rendering pipeline: HDR scene pass -> bloom -> tone mapping.
 * Quality levels trade shadows, bloom and resolution for frame rate.
 */
export class Renderer {
  constructor(canvas) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 0.92;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.quality = 0;
  }

  attach(scene, camera) {
    this.scene = scene;
    this.camera = camera;
    this.composer = new EffectComposer(this.renderer);
    this.composer.addPass(new RenderPass(scene, camera));
    this.bloom = new UnrealBloomPass(new THREE.Vector2(innerWidth, innerHeight), 0.5, 0.5, 1.15);
    this.composer.addPass(this.bloom);
    this.composer.addPass(new OutputPass());
    this.setQuality(0);
  }

  /** Build an image-based lighting probe straight from the sky dome. */
  environmentFrom(skyMesh) {
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    pmrem.compileEquirectangularShader();
    const skyScene = new THREE.Scene();
    const clone = skyMesh.clone();
    skyScene.add(clone);
    const rt = pmrem.fromScene(skyScene, 0, 1, 20000);
    pmrem.dispose();
    return rt.texture;
  }

  setQuality(q) {
    this.quality = (q + QUALITY.length) % QUALITY.length;
    const high = this.quality === 0;
    const mid = this.quality === 1;
    this.renderer.shadowMap.enabled = high || mid;
    this.renderer.shadowMap.needsUpdate = true;
    this.bloomOn = high || mid;
    this.bloom.strength = high ? 0.5 : 0.34;
    this.bloom.enabled = this.bloomOn;
    const cap = high ? 2 : mid ? 1.5 : 1;
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, cap));
    this.resize();
    return QUALITY[this.quality];
  }

  resize() {
    const w = innerWidth;
    const h = innerHeight;
    this.renderer.setSize(w, h, false);
    if (this.composer) this.composer.setSize(w, h);
    if (this.bloom) this.bloom.resolution.set(w, h);
  }

  render() {
    if (this.bloomOn) this.composer.render();
    else this.renderer.render(this.scene, this.camera);
  }
}
