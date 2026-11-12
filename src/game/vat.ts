import type * as THREE from 'three';
import { extendShader } from './darkness';
import type { HordeModel } from './models';

/**
 * Bewegung aus der Textur: Statt ein Skelett zu rechnen, liest der Shader die Position jedes
 * Eckpunkts für das aktuelle Bild der Laufbewegung aus und blendet zum nächsten über.
 */
const PARS = /* glsl */ `
  uniform highp sampler2D uVatPositions;
  uniform vec3 uVatLayout;
  // x = Bild der Laufbewegung (mit Nachkommaanteil), y = Zerfall zu Staub von 0 bis 1.
  attribute vec2 aAnim;

  ivec2 vatTexel(int frame) {
    int width = int(uVatLayout.x);
    return ivec2(gl_VertexID % width, frame * int(uVatLayout.y) + gl_VertexID / width);
  }

  vec3 vatPosition() {
    int frame = int(aAnim.x);
    int next = (frame + 1) % int(uVatLayout.z);
    return mix(
      texelFetch(uVatPositions, vatTexel(frame), 0).xyz,
      texelFetch(uVatPositions, vatTexel(next), 0).xyz,
      fract(aAnim.x)
    );
  }
`;

/** Das sichtbare Material einer Gegnerart: Bewegung aus der Textur, dazu der Zerfall zu Staub. */
export function animatedByTexture<T extends THREE.Material>(material: T, model: HordeModel): T {
  extendShader(material, 'vat', (shader) => {
    shader.uniforms.uVatPositions = { value: model.positions };
    shader.uniforms.uVatNormals = { value: model.normals };
    shader.uniforms.uVatLayout = { value: model.layout };
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        `#include <common>\n${PARS}\nuniform highp sampler2D uVatNormals;\nvarying float vDissolve;`,
      )
      .replace(
        '#include <beginnormal_vertex>',
        '#include <beginnormal_vertex>\nobjectNormal = texelFetch(uVatNormals, vatTexel(int(aAnim.x)), 0).xyz;',
      )
      .replace(
        '#include <begin_vertex>',
        /* glsl */ `#include <begin_vertex>
        transformed = vatPosition();
        // Wer zerfällt, sackt in sich zusammen.
        transformed.y *= 1.0 - 0.75 * aAnim.y;
        vDissolve = aAnim.y;`,
      );
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying float vDissolve;')
      .replace(
        '#include <color_fragment>',
        /* glsl */ `#include <color_fragment>
        if (vDissolve > 0.0) {
          // Körnig statt durchsichtig: Staub rieselt, er verblasst nicht.
          float grain = fract(sin(dot(floor(gl_FragCoord.xy * 0.5), vec2(12.9898, 78.233))) * 43758.5453);
          if (grain < vDissolve) discard;
          diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.46, 0.43, 0.39), min(1.0, vDissolve * 1.5));
        }`,
      );
  });
  return material;
}

/** Das Material, mit dem dieselbe Gegnerart ihren Schatten in die Karte der Fackel schreibt. */
export function shadowByTexture<T extends THREE.Material>(material: T, model: HordeModel): T {
  extendShader(material, 'vat-shadow', (shader) => {
    shader.uniforms.uVatPositions = { value: model.positions };
    shader.uniforms.uVatLayout = { value: model.layout };
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>\n${PARS}`)
      .replace('#include <begin_vertex>', '#include <begin_vertex>\ntransformed = vatPosition();');
  });
  return material;
}
