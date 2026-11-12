import * as THREE from 'three';
import { CONFIG } from '../config';
import { createRandom } from '../core/random';

const COUNT = 900;
const BOX = new THREE.Vector3(30, 3.5, 30);
const WHITE = new THREE.Color(0xffffff);

const vertexShader = /* glsl */ `
  uniform vec3 uCenter;
  uniform vec3 uBox;
  uniform float uTime;
  uniform float uRadius;
  uniform float uPixelScale;
  attribute vec3 aSeed;
  varying float vAlpha;

  void main() {
    vec3 drifted = position + vec3(0.55, 0.0, 0.2) * uTime * (0.5 + aSeed.x);
    drifted.y += sin(uTime * 0.4 + aSeed.y * 6.2832) * 0.25;

    // Um die Lichtquelle herum umbrechen: Der Staub wirkt ortsfest, die Wolke wandert mit.
    vec2 offset = mod(drifted.xz - uCenter.xz + 0.5 * uBox.xz, uBox.xz) - 0.5 * uBox.xz;
    vec3 world = vec3(uCenter.x + offset.x, 0.15 + mod(drifted.y, uBox.y), uCenter.z + offset.y);

    // Staub ist nur im Schein der Lichtquelle zu sehen.
    float inLight = 1.0 - smoothstep(uRadius * 0.1, uRadius * 0.75, length(offset));
    vAlpha = inLight * (0.15 + 0.45 * aSeed.z);

    vec4 viewPosition = viewMatrix * vec4(world, 1.0);
    gl_Position = projectionMatrix * viewPosition;
    gl_PointSize = max(1.5, uPixelScale * (0.03 + 0.05 * aSeed.z) / -viewPosition.z);
  }
`;

const fragmentShader = /* glsl */ `
  uniform vec3 uColor;
  varying float vAlpha;

  void main() {
    float fromCenter = length(gl_PointCoord - 0.5);
    float alpha = (1.0 - smoothstep(0.1, 0.5, fromCenter)) * vAlpha;
    gl_FragColor = vec4(uColor, alpha);
    #include <colorspace_fragment>
  }
`;

/** Schwebende Staubkörner im Lichtschein der Spielfigur. */
export class Dust {
  readonly points: THREE.Points;
  private readonly uniforms = {
    uCenter: { value: new THREE.Vector3() },
    uBox: { value: BOX },
    uTime: { value: 0 },
    uRadius: { value: CONFIG.torch.radius as number },
    uPixelScale: { value: 1 },
    uColor: { value: new THREE.Color(0xffc48a) },
  };

  constructor() {
    const random = createRandom(CONFIG.world.seed + 1);
    const positions = new Float32Array(COUNT * 3);
    const seeds = new Float32Array(COUNT * 3);
    for (let i = 0; i < COUNT; i++) {
      positions[i * 3] = random() * BOX.x;
      positions[i * 3 + 1] = random() * BOX.y;
      positions[i * 3 + 2] = random() * BOX.z;
      seeds[i * 3] = random();
      seeds[i * 3 + 1] = random();
      seeds[i * 3 + 2] = random();
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('aSeed', new THREE.BufferAttribute(seeds, 3));

    this.points = new THREE.Points(
      geometry,
      new THREE.ShaderMaterial({
        uniforms: this.uniforms,
        vertexShader,
        fragmentShader,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        toneMapped: false,
      }),
    );
    // Die Positionen entstehen erst im Shader, die Geometrie taugt nicht zum Aussortieren.
    this.points.frustumCulled = false;
  }

  update(time: number, center: THREE.Vector3, lightRadius: number): void {
    this.uniforms.uTime.value = time;
    this.uniforms.uCenter.value.copy(center);
    this.uniforms.uRadius.value = lightRadius;
  }

  /** Der Staub leuchtet in der Farbe der Lichtquelle: warm bei der Fackel, kalt beim Kerzenwort. */
  setLightColor(color: number): void {
    this.uniforms.uColor.value.set(color).lerp(WHITE, 0.35);
  }

  /** Hält die Körner unabhängig von Auflösung und Blickwinkel gleich groß. */
  resize(pixelHeight: number, fovDegrees: number): void {
    this.uniforms.uPixelScale.value =
      (pixelHeight * 0.5) / Math.tan(THREE.MathUtils.degToRad(fovDegrees) / 2);
  }
}
