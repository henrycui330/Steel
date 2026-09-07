import * as THREE from 'three'

export type TankHandle = {
  root: THREE.Group
  /** Turret yaw group (includes barrel pitch child). */
  turret: THREE.Object3D
  /** World-space muzzle point for shells. */
  muzzle: THREE.Object3D
}

/** Procedural M4 Sherman–inspired tank. Local +Z is forward. */
export function createShermanTank(): TankHandle {
  const tank = new THREE.Group()
  tank.name = 'playerTank'

  const olive = new THREE.MeshStandardMaterial({
    color: 0x556b3a,
    roughness: 0.75,
    metalness: 0.2,
  })
  const dark = new THREE.MeshStandardMaterial({
    color: 0x2e3528,
    roughness: 0.7,
    metalness: 0.25,
  })
  const trackMat = new THREE.MeshStandardMaterial({
    color: 0x1a1a1a,
    roughness: 0.95,
    metalness: 0.05,
  })
  const iron = new THREE.MeshStandardMaterial({
    color: 0x4a4a42,
    roughness: 0.55,
    metalness: 0.45,
  })

  const hull = new THREE.Mesh(new THREE.BoxGeometry(2.2, 0.7, 3.4), olive)
  hull.position.set(0, 0.55, 0)
  hull.castShadow = true
  hull.receiveShadow = true
  tank.add(hull)

  const glacis = new THREE.Mesh(new THREE.BoxGeometry(2.0, 0.35, 0.9), dark)
  glacis.position.set(0, 0.85, 1.35)
  glacis.rotation.x = -0.35
  glacis.castShadow = true
  tank.add(glacis)

  for (const x of [-1.25, 1.25]) {
    const track = new THREE.Mesh(new THREE.BoxGeometry(0.45, 0.55, 3.6), trackMat)
    track.position.set(x, 0.3, 0)
    track.castShadow = true
    tank.add(track)
  }

  const turret = new THREE.Group()
  turret.name = 'Turret'
  turret.position.set(0, 1.25, -0.15)
  tank.add(turret)

  const turretMesh = new THREE.Mesh(
    new THREE.CylinderGeometry(0.85, 0.95, 0.7, 12),
    olive,
  )
  turretMesh.castShadow = true
  turret.add(turretMesh)

  const cupola = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.3, 0.22, 10), dark)
  cupola.position.set(-0.35, 0.45, 0)
  cupola.castShadow = true
  turret.add(cupola)

  // Named Gun so finishRig can build a pitch pivot around it only
  const gun = new THREE.Group()
  gun.name = 'Gun'
  gun.position.set(0, 0.05, 0.6)
  turret.add(gun)

  const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.12, 2.2, 10), iron)
  barrel.rotation.x = Math.PI / 2
  barrel.position.set(0, 0, 0.9)
  barrel.castShadow = true
  gun.add(barrel)

  const muzzleBrake = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.14, 0.2, 8), iron)
  muzzleBrake.rotation.x = Math.PI / 2
  muzzleBrake.position.set(0, 0, 2.0)
  muzzleBrake.castShadow = true
  gun.add(muzzleBrake)

  const muzzle = new THREE.Object3D()
  muzzle.name = 'muzzle'
  muzzle.position.set(0, 0, 2.25)
  gun.add(muzzle)

  return { root: tank, turret, muzzle }
}
