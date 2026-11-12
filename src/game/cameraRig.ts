import * as THREE from 'three';
import { CONFIG } from '../config';

/** Schräge Draufsicht, die der Spielfigur weich folgt. */
export class CameraRig {
  readonly camera = new THREE.PerspectiveCamera(CONFIG.camera.fov, 1, 0.5, 200);
  private readonly focus = new THREE.Vector3();

  snapTo(target: THREE.Vector3): void {
    this.focus.copy(target);
    this.place();
  }

  update(dt: number, target: THREE.Vector3): void {
    this.focus.lerp(target, 1 - Math.exp(-CONFIG.camera.followSharpness * dt));
    this.place();
  }

  resize(aspect: number): void {
    this.camera.aspect = aspect;
    this.camera.updateProjectionMatrix();
  }

  private place(): void {
    const { x, y, z } = CONFIG.camera.offset;
    this.camera.position.set(this.focus.x + x, y, this.focus.z + z);
    this.camera.lookAt(this.focus.x, 1, this.focus.z);
  }
}
