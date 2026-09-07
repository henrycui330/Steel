import * as THREE from 'three'
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js'
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js'
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js'
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js'

/** Gritty Eastern-front grade: crush lift, desaturate, olive cast, grain, vignette. */
const WarfareGradeShader = {
  name: 'WarfareGradeShader',
  uniforms: {
    tDiffuse: { value: null as THREE.Texture | null },
    time: { value: 0 },
    contrast: { value: 1.08 },
    saturation: { value: 0.7 },
    vignette: { value: 0.35 },
    grain: { value: 0.05 },
    olive: { value: new THREE.Vector3(0.96, 0.98, 0.94) },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform float time;
    uniform float contrast;
    uniform float saturation;
    uniform float vignette;
    uniform float grain;
    uniform vec3 olive;
    varying vec2 vUv;

    float hash(vec2 p) {
      return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
    }

    void main() {
      vec4 tex = texture2D(tDiffuse, vUv);
      vec3 c = tex.rgb;

      c = (c - 0.5) * contrast + 0.5;

      float luma = dot(c, vec3(0.299, 0.587, 0.114));
      c = mix(vec3(luma), c, saturation);
      c *= olive;

      float d = distance(vUv, vec2(0.5));
      float vig = smoothstep(0.45, 1.2, d);
      c *= 1.0 - vig * vignette;

      float n = hash(vUv * vec2(1920.0, 1080.0) + fract(time) * 40.0);
      c += (n - 0.5) * grain;

      gl_FragColor = vec4(clamp(c, 0.0, 1.0), tex.a);
    }
  `,
}

export type WarfareLook = {
  composer: EffectComposer
  update: (dt: number) => void
  setSize: (w: number, h: number) => void
  render: () => void
}

/** Fog + post grade for a muddy, desaturated warfare look. */
export function createWarfareLook(
  renderer: THREE.WebGLRenderer,
  scene: THREE.Scene,
  camera: THREE.Camera,
): WarfareLook {
  scene.fog = new THREE.FogExp2(0x6a6e64, 0.0065)
  renderer.setClearColor(0x6a6e64, 1)

  const composer = new EffectComposer(renderer)
  composer.addPass(new RenderPass(scene, camera))

  const grade = new ShaderPass(WarfareGradeShader)
  composer.addPass(grade)
  composer.addPass(new OutputPass())

  return {
    composer,
    update(dt) {
      grade.uniforms.time.value += dt
    },
    setSize(w, h) {
      composer.setSize(w, h)
    },
    render() {
      composer.render()
    },
  }
}
