/**
 * Die Kuppel des Schilds: eine Halbkugel aus Wabenglas um die Spielfigur.
 *
 * Es gibt nur diese eine Kuppel, sie wird beim Bau des Spiels angelegt und im Kampf nur ein- und
 * ausgeblendet. Das Muster liefert der Shader (dreidimensionale Zellen, deren Ränder leuchten),
 * es gibt also keine Textur und kein Netz je Zelle.
 *
 * Lore (Abweichung): In den Magie-Vorlagen ist der Schild eine unsichtbare Fläche. Im Spiel muss man aber sehen,
 * ob er steht, sonst weiß niemand, ob der nächste Treffer abgefangen wird. Darum zeigt er sich als hauchdünnes,
 * kaltes Glas, das am Boden verankert ist (der helle Ring dort gehört zu `Effects.shield`).
 */
import * as THREE from 'three';

/** Halbachsen in Metern: ein Stück weiter als die Figur breit und etwas höher als sie. */
const RADIUS = 1.1;
const HEIGHT = 1.75;
/** Sekunden, in denen die Kuppel vom Boden aus emporwächst, und in denen sie zerfällt. */
const RISE_SECONDS = 0.5;
const BREAK_SECONDS = 0.6;
/** Wie hoch über dem Boden (im Bogenmaß) der Treffer die Kuppel erreicht. */
const HIT_ELEVATION = 0.45;

const vertexShader = /* glsl */ `
  varying vec3 vLocal;
  varying vec3 vNormalView;
  varying vec3 vViewDir;

  void main() {
    vLocal = position;
    vec4 view = modelViewMatrix * vec4(position, 1.0);
    vNormalView = normalize(normalMatrix * normal);
    vViewDir = normalize(-view.xyz);
    gl_Position = projectionMatrix * view;
  }
`;

const fragmentShader = /* glsl */ `
  uniform vec3 uColor;
  uniform vec3 uDims;
  uniform vec3 uHit;
  /** Zeit in Sekunden, Aufstieg 0 bis 1, Zerfall 0 bis 1 (0 = steht), Gesamthelligkeit. */
  uniform vec4 uState;
  varying vec3 vLocal;
  varying vec3 vNormalView;
  varying vec3 vViewDir;

  vec3 hash3(vec3 p) {
    p = vec3(dot(p, vec3(127.1, 311.7, 74.7)), dot(p, vec3(269.5, 183.3, 246.1)), dot(p, vec3(113.5, 271.9, 124.6)));
    return fract(sin(p) * 43758.5453);
  }

  // x: Abstand zum Rand der nächsten Zelle (genauer: F2 - F1), y: eine Zufallszahl je Zelle.
  vec2 cells(vec3 p) {
    vec3 base = floor(p);
    vec3 frac = fract(p);
    float nearest = 8.0;
    float second = 8.0;
    float id = 0.0;
    for (int x = -1; x <= 1; x++) {
      for (int y = -1; y <= 1; y++) {
        for (int z = -1; z <= 1; z++) {
          vec3 corner = vec3(float(x), float(y), float(z));
          vec3 point = hash3(base + corner);
          vec3 offset = corner + point - frac;
          float d = dot(offset, offset);
          if (d < nearest) {
            second = nearest;
            nearest = d;
            id = point.x;
          } else if (d < second) {
            second = d;
          }
        }
      }
    }
    return vec2(sqrt(second) - sqrt(nearest), id);
  }

  void main() {
    float time = uState.x;
    float rise = uState.y;
    float broken = uState.z;
    vec3 unit = vLocal / uDims;
    float h = clamp(unit.y, 0.0, 1.0);

    float facing = abs(dot(normalize(vNormalView), normalize(vViewDir)));
    float rim = pow(1.0 - facing, 2.4);

    // Zellen von etwa vierzig Zentimetern; die Ränder sind die "Waben".
    vec2 cell = cells(vLocal * 2.6 + 11.0);
    float line = 1.0 - smoothstep(0.0, 0.075, cell.x);
    float halo = 1.0 - smoothstep(0.0, 0.32, cell.x);

    // Ein langsamer Schimmer läuft um die Kuppel; einzelne Zellen füllen sich leicht und gehen wieder aus.
    float sweep = pow(0.5 + 0.5 * cos(atan(unit.x, unit.z) - time * 0.9 + h * 2.0), 6.0);
    float flicker = smoothstep(0.55, 1.0, 0.5 + 0.5 * sin(time * 1.3 + cell.y * 40.0)) * step(0.55, cell.y);
    float foot = pow(1.0 - h, 3.0);

    // Die Werte sind Licht vor der Umrechnung in sRGB und deshalb klein: Mehrere Lagen addieren sich sonst zu einem weißen Fleck.
    float glow = 0.002 + rim * 0.035 + line * (0.07 + 0.1 * sweep) + halo * 0.006 + flicker * 0.012 + foot * (0.008 + line * 0.05);
    float hot = 0.0;

    // Aufstieg: Vom Boden her füllt sich die Kuppel; an der Front sind die Zellränder weiß.
    float front = rise * 1.3;
    float revealed = 1.0 - smoothstep(front - 0.1, front, h);
    float toFront = (h - front + 0.05) / 0.07;
    float edge = exp(-toFront * toFront);
    glow += edge * (0.12 + line * 0.5);
    hot += edge * line * 0.12;

    // Treffer: Von der getroffenen Stelle läuft eine Welle über die Kuppel, hinter ihr brechen die Zellen weg.
    float alive = 1.0;
    float shown = 1.0;
    if (broken > 0.0) {
      float away = acos(clamp(dot(normalize(unit), uHit), -1.0, 1.0));
      float toWave = (away - broken * 3.6) / 0.3;
      float wave = exp(-toWave * toWave);
      float spot = exp(-away * away / 0.14) * (1.0 - smoothstep(0.0, 0.4, broken));
      float dieAt = 0.1 + 0.5 * away / 3.6 + 0.25 * cell.y;
      alive = 1.0 - smoothstep(dieAt, dieAt + 0.1, broken);
      glow += wave * (0.06 + halo * 0.25 + line * 0.6) + spot * 0.3;
      hot += wave * line * 0.15 + spot * 0.12;
      shown = 1.0 - smoothstep(0.75, 1.0, broken);
    }

    float back = gl_FrontFacing ? 1.0 : 0.55;
    vec3 color = uColor * glow + vec3(hot);
    gl_FragColor = vec4(color * revealed * alive * shown * back * uState.w, 1.0);
    #include <colorspace_fragment>
  }
`;

type Phase = 'off' | 'rising' | 'up' | 'breaking';

export class ShieldDome {
  readonly mesh: THREE.Mesh;
  private readonly state = new THREE.Vector4(0, 0, 0, 1);
  private readonly hit = new THREE.Vector3(0, 0, 1);
  private phase: Phase = 'off';
  private age = 0;

  constructor(color: number) {
    const geometry = new THREE.SphereGeometry(1, 48, 24, 0, Math.PI * 2, 0, Math.PI / 2);
    geometry.scale(RADIUS, HEIGHT, RADIUS);
    const material = new THREE.ShaderMaterial({
      uniforms: {
        uColor: { value: new THREE.Color(color) },
        uDims: { value: new THREE.Vector3(RADIUS, HEIGHT, RADIUS) },
        uHit: { value: this.hit },
        uState: { value: this.state },
      },
      vertexShader,
      fragmentShader,
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending,
      toneMapped: false,
    });
    this.mesh = new THREE.Mesh(geometry, material);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 3;
    this.mesh.visible = false;
  }

  /** Steht die Kuppel oder wächst sie gerade? Eine zerfallende zählt nicht mehr. */
  get standing(): boolean {
    return this.phase === 'rising' || this.phase === 'up';
  }

  /** Die Kuppel wächst vom Boden empor. */
  raise(): void {
    this.phase = 'rising';
    this.age = 0;
    this.state.z = 0;
    this.mesh.visible = true;
  }

  /** Der Treffer kam aus Richtung `angle` (0 zeigt nach +Z); die Kuppel zerfällt von dort aus. */
  shatter(angle: number): void {
    if (!this.standing) return;
    this.phase = 'breaking';
    this.age = 0;
    this.hit.set(Math.sin(angle) * Math.cos(HIT_ELEVATION), Math.sin(HIT_ELEVATION), Math.cos(angle) * Math.cos(HIT_ELEVATION));
    this.state.y = 1;
  }

  place(x: number, z: number): void {
    this.mesh.position.set(x, 0, z);
  }

  update(dt: number): void {
    if (this.phase === 'off') return;
    this.age += dt;
    this.state.x += dt;
    if (this.phase === 'rising') {
      // Erst schnell, dann ruhiger: Das Glas setzt sich.
      const t = Math.min(1, this.age / RISE_SECONDS);
      this.state.y = 1 - (1 - t) * (1 - t);
      if (t >= 1) this.phase = 'up';
    } else if (this.phase === 'breaking') {
      this.state.z = Math.min(1, this.age / BREAK_SECONDS);
      if (this.state.z >= 1) this.hide();
    }
  }

  reset(): void {
    this.hide();
  }

  private hide(): void {
    this.phase = 'off';
    this.mesh.visible = false;
    this.state.z = 0;
  }
}
