import {
  BoxGeometry,
  EdgesGeometry,
  Group,
  LineBasicMaterial,
  LineSegments,
  Mesh,
  MeshLambertMaterial,
  type Vector3,
} from "three"
import { MESSAGE_KINDS, type MessageKind, type MessageStacks } from "@/lib/notifications/message-stacks"

export type MessageStackColors = Readonly<Record<MessageKind, number>>

const TILE = 0.2
const TILE_HEIGHT = 0.045
const GAP = 0.012
/** Taller stacks are capped so one busy job can't swallow the view. */
const MAX_TILES = 12

export type BuiltMessageStacks = {
  readonly group: Group
  /** Pickable tiles; each carries userData.jobId. */
  readonly meshes: readonly Mesh[]
  /** World position just above each job's stack, for labels. */
  readonly tops: ReadonlyMap<string, Vector3>
  readonly dispose: () => void
}

/**
 * One thin tile per unread item, stacked on top of each job's marker and
 * ordered by kind so colors read as bands. Built fresh whenever the stacks
 * or markers change; the caller adds `group` to the scene.
 */
export function buildMessageStacks(
  stacks: MessageStacks,
  markerTops: ReadonlyMap<string, Vector3>,
  colors: MessageStackColors,
): BuiltMessageStacks {
  const group = new Group()
  const geometry = new BoxGeometry(TILE, TILE_HEIGHT, TILE)
  const edgeGeometry = new EdgesGeometry(geometry)
  const edgeMaterial = new LineBasicMaterial({ color: 0x0b120e, transparent: true, opacity: 0.45 })
  const materials = new Map<MessageKind, MeshLambertMaterial>(
    MESSAGE_KINDS.map((kind) => [kind, new MeshLambertMaterial({ color: colors[kind] })]),
  )
  const meshes: Mesh[] = []
  const tops = new Map<string, Vector3>()
  for (const [jobId, kinds] of stacks) {
    const top = markerTops.get(jobId)
    if (!top || kinds.length === 0) continue
    const ordered = [...kinds].sort((a, b) => MESSAGE_KINDS.indexOf(a) - MESSAGE_KINDS.indexOf(b)).slice(0, MAX_TILES)
    ordered.forEach((kind, index) => {
      const material = materials.get(kind)
      if (!material) return
      const tile = new Mesh(geometry, material)
      tile.position.set(top.x, top.y + 0.04 + TILE_HEIGHT / 2 + index * (TILE_HEIGHT + GAP), top.z)
      tile.userData.jobId = jobId
      tile.add(new LineSegments(edgeGeometry, edgeMaterial))
      group.add(tile)
      meshes.push(tile)
    })
    const stackTop = top.clone()
    stackTop.y += 0.04 + ordered.length * (TILE_HEIGHT + GAP)
    tops.set(jobId, stackTop)
  }
  return {
    group,
    meshes,
    tops,
    dispose: () => {
      geometry.dispose()
      edgeGeometry.dispose()
      edgeMaterial.dispose()
      for (const material of materials.values()) material.dispose()
    },
  }
}
