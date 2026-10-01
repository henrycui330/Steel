import * as THREE from 'three'
import './hitAnalyzer.css'
import type { ArmorPartId, HitOutcomeKind } from './armor'

/**
 * War Thunder–style hit analyzer: x-ray tank + shell path + impact spark.
 * Main gun / rockets / ATGM only (not MG spam).
 */

export type HitAnalyzeKind = HitOutcomeKind | 'kill' | 'crit'

export type HitAnalyzeReport = {
  targetRoot: THREE.Object3D
  /** Impact point in target local space. */
  localHit: THREE.Vector3
  /** Incoming shell direction in target local space (unit). */
  localDir: THREE.Vector3
  partId: ArmorPartId
  targetName: string
  ammoLabel: string
  outcome: HitAnalyzeKind
  partLabel: string
  damage: number
  penetration: number
  effectiveArmor: number
  angleDeg: number
  hp: number
  maxHp: number
  tracksDisabled?: boolean
}

export type HitAnalyzer = {
  show: (report: HitAnalyzeReport) => void
  hide: () => void
  dispose: () => void
}

const OUTCOME_LABEL: Record<HitAnalyzeKind, string> = {
  penetrated: 'PENETRATION',
  ricochet: 'RICOCHET',
  stopped: 'NO PENETRATION',
  blast: 'EXTERNAL BLAST',
  kill: 'DESTROYED',
  crit: 'AMMO RACK',
}

const OUTCOME_COLOR: Record<HitAnalyzeKind, number> = {
  penetrated: 0x7dff4a,
  ricochet: 0xd0d0d0,
  stopped: 0xc4a35a,
  blast: 0xff9a3a,
  kill: 0xff3a2a,
  crit: 0xff6a20,
}

const HOLD_MS = 4200
const FADE_MS = 320
const VIEW_W = 320
const VIEW_H = 220

function disposeObject(obj: THREE.Object3D): void {
  obj.traverse((o) => {
    if (!(o instanceof THREE.Mesh)) return
    o.geometry?.dispose()
    const mats = Array.isArray(o.material) ? o.material : [o.material]
    for (const m of mats) m?.dispose()
  })
}

/** Ghost clone of the struck tank for the x-ray viewport. */
function buildXrayClone(source: THREE.Object3D): THREE.Group {
  const wrap = new THREE.Group()
  wrap.name = 'haXray'
  source.updateMatrixWorld(true)

  const inv = new THREE.Matrix4().copy(source.matrixWorld).invert()
  const ghostMat = new THREE.MeshBasicMaterial({
    color: 0x8aa090,
    transparent: true,
    opacity: 0.28,
    depthWrite: false,
    side: THREE.DoubleSide,
  })
  const edgeMat = new THREE.MeshBasicMaterial({
    color: 0xc8d8c0,
    transparent: true,
    opacity: 0.55,
    wireframe: true,
    depthWrite: false,
  })

  source.traverse((obj) => {
    if (!(obj instanceof THREE.Mesh) || !obj.visible || !obj.geometry) return
    const geo = obj.geometry.clone()
    const solid = new THREE.Mesh(geo, ghostMat.clone())
    const wire = new THREE.Mesh(geo, edgeMat.clone())
    solid.matrix.copy(new THREE.Matrix4().multiplyMatrices(inv, obj.matrixWorld))
    solid.matrix.decompose(solid.position, solid.quaternion, solid.scale)
    solid.matrixAutoUpdate = true
    wire.position.copy(solid.position)
    wire.quaternion.copy(solid.quaternion)
    wire.scale.copy(solid.scale)
    wrap.add(solid, wire)
  })

  return wrap
}

export function createHitAnalyzer(): HitAnalyzer {
  const root = document.createElement('aside')
  root.className = 'hit-analyzer'
  root.hidden = true
  root.setAttribute('aria-live', 'polite')
  root.innerHTML = `
    <div class="ha-head">
      <p class="ha-title">Armor hit</p>
      <p class="ha-outcome">—</p>
    </div>
    <canvas class="ha-view" width="${VIEW_W}" height="${VIEW_H}"></canvas>
    <p class="ha-caption">
      <span class="ha-target">—</span>
      <span class="ha-stats">—</span>
    </p>
  `
  document.body.appendChild(root)

  const canvas = root.querySelector('.ha-view') as HTMLCanvasElement
  const outcomeEl = root.querySelector('.ha-outcome') as HTMLElement
  const targetEl = root.querySelector('.ha-target') as HTMLElement
  const statsEl = root.querySelector('.ha-stats') as HTMLElement

  const renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: true,
    alpha: true,
    powerPreference: 'low-power',
  })
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
  renderer.setSize(VIEW_W, VIEW_H, false)
  renderer.setClearColor(0x000000, 0)

  const scene = new THREE.Scene()
  const camera = new THREE.PerspectiveCamera(32, VIEW_W / VIEW_H, 0.2, 80)
  const key = new THREE.DirectionalLight(0xffffff, 1.1)
  key.position.set(4, 8, 5)
  scene.add(key, new THREE.AmbientLight(0xb0c0b0, 0.55))

  let tankGroup: THREE.Group | null = null
  let hitMarker: THREE.Mesh | null = null
  let pathLine: THREE.Line | null = null
  let plateGlow: THREE.Mesh | null = null
  let spark: THREE.Mesh | null = null
  let hideTimer = 0
  let fadeTimer = 0
  let raf = 0
  let orbitT = 0
  let lookAt = new THREE.Vector3()
  let camRadius = 8

  const _box = new THREE.Box3()
  const _size = new THREE.Vector3()
  const _from = new THREE.Vector3()
  const _to = new THREE.Vector3()

  function clearTimers(): void {
    if (hideTimer) window.clearTimeout(hideTimer)
    if (fadeTimer) window.clearTimeout(fadeTimer)
    hideTimer = 0
    fadeTimer = 0
  }

  function stopLoop(): void {
    if (raf) cancelAnimationFrame(raf)
    raf = 0
  }

  function clearSceneContent(): void {
    if (tankGroup) {
      scene.remove(tankGroup)
      disposeObject(tankGroup)
      tankGroup = null
    }
    for (const obj of [hitMarker, pathLine, plateGlow, spark]) {
      if (!obj) continue
      scene.remove(obj)
      disposeObject(obj)
    }
    hitMarker = null
    pathLine = null
    plateGlow = null
    spark = null
  }

  function hide(): void {
    clearTimers()
    stopLoop()
    root.classList.remove('is-on')
    root.classList.add('is-off')
    fadeTimer = window.setTimeout(() => {
      root.hidden = true
      root.classList.remove('is-off')
      clearSceneContent()
      renderer.clear()
    }, FADE_MS)
  }

  function tick(): void {
    if (root.hidden) {
      raf = 0
      return
    }
    orbitT += 0.008
    const yaw = 0.55 + Math.sin(orbitT) * 0.35
    const pitch = 0.42
    camera.position.set(
      lookAt.x + Math.sin(yaw) * camRadius * Math.cos(pitch),
      lookAt.y + camRadius * Math.sin(pitch) * 0.85,
      lookAt.z + Math.cos(yaw) * camRadius * Math.cos(pitch),
    )
    camera.lookAt(lookAt)

    if (spark) {
      const pulse = 0.85 + Math.sin(performance.now() * 0.012) * 0.25
      spark.scale.setScalar(pulse)
    }
    renderer.render(scene, camera)
    raf = requestAnimationFrame(tick)
  }

  return {
    show(report) {
      clearTimers()
      stopLoop()
      clearSceneContent()

      const kind = report.outcome
      const color = OUTCOME_COLOR[kind]
      root.dataset.kind = kind
      outcomeEl.textContent = OUTCOME_LABEL[kind]
      targetEl.textContent = report.targetName || 'Target'

      const dmg =
        report.damage > 0 ? `−${Math.round(report.damage)} HP` : '0 dmg'
      const pen = `${Math.round(report.penetration)}/${Math.round(report.effectiveArmor)} mm`
      const extras = [
        report.partLabel,
        dmg,
        pen,
        `${Math.round(report.angleDeg)}°`,
        report.ammoLabel,
      ]
      if (report.tracksDisabled) extras.push('TRACKS OUT')
      statsEl.textContent = extras.join(' · ')

      tankGroup = buildXrayClone(report.targetRoot)
      scene.add(tankGroup)

      _box.setFromObject(tankGroup)
      _box.getCenter(lookAt)
      _box.getSize(_size)
      camRadius = Math.max(_size.length() * 0.95, 5.5)

      // Hit plate glow — small box around impact.
      const glowMat = new THREE.MeshBasicMaterial({
        color,
        transparent: true,
        opacity: 0.35,
        depthWrite: false,
      })
      plateGlow = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.45, 0.55), glowMat)
      plateGlow.position.copy(report.localHit)
      scene.add(plateGlow)

      // Impact spark
      const sparkMat = new THREE.MeshBasicMaterial({
        color,
        transparent: true,
        opacity: 0.95,
        depthWrite: false,
      })
      spark = new THREE.Mesh(new THREE.SphereGeometry(0.14, 10, 10), sparkMat)
      spark.position.copy(report.localHit)
      scene.add(spark)

      // Shell path — approach → impact → (optional) inside for pens
      const dir = report.localDir.clone()
      if (dir.lengthSq() < 1e-6) dir.set(0, 0, 1)
      else dir.normalize()
      _from.copy(report.localHit).addScaledVector(dir, -camRadius * 0.55)
      const penetrate =
        kind === 'penetrated' || kind === 'kill' || kind === 'crit' || kind === 'blast'
      _to
        .copy(report.localHit)
        .addScaledVector(dir, penetrate ? camRadius * 0.28 : 0.05)

      const pathGeo = new THREE.BufferGeometry().setFromPoints([
        _from.clone(),
        report.localHit.clone(),
        _to.clone(),
      ])
      pathLine = new THREE.Line(
        pathGeo,
        new THREE.LineBasicMaterial({
          color,
          transparent: true,
          opacity: 0.9,
        }),
      )
      scene.add(pathLine)

      // Arrow tip at impact
      hitMarker = new THREE.Mesh(
        new THREE.ConeGeometry(0.1, 0.28, 8),
        new THREE.MeshBasicMaterial({ color }),
      )
      hitMarker.position.copy(report.localHit).addScaledVector(dir, -0.2)
      hitMarker.quaternion.setFromUnitVectors(
        new THREE.Vector3(0, 1, 0),
        dir.clone().normalize(),
      )
      scene.add(hitMarker)

      root.hidden = false
      root.classList.remove('is-off')
      root.classList.remove('is-on')
      void root.offsetWidth
      root.classList.add('is-on')

      orbitT = 0
      tick()
      hideTimer = window.setTimeout(hide, HOLD_MS)
    },
    hide,
    dispose() {
      clearTimers()
      stopLoop()
      clearSceneContent()
      renderer.dispose()
      root.remove()
    },
  }
}
