/**
 * Flächen-Effekte aus dem Shader: Hiebspuren, Ringe, Flammen, Strahlen, Risse und flimmernde Luft.
 *
 * Alle teilen sich ein Gitter, das erst im Shader in Form gebogen wird: zu einem Bogen oder Ring
 * am Boden, zu einem aufrechten Band um einen Mittelpunkt oder zu einem geraden Streifen.
 * So kostet jede Form nur einen Satz Zahlen, und ein Ring kann wachsen, ohne neu gebaut zu werden.
 */
import * as THREE from 'three';
import { finsternisUniforms } from './darkness';

export type StripLook =
  /** Hiebspur: eine helle Kante, die den Bogen von links nach rechts durchläuft. */
  | 'slash'
  /** Leuchtender Ring. */
  | 'ring'
  /** Aufgewirbelter Staub am Boden, nur im Lichtschein zu sehen. */
  | 'dustring'
  /** Mehrere Ringe, die nacheinander nach außen laufen. */
  | 'pulse'
  /** Aufrechtes Flammenband. */
  | 'fire'
  /** Weicher Lichtschein auf dem Boden, in der Mitte am hellsten. */
  | 'glow'
  /** Windfahnen, die nach außen jagen. */
  | 'gust'
  /** Weißer Lichtstoß. */
  | 'flare'
  /** Heller Ring aus gestreutem Licht, der über den Boden nach außen läuft. */
  | 'lichtwelle'
  /** Glutbrocken am Boden: ein gebrochener, rot bis gelb glühender Ring. */
  | 'glut'
  /** Risse im Boden. */
  | 'crack'
  /** Aufrechter, kaum sichtbarer Schleier. */
  | 'veil'
  /** Gerader Lichtstrahl. */
  | 'lance'
  /** Der Schein eines Strahls auf dem Boden unter ihm. */
  | 'lancelight'
  /** Flimmernde Luft entlang einer Strecke. */
  | 'heat'
  /** Druckwelle: ein Ring, der das Bild dahinter verzieht. */
  | 'shock'
  /** Aufrechte Fläche, hinter der die Luft flimmert. */
  | 'shimmer'
  /** Schwarzer Sog: Staub, der über den Boden zur Mitte strömt und ihn verdunkelt. */
  | 'sogfeld'
  /** Kalter Rand des Sogs; ein zweiter Ring zieht sich bis zur Wirkung zur Mitte zusammen. */
  | 'sogrand'
  /** Angekündigte Bahn eines Ansturms: kalte Kanten und Winkel, die in Laufrichtung ziehen. */
  | 'bahn';

export interface StripSpec {
  look: StripLook;
  x: number;
  z: number;
  /** Blickrichtung des Bogens (0 zeigt nach +Z); bei geraden Streifen die Richtung. */
  angle?: number;
  /** Öffnungswinkel in Radiant, ohne Angabe ein voller Kreis; bei geraden Streifen die Breite in Metern. */
  width?: number;
  /** Innen- und Außenradius zu Beginn; bei geraden Streifen Anfang und Ende. */
  inner: number;
  outer: number;
  /** Radien am Ende der Lebensdauer; ohne Angabe bleibt die Form stehen. */
  innerTo?: number;
  outerTo?: number;
  /** Höhe über dem Boden und, bei aufrechten Bändern, deren Höhe. */
  y?: number;
  span?: number;
  color?: number;
  opacity?: number;
  /** Sekunden bis zum Verschwinden; Infinity bleibt, bis `release` gerufen wird. */
  life: number;
}

/** Ein laufender Effekt. Wer ihn festhält, darf Ort und Deckkraft nachführen. */
export interface Strip {
  x: number;
  z: number;
  angle: number;
  opacity: number;
  age: number;
  life: number;
  /** Sekunden, über die ein festgehaltener Effekt ausklingt; 0, solange er gehalten wird. */
  fadeOut: number;
  /** Fortschritt, bei dem ein abgebrochener Effekt stehen bleibt, während er ausklingt. */
  held: number;
  readonly spec: StripSpec;
  readonly mesh: THREE.Mesh;
  readonly uniforms: StripUniforms;
}

interface StripUniforms {
  /** x, z, Winkel, Öffnung bzw. Breite. */
  uShape: { value: THREE.Vector4 };
  /** Innenradius, Außenradius, Höhe über dem Boden, Höhe des Bands. */
  uExtent: { value: THREE.Vector4 };
  /** Fortschritt 0 bis 1, Deckkraft, Zufallswert, Alter in Sekunden. */
  uLife: { value: THREE.Vector4 };
  uColor: { value: THREE.Color };
}

const NOISE = /* glsl */ `
  float hash(vec2 p) {
    return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
  }
  float noise(vec2 p) {
    vec2 cell = floor(p);
    vec2 f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    return mix(
      mix(hash(cell), hash(cell + vec2(1.0, 0.0)), f.x),
      mix(hash(cell + vec2(0.0, 1.0)), hash(cell + vec2(1.0, 1.0)), f.x),
      f.y
    );
  }
  float fbm(vec2 p) {
    return 0.55 * noise(p) + 0.3 * noise(p * 2.1 + 7.3) + 0.15 * noise(p * 4.3 + 1.7);
  }
`;

const vertexShader = /* glsl */ `
  uniform vec4 uShape;
  uniform vec4 uExtent;
  varying vec2 vUv;
  varying vec2 vWorld;
  varying vec2 vPush;

  void main() {
    vUv = uv;
    vec3 world = vec3(uShape.x, uExtent.z, uShape.y);
    vec2 outward;
    #ifdef STRAIGHT
      outward = vec2(sin(uShape.z), cos(uShape.z));
      vec2 side = vec2(outward.y, -outward.x);
      world.xz += outward * mix(uExtent.x, uExtent.y, uv.y) + side * (uv.x - 0.5) * uShape.w;
    #else
      float theta = uShape.z + (0.5 - uv.x) * uShape.w;
      outward = vec2(sin(theta), cos(theta));
      #ifdef UPRIGHT
        world.xz += outward * uExtent.y;
        world.y += uv.y * uExtent.w;
      #else
        world.xz += outward * mix(uExtent.x, uExtent.y, uv.y);
      #endif
    #endif
    vWorld = world.xz;
    gl_Position = projectionMatrix * viewMatrix * vec4(world, 1.0);
    // Wohin "nach außen" auf dem Bildschirm zeigt: Dorthin drückt eine Druckwelle das Bild.
    vec4 further = projectionMatrix * viewMatrix * vec4(world + vec3(outward.x, 0.0, outward.y) * 0.5, 1.0);
    vPush = further.xy / further.w - gl_Position.xy / gl_Position.w;
  }
`;

const FRAGMENT_HEAD = /* glsl */ `
  uniform vec4 uShape;
  uniform vec4 uExtent;
  uniform vec4 uLife;
  uniform vec3 uColor;
  uniform vec2 uViewer;
  uniform float uLightRadius;
  uniform vec3 uLightTint;
  uniform sampler2D uScene;
  uniform vec2 uResolution;
  varying vec2 vUv;
  varying vec2 vWorld;
  varying vec2 vPush;
  ${NOISE}

  // Addiertes Licht: Die Deckkraft steckt in der Farbe.
  void emit(vec3 color) {
    gl_FragColor = vec4(color * uLife.y, 1.0);
  }
  // Was nicht selbst leuchtet, ist nur im Schein der Lichtquelle zu sehen und nimmt deren Farbe an.
  vec3 lit() {
    return uLightTint * (0.05 + 0.95 * (1.0 - smoothstep(uLightRadius * 0.15, uLightRadius, distance(vWorld, uViewer))));
  }
  // Das Bild hinter der Fläche, um 'offset' verschoben.
  vec3 behind(vec2 offset) {
    return texture2D(uScene, gl_FragCoord.xy / uResolution + offset).rgb;
  }
`;

interface LookDef {
  body: string;
  defines?: Record<string, string>;
  /** 'add' = Licht, 'cover' = deckend, 'warp' = verzieht das Bild dahinter. */
  mode: 'add' | 'cover' | 'warp';
}

const LOOKS: Record<StripLook, LookDef> = {
  slash: {
    mode: 'add',
    body: /* glsl */ `
      float p = uLife.x;
      // Die Kante ist beim Erscheinen schon ein Stück im Bogen: Der Hieb hat da bereits begonnen.
      float front = 0.3 + p * 1.9;
      float past = front - vUv.x;
      float trail = smoothstep(0.0, 0.035, past) * exp(-past * 3.2);
      float streak = 0.5 + 0.5 * noise(vec2(vUv.y * 26.0 + uLife.z * 9.0, vUv.x * 2.0));
      float body = smoothstep(0.0, 0.7, vUv.y) * (1.0 - smoothstep(0.82, 1.0, vUv.y));
      float edge = pow(smoothstep(0.55, 0.9, vUv.y) * (1.0 - smoothstep(0.9, 1.0, vUv.y)), 1.5);
      float ends = smoothstep(0.0, 0.1, vUv.x) * (1.0 - smoothstep(0.88, 1.0, vUv.x));
      float fade = 1.0 - smoothstep(0.35, 1.0, p);
      float glow = (body * streak * 0.55 + edge) * trail * ends * fade;
      emit(mix(uColor, vec3(1.0), edge * trail) * glow);
    `,
  },
  ring: {
    mode: 'add',
    body: /* glsl */ `
      float band = pow(sin(vUv.y * 3.14159), 1.5);
      float grain = 0.55 + 0.45 * noise(vec2(vUv.x * uShape.w * 9.0 + uLife.z * 20.0, uLife.w * 3.0));
      float fade = (1.0 - uLife.x) * (1.0 - uLife.x);
      emit(uColor * band * grain * fade);
    `,
  },
  dustring: {
    mode: 'cover',
    body: /* glsl */ `
      float band = pow(sin(vUv.y * 3.14159), 1.3);
      float grain = fbm(vec2(vUv.x * uShape.w * 5.0 + uLife.z * 20.0, vUv.y * 2.0 - uLife.w * 1.5));
      float fade = (1.0 - uLife.x) * (1.0 - uLife.x);
      gl_FragColor = vec4(uColor * lit(), band * smoothstep(0.25, 0.7, grain) * fade * uLife.y);
    `,
  },
  pulse: {
    mode: 'add',
    body: /* glsl */ `
      float glow = 0.0;
      for (int k = 0; k < 3; k++) {
        float radius = uLife.x * 1.3 - float(k) * 0.2;
        float line = smoothstep(0.035, 0.0, abs(vUv.y - radius));
        glow += line * step(0.0, radius) * (1.0 - smoothstep(0.7, 1.0, radius));
      }
      glow *= 0.65 + 0.35 * noise(vec2(vUv.x * 44.0, uLife.w * 7.0 + uLife.z));
      emit(uColor * glow);
    `,
  },
  fire: {
    mode: 'add',
    defines: { UPRIGHT: '' },
    body: /* glsl */ `
      // Entlang des Rings in Metern rechnen, damit Flammen in jedem Radius gleich breit sind.
      float m = vUv.x * uShape.w * uExtent.y;
      // Zungen: Jede Zelle (knapp einen Meter) trägt eine Flamme eigener Höhe, die sich im Wind wiegt.
      float u = m / 0.85 + uLife.z * 50.0;
      float id = floor(u);
      float across = fract(u) - 0.5;
      float sway = (noise(vec2(vUv.y * 2.5 - uLife.w * 2.2, id * 1.7)) - 0.5) * 0.8 * vUv.y;
      float height = 0.25 + 0.75 * noise(vec2(id * 3.1, uLife.w * 1.1));
      float y = vUv.y / height;
      // Dreieck, das zur Spitze schmaler wird; am Fuß berühren sich die Nachbarn und bilden ein Glutbett.
      float inside = 1.0 - y - abs(across + sway) * 1.7 * (0.35 + y);
      float flame = fbm(vec2(m * 2.3 + uLife.z * 30.0, vUv.y * 1.8 - uLife.w * 2.4));
      float shape = inside + (flame - 0.5) * 0.55;
      float glow = smoothstep(0.0, 0.2, shape) * smoothstep(0.0, 0.05, vUv.y);
      vec3 hot = mix(vec3(0.75, 0.1, 0.01), vec3(1.0, 0.7, 0.22), smoothstep(0.05, 0.5, shape));
      // Am Fuß, wo die Glut liegt, brennt es weißgelb.
      hot = mix(hot, vec3(1.0, 0.86, 0.5), smoothstep(0.2, 0.0, vUv.y) * 0.6);
      emit(hot * uColor * glow * 0.9);
    `,
  },
  glut: {
    mode: 'add',
    body: /* glsl */ `
      float m = vUv.x * uShape.w * uExtent.y;
      float band = sin(vUv.y * 3.14159);
      // Brocken: Das Glühen reißt auf, wo das Rauschen schwach ist, und flackert unregelmäßig.
      float chunk = 0.65 * noise(vec2(m * 3.2 + uLife.z * 30.0, uLife.w * 0.8)) + 0.35 * noise(vec2(m * 9.0 + uLife.z * 7.0, uLife.w * 1.7));
      float heat = smoothstep(0.28, 0.85, chunk);
      float core = pow(band, 6.0);
      vec3 color = mix(vec3(0.85, 0.16, 0.02), vec3(1.0, 0.72, 0.28), core * heat);
      emit(color * (pow(band, 1.5) * (0.3 + 0.7 * heat) * 0.9 + core * heat * 1.5));
    `,
  },
  glow: {
    mode: 'add',
    body: /* glsl */ `
      float falloff = (1.0 - vUv.y) * (1.0 - vUv.y) * smoothstep(0.0, 0.25, 1.0 - vUv.y);
      emit(uColor * falloff * (1.0 - smoothstep(0.4, 1.0, uLife.x)));
    `,
  },
  gust: {
    mode: 'add',
    body: /* glsl */ `
      float t = uLife.x;
      // Nur manche Bahnen tragen eine Fahne, und jede ist in kurze Striche zerrissen.
      float lane = vUv.x * uShape.w * 46.0 + uLife.z * 5.0;
      float pick = smoothstep(0.66, 0.82, noise(vec2(lane, 0.0)));
      float dash = smoothstep(0.45, 0.75, noise(vec2(lane * 0.5, vUv.y * 9.0 - t * 14.0)));
      // Die Böe läuft als Welle nach außen und zieht ihre Fahnen hinter sich her.
      float front = t * 1.35;
      float wave = smoothstep(front - 0.7, front - 0.1, vUv.y) * (1.0 - smoothstep(front, front + 0.05, vUv.y));
      float glow = pick * dash * wave * (1.0 - smoothstep(0.55, 1.0, t)) * smoothstep(0.02, 0.15, vUv.y);
      emit(uColor * glow * lit());
    `,
  },
  flare: {
    mode: 'add',
    body: /* glsl */ `
      float t = uLife.x;
      // Strahlen: Jeder hat seine eigene Länge, ein paar reichen weit hinaus.
      float angular = vUv.x * 64.0 + uLife.z * 13.0;
      float spoke = pow(noise(vec2(angular, 1.7)), 2.2);
      float fine = 0.55 + 0.45 * noise(vec2(vUv.x * 180.0, uLife.z * 9.0));
      float reach = 0.3 + 0.7 * noise(vec2(angular * 0.5, 9.1));
      float run = min(1.0, t * 3.2);
      float rays = spoke * fine * smoothstep(run * reach, run * reach * 0.35, vUv.y) * smoothstep(0.0, 0.05, vUv.y);
      // Ein Stoß, kein Leuchten: sofort grell, nach einem Wimpernschlag vorbei.
      float core = exp(-vUv.y * vUv.y * 26.0) * (1.0 - smoothstep(0.0, 0.3, t));
      float halo = exp(-vUv.y * vUv.y * 5.0) * (1.0 - smoothstep(0.0, 0.4, t));
      float fade = (1.0 - smoothstep(0.25, 1.0, t));
      emit(uColor * (core * 1.2 + halo * 0.18 + rays * 1.9 * fade));
    `,
  },
  lichtwelle: {
    mode: 'add',
    body: /* glsl */ `
      float band = sin(vUv.y * 3.14159);
      float core = pow(band, 7.0);
      // Der Staub am Boden fängt das Licht unregelmäßig: Die Welle ist körnig, nicht glatt.
      float grain = 0.6 + 0.4 * noise(vec2(vUv.x * uShape.w * 7.0 + uLife.z * 20.0, uLife.w * 2.0));
      float fade = (1.0 - uLife.x) * (1.0 - uLife.x);
      emit(uColor * (core * 2.2 + band * band * 0.55) * grain * fade);
    `,
  },
  crack: {
    mode: 'cover',
    body: /* glsl */ `
      // Kanten zwischen zufälligen Zellen; im Weltmaß, damit das Muster am Boden haftet.
      vec2 p = vWorld * 1.5 + uLife.z * 31.0;
      vec2 cell = floor(p);
      vec2 f = fract(p);
      float nearest = 8.0;
      float second = 8.0;
      for (int j = -1; j <= 1; j++) {
        for (int i = -1; i <= 1; i++) {
          vec2 o = vec2(float(i), float(j));
          vec2 site = o + vec2(hash(cell + o), hash(cell + o + 17.3)) - f;
          float d = dot(site, site);
          if (d < nearest) { second = nearest; nearest = d; }
          else if (d < second) { second = d; }
        }
      }
      float line = 1.0 - smoothstep(0.0, 0.09, sqrt(second) - sqrt(nearest));
      // Die Risse laufen vom Mittelpunkt nach außen und werden dort dünner.
      float grown = smoothstep(vUv.y - 0.1, vUv.y + 0.1, uLife.x * 30.0);
      float reach = 1.0 - smoothstep(0.45, 1.0, vUv.y);
      float fade = 1.0 - smoothstep(0.6, 1.0, uLife.x);
      gl_FragColor = vec4(vec3(0.012, 0.01, 0.008), line * grown * reach * fade * uLife.y);
    `,
  },
  veil: {
    mode: 'add',
    defines: { UPRIGHT: '' },
    body: /* glsl */ `
      float weave = noise(vec2(vUv.x * uShape.w * 5.0 + uLife.w * 0.4, vUv.y * 3.0 - uLife.w * 0.25));
      float body = smoothstep(0.0, 0.12, vUv.y) * (1.0 - smoothstep(0.55, 1.0, vUv.y));
      // Wo die Fläche den Boden berührt, verrät sie sich als feine Linie.
      float foot = smoothstep(0.05, 0.0, vUv.y) * (0.6 + 0.4 * noise(vec2(vUv.x * uShape.w * 9.0 - uLife.w * 0.8, 0.0)));
      emit(uColor * (body * (0.3 + 0.7 * weave) + foot * 2.2));
    `,
  },
  lance: {
    mode: 'add',
    defines: { STRAIGHT: '' },
    body: /* glsl */ `
      float fromAxis = abs(vUv.x - 0.5) * 2.0;
      float t = uLife.x;
      float along = mix(uExtent.x, uExtent.y, vUv.y);
      float flicker = 0.82 + 0.18 * noise(vec2(vUv.y * 34.0 - uLife.w * 40.0, uLife.z));
      // Der Strahl selbst ist fingerdick; alles andere ist sein Schein im Staub, der körnig an ihm vorbeizieht.
      float grain = 0.55 + 0.45 * noise(vec2(along * 3.2 - uLife.w * 16.0, fromAxis * 7.0 + uLife.z * 9.0));
      float hot = smoothstep(0.05, 0.0, fromAxis);
      float core = smoothstep(0.12, 0.0, fromAxis);
      float halo = exp(-fromAxis * fromAxis * 14.0);
      float ends = smoothstep(0.0, 0.02, vUv.y) * (1.0 - smoothstep(0.93, 1.0, vUv.y));
      float envelope = smoothstep(0.0, 0.08, t) * (1.0 - smoothstep(0.3, 1.0, t));
      emit((uColor * halo * 0.5 * flicker * grain + vec3(1.0, 0.95, 0.8) * core * 1.1 + vec3(1.0) * hot * 1.2) * ends * envelope);
    `,
  },
  lancelight: {
    mode: 'add',
    defines: { STRAIGHT: '' },
    body: /* glsl */ `
      float fromAxis = abs(vUv.x - 0.5) * 2.0;
      float spread = exp(-fromAxis * fromAxis * 4.0) * (1.0 - fromAxis);
      // Der Staub am Boden fängt das Licht ungleichmäßig.
      float dust = 0.6 + 0.4 * noise(vWorld * 2.6 + uLife.z * 17.0);
      float ends = smoothstep(0.0, 0.1, vUv.y) * (1.0 - smoothstep(0.85, 1.0, vUv.y));
      float envelope = smoothstep(0.0, 0.08, uLife.x) * (1.0 - smoothstep(0.3, 1.0, uLife.x));
      emit(uColor * spread * dust * ends * envelope);
    `,
  },
  heat: {
    mode: 'warp',
    body: /* glsl */ `
      float t = uLife.x;
      // Die Hitze schießt die Strecke entlang und steht dann kurz in der Luft.
      float front = t * 3.0;
      float mask =
        smoothstep(0.0, 0.3, vUv.x) * (1.0 - smoothstep(0.7, 1.0, vUv.x)) *
        smoothstep(0.0, 0.1, vUv.y) * (1.0 - smoothstep(0.75, 1.0, vUv.y)) *
        (1.0 - smoothstep(front, front + 0.08, vUv.y)) *
        (1.0 - smoothstep(0.3, 1.0, t)) * uLife.y;
      // Wellenfronten: Bögen quer zur Richtung, die von der Hand nach außen laufen und sich dabei krümmen.
      float along = mix(uExtent.x, uExtent.y, vUv.y);
      float lateral = (vUv.x - 0.5) * uShape.w * along;
      float bands = 0.5 + 0.5 * sin((along + 0.06 * lateral * lateral) * 4.6 - uLife.w * 7.5);
      float ripple = bands * bands * bands;
      // Feine Schlieren im Weltmaß, die rasch durch die Luft ziehen: grob für das Wogen, fein für das Flirren.
      vec2 flow = vec2(uLife.w * 4.0, -uLife.w * 5.5) + uLife.z * 13.0;
      vec2 coarse = vec2(noise(vWorld * 3.0 + flow), noise(vWorld * 3.0 + flow + vec2(4.1, 9.2))) - 0.5;
      vec2 fine = vec2(noise(vWorld * 11.0 - flow * 2.0), noise(vWorld * 11.0 - flow * 2.0 + vec2(7.7, 2.3))) - 0.5;
      float amp = (0.55 + 0.9 * ripple) * mask;
      vec2 wobble = coarse * 0.012 + fine * 0.007;
      // Kein Licht, nur Flimmern: Heiße Luft bündelt und streut, was hinter ihr liegt, und färbt es einen Hauch warm.
      float lens = 1.0 + ((fine.x + fine.y) * 0.3 + (ripple - 0.3) * 0.25) * mask;
      vec3 seen = behind(wobble * amp) * lens;
      seen += vec3(0.16, 0.05, -0.02) * 0.14 * mask * (0.4 + ripple);
      gl_FragColor = vec4(max(seen, 0.0), 1.0);
    `,
  },
  shock: {
    mode: 'warp',
    body: /* glsl */ `
      float band = sin(vUv.y * 3.14159);
      float strength = band * band * (1.0 - uLife.x) * uLife.y;
      gl_FragColor = vec4(behind(normalize(vPush + 1e-5) * 0.022 * strength), 1.0);
    `,
  },
  shimmer: {
    mode: 'warp',
    defines: { UPRIGHT: '' },
    body: /* glsl */ `
      float rim = smoothstep(0.0, 0.15, vUv.y) * (1.0 - smoothstep(0.6, 1.0, vUv.y));
      vec2 q = vec2(vUv.x * uShape.w * 9.0, vUv.y * 7.0 - uLife.w * 0.9);
      vec2 wobble = vec2(noise(q), noise(q + vec2(4.1, 9.2))) - 0.5;
      gl_FragColor = vec4(behind(wobble * 0.016 * rim * uLife.y), 1.0);
    `,
  },
  sogfeld: {
    mode: 'cover',
    body: /* glsl */ `
      // Schlieren, die nach innen ziehen: Der Staub nimmt die Wärme und trägt sie zur Mitte.
      vec2 q = vec2(vUv.x * uShape.w * 3.0 + vUv.y * 2.5 + uLife.z * 9.0, vUv.y * 4.0 + uLife.w * 2.4);
      float swirl = fbm(q);
      float body = 1.0 - smoothstep(0.8, 1.0, vUv.y);
      float density = (0.3 + 0.7 * smoothstep(0.3, 0.72, swirl)) * body;
      float grown = 0.4 + 0.6 * uLife.x;
      gl_FragColor = vec4(vec3(0.004, 0.006, 0.014), density * grown * uLife.y);
    `,
  },
  sogrand: {
    mode: 'add',
    body: /* glsl */ `
      float t = uLife.x;
      float edge = smoothstep(0.9, 0.96, vUv.y) * (1.0 - smoothstep(0.975, 1.0, vUv.y));
      // Der innere Ring zeigt die Zeit: Erreicht er die Mitte, wirkt der Sog.
      float closing = 1.0 - t;
      float ring = smoothstep(0.035, 0.0, abs(vUv.y - closing)) * step(0.02, closing);
      float grain = 0.6 + 0.4 * noise(vec2(vUv.x * uShape.w * 14.0 - uLife.w * 1.5, uLife.z * 7.0));
      float pulse = 0.75 + 0.25 * sin(uLife.w * 14.0);
      emit(uColor * (edge * pulse + ring * 0.7) * grain * (0.45 + 0.55 * t));
    `,
  },
  bahn: {
    mode: 'add',
    defines: { STRAIGHT: '' },
    body: /* glsl */ `
      float t = uLife.x;
      float fromAxis = abs(vUv.x - 0.5) * 2.0;
      float edges = smoothstep(0.84, 0.92, fromAxis) * (1.0 - smoothstep(0.96, 1.0, fromAxis));
      float meters = uExtent.y - uExtent.x;
      float along = vUv.y * meters * 0.45 + fromAxis * 0.55 - uLife.w * 3.2;
      float chevron = smoothstep(0.72, 0.9, fract(along)) * (1.0 - fromAxis);
      float ends = smoothstep(0.0, 0.05, vUv.y) * (1.0 - smoothstep(0.88, 1.0, vUv.y));
      emit(uColor * (edges + chevron * 0.3) * ends * (0.4 + 0.6 * t));
    `,
  },
};

/** Alle laufenden Flächen-Effekte. Netze werden wiederverwendet, es entsteht im Kampf kein Müll. */
export class Strips {
  readonly group = new THREE.Group();
  private readonly geometry = new THREE.PlaneGeometry(1, 1, 64, 6);
  private readonly active: Strip[] = [];
  private readonly idle = new Map<StripLook, Strip[]>();
  private readonly shared = {
    uViewer: finsternisUniforms.uViewer,
    uLightRadius: { value: 14 },
    uLightTint: { value: new THREE.Color(1, 1, 1) },
    uScene: { value: new THREE.FramebufferTexture(1, 1) as THREE.Texture },
    uResolution: { value: new THREE.Vector2(1, 1) },
  };
  private grabbedFrame = -1;

  reset(): void {
    for (const strip of this.active) this.retire(strip);
    this.active.length = 0;
  }

  spawn(spec: StripSpec): Strip {
    const strip = this.idle.get(spec.look)?.pop() ?? this.create(spec.look);
    const uniforms = strip.uniforms;
    Object.assign(strip, {
      x: spec.x,
      z: spec.z,
      angle: spec.angle ?? 0,
      opacity: spec.opacity ?? 1,
      age: 0,
      life: spec.life,
      fadeOut: 0,
      held: 0,
    });
    (strip as { spec: StripSpec }).spec = spec;
    uniforms.uColor.value.set(spec.color ?? 0xffffff);
    uniforms.uLife.value.set(0, strip.opacity, Math.random(), 0);
    strip.mesh.visible = true;
    this.active.push(strip);
    this.place(strip, 0);
    return strip;
  }

  /** Lässt einen festgehaltenen Effekt in `seconds` Sekunden ausklingen. */
  release(strip: Strip, seconds = 0.25): void {
    if (Number.isFinite(strip.life)) return;
    strip.life = strip.age + seconds;
    strip.fadeOut = seconds;
  }

  /**
   * Bricht einen Effekt mit fester Dauer vorzeitig ab: Er bleibt stehen, wo er ist, und klingt aus.
   * Nur für Effekte, die noch laufen; danach gehört das Netz womöglich schon einem anderen.
   */
  cancel(strip: Strip, seconds = 0.2): void {
    if (strip.fadeOut > 0 || !Number.isFinite(strip.life) || strip.age >= strip.life) return;
    strip.held = strip.age / strip.life;
    strip.life = strip.age + seconds;
    strip.fadeOut = seconds;
  }

  /** `lightRadius` und `lightTint`: Reichweite und Farbe der Lichtquelle, in deren Schein Staub zu sehen ist. */
  update(dt: number, lightRadius: number, lightTint: THREE.Color): void {
    this.shared.uLightRadius.value = lightRadius;
    this.shared.uLightTint.value.copy(lightTint);
    for (let i = this.active.length - 1; i >= 0; i--) {
      const strip = this.active[i];
      if (!strip) continue;
      strip.age += dt;
      if (strip.age >= strip.life) {
        this.retire(strip);
        const last = this.active.pop();
        if (last && last !== strip) this.active[i] = last;
        continue;
      }
      // Festgehaltene Effekte haben keinen Verlauf; sie stehen, bis sie losgelassen werden.
      const held = !Number.isFinite(strip.life) || strip.fadeOut > 0;
      this.place(strip, held ? strip.held : strip.age / strip.life);
    }
  }

  private place(strip: Strip, progress: number): void {
    const { spec, uniforms } = strip;
    // Schnell hinaus, dann auslaufen.
    const eased = 1 - (1 - progress) * (1 - progress);
    const inner = spec.inner + ((spec.innerTo ?? spec.inner) - spec.inner) * eased;
    const outer = spec.outer + ((spec.outerTo ?? spec.outer) - spec.outer) * eased;
    uniforms.uShape.value.set(strip.x, strip.z, strip.angle, spec.width ?? Math.PI * 2);
    uniforms.uExtent.value.set(inner, outer, spec.y ?? 0.06, spec.span ?? 0);
    const fading = strip.fadeOut > 0 ? Math.max(0, (strip.life - strip.age) / strip.fadeOut) : 1;
    uniforms.uLife.value.x = progress;
    uniforms.uLife.value.y = strip.opacity * fading;
    uniforms.uLife.value.w = strip.age;
  }

  private retire(strip: Strip): void {
    strip.mesh.visible = false;
    const pool = this.idle.get(strip.spec.look);
    if (pool) pool.push(strip);
    else this.idle.set(strip.spec.look, [strip]);
  }

  private create(look: StripLook): Strip {
    const def = LOOKS[look];
    const uniforms: StripUniforms = {
      uShape: { value: new THREE.Vector4() },
      uExtent: { value: new THREE.Vector4() },
      uLife: { value: new THREE.Vector4() },
      uColor: { value: new THREE.Color() },
    };
    const material = new THREE.ShaderMaterial({
      uniforms: { ...uniforms, ...this.shared },
      defines: def.defines ?? {},
      vertexShader,
      fragmentShader: `${FRAGMENT_HEAD}\nvoid main() {\n${def.body}\n${def.mode === 'warp' ? '' : '#include <colorspace_fragment>'}\n}`,
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      blending:
        def.mode === 'add' ? THREE.AdditiveBlending : def.mode === 'cover' ? THREE.NormalBlending : THREE.NoBlending,
      toneMapped: false,
    });
    const mesh = new THREE.Mesh(this.geometry, material);
    // Die Form entsteht erst im Shader; das Gitter selbst taugt nicht zum Aussortieren.
    mesh.frustumCulled = false;
    if (def.mode === 'warp') {
      // Vor allem anderen Durchscheinenden: So verzieht die Luft nur die feste Welt, nicht das Licht davor.
      mesh.renderOrder = -10;
      mesh.onBeforeRender = (renderer) => this.grab(renderer);
    } else {
      mesh.renderOrder = def.mode === 'cover' ? 1 : 3;
    }
    this.group.add(mesh);
    const spec: StripSpec = { look, x: 0, z: 0, inner: 0, outer: 1, life: 0 };
    return { x: 0, z: 0, angle: 0, opacity: 1, age: 0, life: 0, fadeOut: 0, held: 0, spec, mesh, uniforms };
  }

  /** Hält einmal je Bild fest, was bisher gezeichnet ist; flimmernde Flächen zeigen es verschoben. */
  private grab(renderer: THREE.WebGLRenderer): void {
    const frame = renderer.info.render.frame;
    if (frame === this.grabbedFrame) return;
    this.grabbedFrame = frame;
    const size = renderer.getDrawingBufferSize(this.shared.uResolution.value);
    const image = this.shared.uScene.value.image as { width: number; height: number };
    if (image.width !== size.x || image.height !== size.y) {
      this.shared.uScene.value.dispose();
      const texture = new THREE.FramebufferTexture(size.x, size.y);
      texture.minFilter = THREE.LinearFilter;
      texture.magFilter = THREE.LinearFilter;
      this.shared.uScene.value = texture;
    }
    renderer.copyFramebufferToTexture(this.shared.uScene.value as THREE.FramebufferTexture);
  }
}
