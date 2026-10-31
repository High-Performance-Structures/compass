import type { Camera, Object3D, Raycaster, Vector2 } from "three"

export type PortfolioPick = {
  readonly jobId: string
  readonly notificationId: string | null
}

/** Keep source identity on the actual raycast hit, including tiles sorted by kind. */
export function pickPortfolioTarget(
  event: Pick<PointerEvent, "clientX" | "clientY">,
  canvas: HTMLCanvasElement,
  pointer: Vector2,
  raycaster: Raycaster,
  camera: Camera,
  markers: readonly Object3D[],
  tiles: readonly Object3D[],
): PortfolioPick | null {
  const rect = canvas.getBoundingClientRect()
  if (rect.width === 0 || rect.height === 0) return null
  pointer.set(
    ((event.clientX - rect.left) / rect.width) * 2 - 1,
    -((event.clientY - rect.top) / rect.height) * 2 + 1,
  )
  raycaster.setFromCamera(pointer, camera)
  const hit = raycaster.intersectObjects([...markers, ...tiles], false)[0]
  const jobId: unknown = hit?.object.userData.jobId
  const notificationId: unknown = hit?.object.userData.notificationId
  return typeof jobId === "string"
    ? {
        jobId,
        notificationId: typeof notificationId === "string" ? notificationId : null,
      }
    : null
}
