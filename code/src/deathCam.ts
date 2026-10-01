import * as THREE from 'three'
import { tankCombatSummary, tankOptionById, type TankId } from './tankCatalog'
import './deathCam.css'

/**
 * Death cam — after the player is destroyed, orbit+zoom the camera onto what
 * killed them and show a short identity / stats slate (War Thunder–style).
 */

export type DeathKiller = {
  root: THREE.Object3D
  tankId: TankId
  name: string
}

export type DeathCam = {
  begin: (killer: DeathKiller) => void
  active: () => boolean
  update: (realDt: number, camera: THREE.PerspectiveCamera) => void
  cancel: () => void
  dispose: () => void
}

const WORLD_UP = new THREE.Vector3(0, 1, 0)
const _box = new THREE.Box3()
/** Real seconds on the killer before control returns. */
const HOLD = 4.2
const MAX_REAL = 6.5
const FOV_IN = 48
const FOV_OUT = 32
const DIST_START = 16
const DIST_END = 7.5
const RISE = 3.2
const ORBIT_RAD_PER_SEC = 0.38
const FOLLOW = 7

export type DeathCamOptions = {
  heightAt: (x: number, z: number) => number
  onShow?: (showing: boolean) => void
}

export function createDeathCam(opts: DeathCamOptions): DeathCam {
  const { heightAt, onShow } = opts

  const overlay = document.createElement('div')
  overlay.className = 'deathcam'
  overlay.innerHTML = `
    <div class="deathcam-bar top"></div>
    <div class="deathcam-bar bottom"></div>
    <div class="deathcam-slate">
      <div class="deathcam-kicker">
        <span class="deathcam-dot"></span>
        <span class="deathcam-kicker-text">Destroyed by</span>
        <span class="deathcam-hint">C to skip</span>
      </div>
      <div class="deathcam-name">—</div>
      <div class="deathcam-role">—</div>
      <div class="deathcam-stats">
        <div class="deathcam-stat"><span class="deathcam-stat-l">PEN</span><span class="deathcam-stat-v deathcam-pen">—</span></div>
        <div class="deathcam-stat"><span class="deathcam-stat-l">FRONT</span><span class="deathcam-stat-v deathcam-front">—</span></div>
        <div class="deathcam-stat"><span class="deathcam-stat-l">HP</span><span class="deathcam-stat-v deathcam-hp">—</span></div>
        <div class="deathcam-stat"><span class="deathcam-stat-l">GUN</span><span class="deathcam-stat-v deathcam-gun">—</span></div>
      </div>
    </div>`
  overlay.style.display = 'none'
  document.body.appendChild(overlay)

  const nameEl = overlay.querySelector('.deathcam-name') as HTMLElement
  const roleEl = overlay.querySelector('.deathcam-role') as HTMLElement
  const penEl = overlay.querySelector('.deathcam-pen') as HTMLElement
  const frontEl = overlay.querySelector('.deathcam-front') as HTMLElement
  const hpEl = overlay.querySelector('.deathcam-hp') as HTMLElement
  const gunEl = overlay.querySelector('.deathcam-gun') as HTMLElement

  let killer: DeathKiller | null = null
  let active = false
  let elapsed = 0
  let cut = true
  let orbit = 0

  const target = new THREE.Vector3()
  const goal = new THREE.Vector3()
  const look = new THREE.Vector3()

  function fillSlate(k: DeathKiller): void {
    const opt = tankOptionById(k.tankId)
    const sum = tankCombatSummary(opt)
    nameEl.textContent = k.name
    roleEl.textContent = opt.role
    penEl.textContent = `${sum.pen} mm`
    frontEl.textContent = `${sum.frontArmor} mm`
    hpEl.textContent = String(sum.hp)
    gunEl.textContent = `${sum.apLabel} / ${opt.gun.heLabel ?? 'HE'}`
  }

  function cancel(): void {
    if (!active) return
    active = false
    killer = null
    overlay.classList.remove('in')
    overlay.style.display = 'none'
    onShow?.(false)
  }

  return {
    begin(next) {
      if (!next.root) return
      killer = next
      active = true
      elapsed = 0
      cut = true
      // Start opposite the killer's nose so the silhouette reads.
      orbit = next.root.rotation.y + Math.PI * 0.65
      fillSlate(next)
      overlay.style.display = ''
      void overlay.offsetHeight
      overlay.classList.add('in')
      onShow?.(true)
      console.info(`[Steel] Death cam · ${next.name} (${next.tankId})`)
    },
    active: () => active,
    update(realDt, camera) {
      if (!active || !killer) return
      elapsed += realDt
      if (elapsed >= MAX_REAL || elapsed >= HOLD) {
        cancel()
        return
      }

      const t = THREE.MathUtils.clamp(elapsed / HOLD, 0, 1)
      const ease = t * t * (3 - 2 * t)
      const dist = THREE.MathUtils.lerp(DIST_START, DIST_END, ease)
      orbit += ORBIT_RAD_PER_SEC * realDt

      killer.root.getWorldPosition(target)
      // Aim a bit above the hull so turrets read.
      _box.setFromObject(killer.root)
      if (Number.isFinite(_box.max.y) && Number.isFinite(_box.min.y)) {
        target.y = THREE.MathUtils.lerp(_box.min.y, _box.max.y, 0.55)
      } else {
        target.y += 1.2
      }

      goal.set(
        target.x + Math.sin(orbit) * dist,
        target.y + RISE * (1 - ease * 0.25),
        target.z + Math.cos(orbit) * dist,
      )
      const floor = heightAt(goal.x, goal.z) + 2.2
      if (goal.y < floor) goal.y = floor

      look.copy(target)
      if (cut) {
        camera.position.copy(goal)
        cut = false
      } else {
        camera.position.lerp(goal, 1 - Math.exp(-FOLLOW * realDt))
      }
      camera.up.copy(WORLD_UP)
      camera.lookAt(look)
      camera.fov = THREE.MathUtils.lerp(FOV_IN, FOV_OUT, ease)
      camera.updateProjectionMatrix()
    },
    cancel,
    dispose() {
      cancel()
      overlay.remove()
    },
  }
}
