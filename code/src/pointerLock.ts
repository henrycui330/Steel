/** Request pointer lock on the game canvas; re-lock on click if Esc released it. */
export function lockPointer(canvas: HTMLElement): void {
  const request = (): void => {
    if (document.pointerLockElement === canvas) return
    void canvas.requestPointerLock()
  }

  request()
  canvas.addEventListener('click', request)
  document.addEventListener('pointerlockchange', () => {
    if (document.pointerLockElement === canvas) {
      console.info('[Steel] Pointer locked')
    } else {
      console.info('[Steel] Pointer unlocked — click canvas to re-lock')
    }
  })
}
