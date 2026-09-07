import * as THREE from 'three'

/** Clean arena / panzer paint tokens (visuals reset — no warfare grade). */
export const PALETTE = {
  sky: 0x7a8a96,
  ground: 0x8a7d5c,
  groundRough: 0.92,
  wall: 0x6e6454,
  hemiSky: 0xc5d0d8,
  hemiGround: 0x6b5f45,
  sun: 0xfff0d4,
  ambient: 0xb8c0c6,
  armor: 0x4c5248,
  armorDark: 0x353a34,
  track: 0x2a2c28,
  iron: 0x5a5e58,
} as const

/** Repaint imported tank meshes to a consistent dunkelgrau scheme. */
export function paintTankDunkelgrau(root: THREE.Object3D): void {
  const hullMat = new THREE.MeshStandardMaterial({
    color: PALETTE.armor,
    roughness: 0.82,
    metalness: 0.12,
  })
  const darkMat = new THREE.MeshStandardMaterial({
    color: PALETTE.armorDark,
    roughness: 0.88,
    metalness: 0.08,
  })
  const trackMat = new THREE.MeshStandardMaterial({
    color: PALETTE.track,
    roughness: 0.95,
    metalness: 0.05,
  })
  const ironMat = new THREE.MeshStandardMaterial({
    color: PALETTE.iron,
    roughness: 0.55,
    metalness: 0.35,
  })

  root.traverse((obj) => {
    if (!(obj instanceof THREE.Mesh)) return
    // Keep Sketchfab / textured imports — only paint bare materials
    const src = Array.isArray(obj.material) ? obj.material : [obj.material]
    if (
      src.some(
        (m) =>
          m &&
          ((m as THREE.MeshStandardMaterial).map ||
            (m as THREE.MeshBasicMaterial).map),
      )
    ) {
      return
    }
    const n = obj.name.toLowerCase()
    let mat = hullMat
    if (n.includes('track') || n.includes('chain')) mat = trackMat
    else if (n.includes('wheel')) mat = darkMat
    else if (n.includes('barrel') || n.includes('gun')) mat = ironMat
    else if (n.includes('turret')) mat = hullMat
    obj.material = mat
  })
}
