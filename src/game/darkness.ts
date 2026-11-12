import * as THREE from 'three';
import { CONFIG } from '../config';

/**
 * Feste Obergrenze, weil die Größe des Uniform-Arrays im Shader feststeht. Was die wandernden
 * Schwaden nicht belegen, bleibt für Finsternis, die ein Wesen mit sich trägt.
 */
export const MAX_CLOUDS = 12;

/** Ungenutzte Plätze liegen weit außerhalb der Karte. */
const FAR_AWAY = 1e6;

/** Gemeinsame Uniforms aller Materialien, die von der Finsternis verschluckt werden. */
export const finsternisUniforms = {
  /** Je Schwade: x, z, Radius. */
  uClouds: { value: Array.from({ length: MAX_CLOUDS }, () => new THREE.Vector3(FAR_AWAY, FAR_AWAY, 0)) },
  /** Position der Spielfigur. */
  uViewer: { value: new THREE.Vector2() },
  uFinsternisTime: { value: 0 },
  /** 1, wenn die Spielfigur Lebendiges in der Finsternis spürt (Wildnisläufer), sonst 0. */
  uSense: { value: 0 },
};

export function clearCloudUniform(index: number): void {
  finsternisUniforms.uClouds.value[index]?.set(FAR_AWAY, FAR_AWAY, 0);
}

/**
 * Die Finsternis ist kein Nebel vor der Kamera, sondern eine Maske auf der Welt:
 * Wo eine Schwade liegt, kommt kein Lichtschein durch, auch nicht der einer Fackel.
 */
export const FINSTERNIS_GLSL = /* glsl */ `
  uniform vec3 uClouds[${MAX_CLOUDS}];
  uniform vec2 uViewer;
  uniform float uFinsternisTime;
  uniform float uSense;

  float finsternisHash(vec2 p) {
    return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
  }

  float finsternisNoise(vec2 p) {
    vec2 cell = floor(p);
    vec2 f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    return mix(
      mix(finsternisHash(cell), finsternisHash(cell + vec2(1.0, 0.0)), f.x),
      mix(finsternisHash(cell + vec2(0.0, 1.0)), finsternisHash(cell + vec2(1.0, 1.0)), f.x),
      f.y
    );
  }

  // 0 = frei, 1 = mitten in einer Schwade. Der Rand franst aus und wabert.
  float finsternisAmount(vec2 p) {
    float wobble =
      (finsternisNoise(p * 0.3 + uFinsternisTime * 0.12) - 0.5) * 2.0 +
      (finsternisNoise(p * 1.3 - uFinsternisTime * 0.2) - 0.5) * 0.7;
    float amount = 0.0;
    for (int i = 0; i < ${MAX_CLOUDS}; i++) {
      vec3 cloud = uClouds[i];
      float fromCenter = distance(p, cloud.xy) + wobble;
      amount = max(amount, 1.0 - smoothstep(cloud.z - ${CONFIG.finsternis.edge.toFixed(1)}, cloud.z, fromCenter));
    }
    return amount;
  }

  vec3 applyFinsternis(vec3 color, vec2 p) {
    float amount = finsternisAmount(p);
    float luma = dot(color, vec3(0.299, 0.587, 0.114));
    // Am Rand färbt sich angestrahlter Boden kalt: So hebt sich die Schwade
    // vom bloßen Ende des Fackelscheins ab.
    float rim = amount * (1.0 - amount) * 4.0;
    color = mix(color, luma * vec3(0.4, 0.62, 1.25), rim * 0.9);
    // Direkt um die Spielfigur dringt ihr Licht noch durch, aber fahl und kalt.
    float near = 1.0 - smoothstep(2.0, 5.5, distance(p, uViewer));
    vec3 cold = mix(color, luma * vec3(0.55, 0.68, 1.0), 0.7) * 0.5;
    vec3 result = mix(color, cold * near, amount);
    // Wer die Finsternis spürt, erkennt ihren Rand auch ohne Lichtschein ...
    result += rim * vec3(0.012, 0.03, 0.07) * uSense;
    #ifdef FINSTERNIS_SENSED
      // ... und Lebendiges darin als fahlen Umriss.
      result = mix(result, vec3(0.07, 0.13, 0.24), amount * uSense * (1.0 - near));
    #endif
    return result;
  }
`;

/**
 * Lässt ein beleuchtetes Material in der Finsternis verschwinden.
 * Mit `sensed` bleibt es für den Spürsinn des Wildnisläufers als Umriss sichtbar.
 */
export function swallowedByFinsternis<T extends THREE.Material>(material: T, sensed = false): T {
  if (sensed) material.defines = { ...material.defines, FINSTERNIS_SENSED: '' };
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, finsternisUniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec2 vFinsternisPosition;')
      .replace(
        '#include <project_vertex>',
        /* glsl */ `#include <project_vertex>
        vec4 finsternisWorld = vec4(transformed, 1.0);
        #ifdef USE_INSTANCING
          finsternisWorld = instanceMatrix * finsternisWorld;
        #endif
        vFinsternisPosition = (modelMatrix * finsternisWorld).xz;`,
      );
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\nvarying vec2 vFinsternisPosition;\n${FINSTERNIS_GLSL}`)
      .replace(
        '#include <opaque_fragment>',
        '#include <opaque_fragment>\ngl_FragColor.rgb = applyFinsternis(gl_FragColor.rgb, vFinsternisPosition);',
      );
  };
  // Eigener Schlüssel, damit Three das Programm nicht mit dem ungepatchten verwechselt.
  material.customProgramCacheKey = () => (sensed ? 'finsternis-sensed' : 'finsternis');
  return material;
}

/**
 * Erweitert den Shader eines Materials, statt den vorhandenen Eingriff zu ersetzen:
 * Die Finsternis hängt am selben Haken, und wer danach kommt, kann auf ihr aufbauen.
 */
export function extendShader(
  material: THREE.Material,
  key: string,
  patch: (shader: THREE.WebGLProgramParametersWithUniforms) => void,
): void {
  const compileBefore = material.onBeforeCompile;
  const keyBefore = material.customProgramCacheKey;
  material.onBeforeCompile = (shader, renderer) => {
    compileBefore.call(material, shader, renderer);
    patch(shader);
  };
  material.customProgramCacheKey = () => `${keyBefore.call(material)}|${key}`;
}

/** Dieselbe Randkurve wie im Shader, nur ohne das Wabern. */
export function cloudAmount(distance: number, radius: number): number {
  const t = Math.min(1, Math.max(0, (distance - (radius - CONFIG.finsternis.edge)) / CONFIG.finsternis.edge));
  return 1 - t * t * (3 - 2 * t);
}
