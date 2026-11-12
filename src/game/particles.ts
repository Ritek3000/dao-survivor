import * as THREE from 'three';
import { finsternisUniforms } from './darkness';

/** Was ein einzelnes Teilchen beim Entstehen mitbekommt. Einheiten: Meter und Sekunden. */
export interface Particle {
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  life: number;
  size: number;
  /** Zuwachs der Größe je Sekunde. */
  grow: number;
  /** Fallbeschleunigung; negativ lässt das Teilchen steigen. */
  gravity: number;
  /** Anteil der Geschwindigkeit, der je Sekunde verloren geht. */
  drag: number;
  color: THREE.Color;
  alpha: number;
}

const vertexShader = /* glsl */ `
  uniform float uPixelScale;
  uniform vec2 uViewer;
  uniform float uLightRadius;
  uniform vec3 uLightTint;
  attribute vec4 aColor;
  attribute float aSize;
  varying vec4 vColor;

  void main() {
    vColor = aColor;
    #ifdef LIT
      // Staub leuchtet nicht selbst: Er ist nur so hell wie der Schein, in dem er hängt, und hat dessen Farbe.
      float inLight = 1.0 - smoothstep(uLightRadius * 0.15, uLightRadius, distance(position.xz, uViewer));
      vColor.rgb *= uLightTint * (0.06 + 0.94 * inLight);
    #endif
    vec4 viewPosition = viewMatrix * vec4(position, 1.0);
    gl_Position = projectionMatrix * viewPosition;
    gl_PointSize = uPixelScale * aSize / -viewPosition.z;
  }
`;

const fragmentShader = /* glsl */ `
  varying vec4 vColor;

  void main() {
    float fromCenter = length(gl_PointCoord - 0.5) * 2.0;
    #ifdef LIT
      float shape = 1.0 - smoothstep(0.15, 1.0, fromCenter);
      gl_FragColor = vec4(vColor.rgb, vColor.a * shape);
    #else
      // Heller Kern mit weichem Hof; die Deckkraft steckt in der Farbe, weil addiert wird.
      float shape = pow(max(0.0, 1.0 - fromCenter), 1.8);
      gl_FragColor = vec4(vColor.rgb * vColor.a * shape, 1.0);
    #endif
    #include <colorspace_fragment>
  }
`;

/**
 * Ein Vorrat kurzlebiger Teilchen in einem Zeichenaufruf.
 * 'glow' addiert Licht (Funken, Glut, angestrahlter Staub im Strahl),
 * 'dust' deckt (Staubwolken, Erde) und ist nur im Schein der Lichtquelle zu sehen.
 */
export class Particles {
  readonly points: THREE.Points;
  private readonly positions: Float32Array;
  private readonly colors: Float32Array;
  private readonly sizes: Float32Array;
  private readonly velocities: Float32Array;
  /** Je Teilchen: Alter, Lebensdauer, Zuwachs, Fallbeschleunigung, Widerstand, Deckkraft. */
  private readonly state: Float32Array;
  private readonly geometry = new THREE.BufferGeometry();
  private readonly uniforms = {
    uPixelScale: { value: 1 },
    uViewer: finsternisUniforms.uViewer,
    uLightRadius: { value: 14 },
    uLightTint: { value: new THREE.Color(1, 1, 1) },
  };
  private count = 0;

  constructor(
    private readonly capacity: number,
    kind: 'glow' | 'dust',
  ) {
    this.positions = new Float32Array(capacity * 3);
    this.colors = new Float32Array(capacity * 4);
    this.sizes = new Float32Array(capacity);
    this.velocities = new Float32Array(capacity * 3);
    this.state = new Float32Array(capacity * 6);
    for (const [name, array, itemSize] of [
      ['position', this.positions, 3],
      ['aColor', this.colors, 4],
      ['aSize', this.sizes, 1],
    ] as const) {
      const attribute = new THREE.BufferAttribute(array, itemSize);
      attribute.setUsage(THREE.DynamicDrawUsage);
      this.geometry.setAttribute(name, attribute);
    }
    this.geometry.setDrawRange(0, 0);

    this.points = new THREE.Points(
      this.geometry,
      new THREE.ShaderMaterial({
        uniforms: this.uniforms,
        defines: kind === 'dust' ? { LIT: '' } : {},
        vertexShader,
        fragmentShader,
        transparent: true,
        depthWrite: false,
        blending: kind === 'glow' ? THREE.AdditiveBlending : THREE.NormalBlending,
        toneMapped: false,
      }),
    );
    this.points.frustumCulled = false;
    // Leuchtendes zuletzt, damit es nicht hinter einer Staubwolke verschwindet.
    this.points.renderOrder = kind === 'glow' ? 4 : 2;
  }

  reset(): void {
    this.count = 0;
    this.geometry.setDrawRange(0, 0);
  }

  spawn(particle: Particle): void {
    // Ist der Vorrat voll, weicht irgendein Teilchen.
    const index = this.count < this.capacity ? this.count++ : Math.floor(Math.random() * this.capacity);
    this.positions.set([particle.x, particle.y, particle.z], index * 3);
    this.velocities.set([particle.vx, particle.vy, particle.vz], index * 3);
    this.colors.set([particle.color.r, particle.color.g, particle.color.b, 0], index * 4);
    this.sizes[index] = particle.size;
    this.state.set([0, particle.life, particle.grow, particle.gravity, particle.drag, particle.alpha], index * 6);
  }

  update(dt: number, lightRadius: number, lightTint: THREE.Color): void {
    this.uniforms.uLightRadius.value = lightRadius;
    this.uniforms.uLightTint.value.copy(lightTint);
    const { positions, velocities, colors, sizes, state } = this;
    for (let i = this.count - 1; i >= 0; i--) {
      const s = i * 6;
      const age = (state[s] as number) + dt;
      const life = state[s + 1] as number;
      if (age >= life) {
        // Das letzte Teilchen rückt in die Lücke.
        const last = --this.count;
        if (last !== i) {
          positions.copyWithin(i * 3, last * 3, last * 3 + 3);
          velocities.copyWithin(i * 3, last * 3, last * 3 + 3);
          colors.copyWithin(i * 4, last * 4, last * 4 + 4);
          sizes[i] = sizes[last] as number;
          state.copyWithin(s, last * 6, last * 6 + 6);
        }
        continue;
      }
      state[s] = age;
      const p = i * 3;
      const slowed = Math.max(0, 1 - (state[s + 4] as number) * dt);
      const vx = (velocities[p] as number) * slowed;
      const vy = ((velocities[p + 1] as number) - (state[s + 3] as number) * dt) * slowed;
      const vz = (velocities[p + 2] as number) * slowed;
      velocities[p] = vx;
      velocities[p + 1] = vy;
      velocities[p + 2] = vz;
      positions[p] = (positions[p] as number) + vx * dt;
      // Nichts fällt durch den Boden.
      positions[p + 1] = Math.max(0.03, (positions[p + 1] as number) + vy * dt);
      positions[p + 2] = (positions[p + 2] as number) + vz * dt;
      sizes[i] = Math.max(0, (sizes[i] as number) + (state[s + 2] as number) * dt);
      // Schnell da, langsam fort.
      const t = age / life;
      colors[i * 4 + 3] = (state[s + 5] as number) * Math.min(1, t * 8) * (1 - t) * (1 - t);
    }
    this.geometry.setDrawRange(0, this.count);
    for (const name of ['position', 'aColor', 'aSize']) {
      const attribute = this.geometry.getAttribute(name) as THREE.BufferAttribute;
      attribute.needsUpdate = true;
    }
  }

  /** Hält die Teilchen unabhängig von Auflösung und Blickwinkel gleich groß. */
  resize(pixelHeight: number, fovDegrees: number): void {
    this.uniforms.uPixelScale.value = (pixelHeight * 0.5) / Math.tan(THREE.MathUtils.degToRad(fovDegrees) / 2);
  }
}
