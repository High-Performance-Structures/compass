import {
  AmbientLight,
  BoxGeometry,
  BufferGeometry,
  CanvasTexture,
  Color,
  ColorManagement,
  DataTexture,
  DirectionalLight,
  DoubleSide,
  EdgesGeometry,
  Float32BufferAttribute,
  LinearSRGBColorSpace,
  LineBasicMaterial,
  LineLoop,
  LineSegments,
  Mesh,
  MeshBasicMaterial,
  MeshLambertMaterial,
  OctahedronGeometry,
  OrthographicCamera,
  PlaneGeometry,
  Raycaster,
  Scene,
  ShaderMaterial,
  Shape,
  ShapeGeometry,
  type Texture,
  Vector2,
  Vector3,
  Vector4,
  WebGLRenderer,
  type Object3D,
} from "three"
import { portfolioMarkerAlert, type PortfolioMapJob, type PortfolioPhaseId } from "@/lib/portfolio-map/model"
import type { MessageStacks } from "@/lib/notifications/message-stacks"
import { pickPortfolioTarget, type PortfolioPick } from "./portfolio-picking"
import {
  buildMessageStacks,
  type BuiltMessageStacks,
  type MessageStackColors,
} from "@/components/dashboard/portfolio-map/portfolio-message-stacks"
import {
  MAX_ELEVATION_BANDS,
  MAX_ZONE_EDGES,
  TOP_FRAGMENT,
  TOP_VERTEX,
  WALL_FRAGMENT,
  WALL_VERTEX,
} from "@/components/dashboard/portfolio-map/portfolio-shaders"
import {
  WeatherOverlay,
  type FireSceneView,
  type WeatherSceneView,
} from "@/components/dashboard/portfolio-map/portfolio-weather-scene"

const TERRAIN_URL = "/maps/colorado-terrain-v1.json"

/** The terrain file for a state's map (Colorado keeps its original file). */
export function terrainUrlForState(state: string): string {
  return state === "CO" ? TERRAIN_URL : `/maps/states/${state.toLowerCase()}-terrain-v1.json`
}

export type SceneLabel = {
  readonly key: string
  readonly x: number
  readonly y: number
  readonly title: string
  readonly sub: string
  readonly tone: "landmark" | "hover" | "selected"
}

export type SceneJobColors = {
  readonly phase: Readonly<Record<PortfolioPhaseId, number>>
  /** Per-job colors that replace the phase color (the sales pipeline's stages). */
  readonly byJobId?: ReadonlyMap<string, number>
  readonly risk: number
  readonly late: number
}

/** Optional overlays shaded onto the terrain surface. */
export type SceneLayers = {
  readonly zones: {
    readonly home: { readonly label: string; readonly lat: number; readonly lon: number }
    /** Outer edge of each bounded zone in whole miles (the last zone is open-ended). */
    readonly edgesMiles: readonly number[]
    readonly color: number
  } | null
  readonly elevation: {
    readonly bandsFeet: readonly number[]
    readonly color: number
  } | null
}

export type SceneHighlight = {
  readonly selectedJobId: string | null
  readonly hoveredJobId: string | null
  readonly selectedPhase: PortfolioPhaseId | null
}

type SceneCallbacks = {
  readonly onSelect: (jobId: string | null, notificationId: string | null) => void
  readonly onHover: (jobId: string | null) => void
  readonly onLabels: (labels: readonly SceneLabel[]) => void
  readonly onReady: () => void
  readonly onError: () => void
}

type TerrainGrid = {
  readonly w: number
  readonly h: number
  readonly west: number
  readonly east: number
  readonly north: number
  readonly south: number
  readonly min: number
  readonly max: number
  readonly meters: Uint16Array
}

type TerrainLabel = { readonly title: string; readonly sub: string; readonly lon: number; readonly lat: number }

type TerrainData = {
  readonly grid: TerrainGrid
  readonly roads: readonly (readonly number[])[]
  /** State outline rings as flat lon,lat pairs; absent for a rectangular state like Colorado. */
  readonly outline: readonly (readonly number[])[] | null
  readonly labels: readonly TerrainLabel[] | null
}

/** World-space size and height mapping for the loaded state. */
type TerrainFrame = {
  readonly w: number
  readonly d: number
  readonly baseMeters: number
  readonly unitsPerMeter: number
}

type Marker = {
  readonly job: PortfolioMapJob
  readonly mesh: Mesh
  readonly material: MeshLambertMaterial
  readonly edges: LineBasicMaterial
  readonly flag: Mesh | null
  readonly flagMaterial: MeshBasicMaterial | null
  readonly top: Vector3
}

type View = { tx: number; ty: number; tz: number; az: number; el: number; zoom: number }

// The block fits inside this footprint (Colorado fills it exactly).
const MAX_W = 13.6
const MAX_D = 10
const VERTICAL_SCALE = 1.7
// Flat states get their relief stretched to at least this height so the terrain still reads.
const MIN_RELIEF = 0.4
// Outline wall segments averaged on each side of a corner for its lighting.
const WALL_SMOOTHING = 6
const BASE = -0.7
const CAMERA_DISTANCE = 40
const DEFAULT_VIEW: Readonly<View> = { tx: 0, ty: 0.05, tz: 0, az: 0.55, el: 0.48, zoom: 1 }
const ROAD_STYLE = [
  { color: 0xa8e2ec, opacity: 0.9 },
  { color: 0x7fbcc4, opacity: 0.5 },
  { color: 0x6fafb8, opacity: 0.3 },
] as const
const LANDMARKS = [
  { title: "DENVER", sub: "STATE CAPITAL", lon: -104.99, lat: 39.74 },
  { title: "PIKES PEAK", sub: "14,115 FT", lon: -105.042, lat: 38.841 },
  { title: "LONGS PEAK", sub: "14,259 FT", lon: -105.616, lat: 40.255 },
  { title: "MT. ELBERT", sub: "14,440 FT", lon: -106.445, lat: 39.118 },
  { title: "GRAND JUNCTION", sub: "WESTERN SLOPE", lon: -108.55, lat: 39.06 },
  { title: "DURANGO", sub: "SAN JUANS", lon: -107.88, lat: 37.27 },
] as const

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function numberField(record: Readonly<Record<string, unknown>>, key: string): number {
  const value = record[key]
  if (typeof value !== "number" || !Number.isFinite(value)) throw new Error(`terrain ${key}`)
  return value
}

/** Validate the cached terrain file instead of trusting its shape. */
export function parseTerrainData(value: unknown): TerrainData {
  if (!isRecord(value) || !isRecord(value.grid) || !Array.isArray(value.roads)) {
    throw new Error("terrain shape")
  }
  const grid = value.grid
  const encoded = grid.u16
  if (typeof encoded !== "string") throw new Error("terrain grid")
  const binary = atob(encoded)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i)
  const w = numberField(grid, "w")
  const h = numberField(grid, "h")
  const meters = new Uint16Array(bytes.buffer)
  if (meters.length !== w * h) throw new Error("terrain size")
  const roads = value.roads.filter(
    (road): road is number[] =>
      Array.isArray(road) && road.length >= 5 && road.every((item) => typeof item === "number"),
  )
  const outline = Array.isArray(value.outline)
    ? value.outline.filter(
        (ring): ring is number[] =>
          Array.isArray(ring) && ring.length >= 6 && ring.every((item) => typeof item === "number"),
      )
    : []
  const labels = Array.isArray(value.labels)
    ? value.labels.flatMap((label): TerrainLabel[] => {
        if (!isRecord(label) || typeof label.title !== "string" || typeof label.sub !== "string") return []
        if (typeof label.lon !== "number" || typeof label.lat !== "number") return []
        return [{ title: label.title, sub: label.sub, lon: label.lon, lat: label.lat }]
      })
    : null
  return {
    outline: outline.length > 0 ? outline : null,
    labels,
    grid: {
      w,
      h,
      west: numberField(grid, "west"),
      east: numberField(grid, "east"),
      north: numberField(grid, "north"),
      south: numberField(grid, "south"),
      min: numberField(grid, "min"),
      max: numberField(grid, "max"),
      meters,
    },
    roads,
  }
}

/**
 * Fit the state into the footprint at its true east-west to north-south proportion, and map
 * meters to height at Colorado's scale (stretched for flat states).
 */
export function terrainFrame(grid: {
  readonly west: number
  readonly east: number
  readonly north: number
  readonly south: number
  readonly min: number
  readonly max: number
}): TerrainFrame {
  const midLat = ((grid.north + grid.south) / 2) * (Math.PI / 180)
  const aspect = ((grid.east - grid.west) * Math.cos(midLat)) / (grid.north - grid.south)
  const w = aspect >= MAX_W / MAX_D ? MAX_W : MAX_D * aspect
  const d = aspect >= MAX_W / MAX_D ? MAX_W / aspect : MAX_D
  const baseMeters = Math.min(1000, grid.min)
  const unitsPerMeter = Math.max(VERTICAL_SCALE / 3400, MIN_RELIEF / Math.max(grid.max - baseMeters, 1))
  return { w, d, baseMeters, unitsPerMeter }
}

/** Point-in-polygon test against flat lon,lat rings. */
function insideOutline(outline: readonly (readonly number[])[], lon: number, lat: number): boolean {
  let inside = false
  for (const ring of outline) {
    for (let k = 0, j = ring.length - 2; k < ring.length; j = k, k += 2) {
      const xi = ring[k] ?? 0
      const yi = ring[k + 1] ?? 0
      const xj = ring[j] ?? 0
      const yj = ring[j + 1] ?? 0
      if (yi > lat !== yj > lat && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) inside = !inside
    }
  }
  return inside
}

/**
 * Drop labels whose approximate box overlaps one already placed, in priority
 * order. Hidden landmark labels reappear as the camera zooms in.
 */
export function placeWithoutOverlap(labels: readonly SceneLabel[]): readonly SceneLabel[] {
  const boxes: { left: number; right: number; top: number; bottom: number }[] = []
  const placed: SceneLabel[] = []
  for (const label of labels) {
    const stem = label.tone === "landmark" ? 14 : 24
    const width = Math.max(label.title.length, label.sub.length) * 8 + 14
    const box = { left: label.x - 4, right: label.x + width, top: label.y - stem - 34, bottom: label.y + 4 }
    const collides = boxes.some(
      (other) => box.left < other.right && box.right > other.left && box.top < other.bottom && box.bottom > other.top,
    )
    if (collides) continue
    boxes.push(box)
    placed.push(label)
  }
  return placed
}

/**
 * The portfolio terrain map. Owns the WebGL renderer and renders only when
 * something changes (interaction, camera motion, highlight), never in a loop.
 */
export class PortfolioScene {
  private readonly renderer: WebGLRenderer
  private readonly scene = new Scene()
  private readonly camera = new OrthographicCamera(-1, 1, 1, -1, 0.1, 200)
  private readonly raycaster = new Raycaster()
  private readonly pointer = new Vector2()
  private readonly scratch = new Vector3()
  private readonly disposables: { dispose: () => void }[] = []
  private readonly jobObjects: Object3D[] = []
  // Messages layer: unread-item tiles stacked on job markers.
  private messageStacks: { readonly stacks: MessageStacks; readonly colors: MessageStackColors } | null = null
  private builtStacks: BuiltMessageStacks | null = null
  private readonly view: View = { ...DEFAULT_VIEW }
  private grid: TerrainGrid | null = null
  private terrain: TerrainFrame = { w: MAX_W, d: MAX_D, baseMeters: 1000, unitsPerMeter: VERTICAL_SCALE / 3400 }
  private outline: readonly (readonly number[])[] | null = null
  private topMaterial: ShaderMaterial | null = null
  private layers: SceneLayers = { zones: null, elevation: null }
  private layerLabels: { readonly key: string; readonly title: string; readonly sub: string; readonly point: Vector3 }[] = []
  private markers: Marker[] = []
  private landmarks: { readonly title: string; readonly sub: string; readonly point: Vector3 }[] = []
  private focusSelectedPending = false
  private highlight: SceneHighlight = { selectedJobId: null, hoveredJobId: null, selectedPhase: null }
  private pendingJobs: { readonly jobs: readonly PortfolioMapJob[]; readonly colors: SceneJobColors } | null = null
  private size = { w: 1, h: 1 }
  private frame: number | null = null
  private animation: { from: View; to: View; start: number } | null = null
  private drag: { x: number; y: number; az: number; el: number; moved: boolean } | null = null
  private labelSignature = ""
  // Weather and Fire & smoke layers, created the first time either is shown.
  private weatherOverlay: WeatherOverlay | null = null
  private pendingWeather: WeatherSceneView | null = null
  private pendingFire: FireSceneView | null = null
  private labelView = ""
  // Set by anything that may change labels; animation-only frames leave it clear.
  private labelsDirty = true
  private disposed = false
  private readonly resizeObserver: ResizeObserver
  // Weather animation pauses while the map is scrolled out of view.
  private readonly visibilityObserver: IntersectionObserver | null
  private onScreen = true
  private readonly reduceMotion: boolean

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly container: HTMLElement,
    private readonly callbacks: SceneCallbacks,
    private readonly terrainUrl: string = TERRAIN_URL,
  ) {
    // The scene's palette is authored in display (sRGB) values; skip linear conversion.
    ColorManagement.enabled = false
    // Transparent canvas: the block floats on the page instead of a black box.
    this.renderer = new WebGLRenderer({ canvas, antialias: true, alpha: true })
    this.renderer.outputColorSpace = LinearSRGBColorSpace
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2))
    this.renderer.setClearColor(0x000000, 0)
    this.scene.add(new AmbientLight(0xffffff, 0.6 * Math.PI))
    const sun = new DirectionalLight(0xffffff, 0.75 * Math.PI)
    sun.position.set(-4, 8, 3)
    this.scene.add(sun)
    this.reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches
    canvas.addEventListener("pointerdown", this.handleDown)
    canvas.addEventListener("pointermove", this.handleMove)
    canvas.addEventListener("pointerup", this.handleUp)
    canvas.addEventListener("pointerleave", this.handleLeave)
    // Non-passive so zooming the map does not scroll the dashboard.
    canvas.addEventListener("wheel", this.handleWheel, { passive: false })
    this.resizeObserver = new ResizeObserver(() => this.resize())
    this.resizeObserver.observe(container)
    this.visibilityObserver =
      typeof IntersectionObserver === "undefined"
        ? null
        : new IntersectionObserver((entries) => {
            const visible = entries.some((entry) => entry.isIntersecting)
            if (visible === this.onScreen) return
            this.onScreen = visible
            if (visible) this.requestRender()
          })
    this.visibilityObserver?.observe(container)
    this.resize()
    void this.loadTerrain()
  }

  private async loadTerrain(): Promise<void> {
    try {
      // A versioned static file with an immutable cache header: fetched once per release.
      const response = await fetch(this.terrainUrl)
      if (!response.ok) throw new Error(`terrain ${response.status}`)
      const data = parseTerrainData(await response.json())
      if (this.disposed) return
      this.grid = data.grid
      this.terrain = terrainFrame(data.grid)
      this.outline = data.outline
      this.buildTerrain(data)
      if (this.pendingJobs) this.setJobs(this.pendingJobs.jobs, this.pendingJobs.colors)
      this.applyLayers()
      if (this.pendingWeather) this.setWeather(this.pendingWeather)
      if (this.pendingFire) this.setFire(this.pendingFire)
      this.callbacks.onReady()
      this.requestRender()
    } catch (error) {
      console.error("Portfolio terrain failed", error)
      if (!this.disposed) this.callbacks.onError()
    }
  }

  private heightAt(lon: number, lat: number): number {
    const g = this.grid
    if (!g) return 0
    const fx = Math.max(0, Math.min(g.w - 1.001, ((lon - g.west) / (g.east - g.west)) * (g.w - 1)))
    const fy = Math.max(0, Math.min(g.h - 1.001, ((g.north - lat) / (g.north - g.south)) * (g.h - 1)))
    const x0 = Math.floor(fx)
    const y0 = Math.floor(fy)
    const tx = fx - x0
    const ty = fy - y0
    const at = (x: number, y: number): number => g.meters[y * g.w + x] ?? 0
    const top = at(x0, y0) * (1 - tx) + at(x0 + 1, y0) * tx
    const bottom = at(x0, y0 + 1) * (1 - tx) + at(x0 + 1, y0 + 1) * tx
    return this.toY(top * (1 - ty) + bottom * ty)
  }

  /** Inside the loaded state: its outline, or the grid's rectangle for Colorado. */
  private inState(lon: number, lat: number): boolean {
    const g = this.grid
    if (!g || lon < g.west || lon > g.east || lat < g.south || lat > g.north) return false
    return !this.outline || insideOutline(this.outline, lon, lat)
  }

  private toY(meters: number): number {
    return (meters - this.terrain.baseMeters) * this.terrain.unitsPerMeter
  }

  private worldXZ(lon: number, lat: number): readonly [number, number] {
    const g = this.grid
    if (!g) return [0, 0]
    return [
      ((lon - g.west) / (g.east - g.west) - 0.5) * this.terrain.w,
      ((g.north - lat) / (g.north - g.south) - 0.5) * this.terrain.d,
    ]
  }

  private track<T extends { dispose: () => void }>(item: T): T {
    this.disposables.push(item)
    return item
  }

  /**
   * The carved block's top edge loops: the grid's rectangle, or each outline ring sampled
   * finely enough to follow the terrain.
   */
  private carvedEdges(data: TerrainData): (readonly [number, number, number])[][] {
    const g = data.grid
    if (!data.outline) {
      const { w: W, d: D } = this.terrain
      const gx = (i: number): number => (i / (g.w - 1) - 0.5) * W
      const gz = (j: number): number => (j / (g.h - 1) - 0.5) * D
      const hy = (i: number, j: number): number => this.toY(g.meters[j * g.w + i] ?? 0)
      const edge: [number, number, number][] = []
      for (let i = 0; i < g.w; i += 1) edge.push([gx(i), hy(i, 0), gz(0)])
      for (let j = 1; j < g.h; j += 1) edge.push([gx(g.w - 1), hy(g.w - 1, j), gz(j)])
      for (let i = g.w - 2; i >= 0; i -= 1) edge.push([gx(i), hy(i, g.h - 1), gz(g.h - 1)])
      for (let j = g.h - 2; j >= 0; j -= 1) edge.push([gx(0), hy(0, j), gz(j)])
      return [edge]
    }
    const stepDeg = (g.east - g.west) / (g.w - 1)
    return data.outline.map((ring) => {
      const edge: [number, number, number][] = []
      for (let k = 0; k < ring.length; k += 2) {
        const lon0 = ring[k] ?? 0
        const lat0 = ring[k + 1] ?? 0
        const lon1 = ring[(k + 2) % ring.length] ?? lon0
        const lat1 = ring[(k + 3) % ring.length] ?? lat0
        const steps = Math.max(1, Math.ceil(Math.hypot(lon1 - lon0, lat1 - lat0) / stepDeg))
        for (let s = 0; s < steps; s += 1) {
          const lon = lon0 + ((lon1 - lon0) * s) / steps
          const lat = lat0 + ((lat1 - lat0) * s) / steps
          const [x, z] = this.worldXZ(lon, lat)
          edge.push([x, this.heightAt(lon, lat), z])
        }
      }
      return edge
    })
  }

  /** Inside-the-state mask for the top surface (white everywhere for a rectangular state). */
  private outlineMask(data: TerrainData): Texture {
    if (!data.outline) return new DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1)
    const g = data.grid
    const scale = 1024 / Math.max(this.terrain.w, this.terrain.d)
    const canvas = document.createElement("canvas")
    canvas.width = Math.round(this.terrain.w * scale)
    canvas.height = Math.round(this.terrain.d * scale)
    const context = canvas.getContext("2d")
    if (context) {
      context.fillStyle = "#fff"
      context.beginPath()
      for (const ring of data.outline) {
        for (let k = 0; k < ring.length; k += 2) {
          const x = (((ring[k] ?? 0) - g.west) / (g.east - g.west)) * canvas.width
          const y = ((g.north - (ring[k + 1] ?? 0)) / (g.north - g.south)) * canvas.height
          if (k === 0) context.moveTo(x, y)
          else context.lineTo(x, y)
        }
        context.closePath()
      }
      context.fill()
    }
    const texture = new CanvasTexture(canvas)
    // Row 0 is the north edge, matching the shader's v.
    texture.flipY = false
    return texture
  }

  private buildTerrain(data: TerrainData): void {
    const g = data.grid
    const { w: W, d: D } = this.terrain
    const geometry = this.track(new PlaneGeometry(W, D, g.w - 1, g.h - 1))
    geometry.rotateX(-Math.PI / 2)
    const position = geometry.getAttribute("position")
    let maxH = 0
    for (let k = 0; k < position.count; k += 1) {
      const y = this.toY(g.meters[k] ?? 0)
      position.setY(k, y)
      maxH = Math.max(maxH, y)
    }
    geometry.computeVertexNormals()
    const depth = { uNear: { value: CAMERA_DISTANCE - 10 }, uFar: { value: CAMERA_DISTANCE + 10 } }
    const mask = this.track(this.outlineMask(data))
    const topMaterial = this.track(
      new ShaderMaterial({
        uniforms: {
          ...depth,
          uMaxH: { value: maxH },
          uLow: { value: new Color(0x111914) },
          uHigh: { value: new Color(0x7f938b) },
          uGeo: { value: new Vector4(g.west, g.east, g.north, g.south) },
          uSize: { value: new Vector2(W, D) },
          uMask: { value: mask },
          uMaskOn: { value: data.outline ? 1 : 0 },
          uZonesOn: { value: 0 },
          uHome: { value: new Vector2(0, 0) },
          uZoneEdges: { value: new Array<number>(MAX_ZONE_EDGES).fill(0) },
          uZoneEdgeCount: { value: 0 },
          uZoneColor: { value: new Color(0xffffff) },
          uElevOn: { value: 0 },
          uBandY: { value: new Array<number>(MAX_ELEVATION_BANDS).fill(0) },
          uBandCount: { value: 0 },
          uElevColor: { value: new Color(0xffffff) },
        },
        vertexShader: TOP_VERTEX,
        fragmentShader: TOP_FRAGMENT,
        polygonOffset: true,
        polygonOffsetFactor: 1,
        polygonOffsetUnits: 1,
      }),
    )
    this.scene.add(new Mesh(geometry, topMaterial))
    this.topMaterial = topMaterial

    // Walls from the carved edge (the grid's rectangle, or the state outline) down to a flat base.
    const edges = this.carvedEdges(data)
    const wallPositions: number[] = []
    const wallNormals: number[] = []
    for (const edge of edges) {
      const faces = edge.map((p, index) => {
        const q = edge[(index + 1) % edge.length] ?? p
        const length = Math.hypot(q[2] - p[2], q[0] - p[0]) || 1
        return [(q[2] - p[2]) / length, -(q[0] - p[0]) / length] as const
      })
      // A jagged outline lights as flickering stripes; corners of the rectangle stay sharp.
      const smooth = data.outline !== null
      // Average the faces around each corner (a few segments each way), so winding river borders shade evenly.
      const corner = (index: number): readonly [number, number] => {
        let x = 0
        let z = 0
        for (let k = -WALL_SMOOTHING; k < WALL_SMOOTHING; k += 1) {
          const face = faces[(index + k + faces.length) % faces.length] ?? [0, 0]
          x += face[0]
          z += face[1]
        }
        const length = Math.hypot(x, z) || 1
        return [x / length, z / length]
      }
      edge.forEach((p, index) => {
        const next = (index + 1) % edge.length
        const q = edge[next] ?? p
        const quad = [
          p[0], p[1], p[2], p[0], BASE, p[2], q[0], q[1], q[2],
          q[0], q[1], q[2], p[0], BASE, p[2], q[0], BASE, q[2],
        ]
        wallPositions.push(...quad)
        const [px, pz] = smooth ? corner(index) : (faces[index] ?? [0, 0])
        const [qx, qz] = smooth ? corner(next) : (faces[index] ?? [0, 0])
        wallNormals.push(px, 0, pz, px, 0, pz, qx, 0, qz, qx, 0, qz, px, 0, pz, qx, 0, qz)
      })
    }
    const wallGeometry = this.track(new BufferGeometry())
    wallGeometry.setAttribute("position", new Float32BufferAttribute(wallPositions, 3))
    wallGeometry.setAttribute("normal", new Float32BufferAttribute(wallNormals, 3))
    const wallMaterial = this.track(
      new ShaderMaterial({
        side: DoubleSide,
        uniforms: { ...depth, uBase: { value: BASE }, uTop: { value: maxH } },
        vertexShader: WALL_VERTEX,
        fragmentShader: WALL_FRAGMENT,
      }),
    )
    this.scene.add(new Mesh(wallGeometry, wallMaterial))
    const bottomMaterial = this.track(new MeshBasicMaterial({ color: 0x050806, side: DoubleSide }))
    const rimMaterial = this.track(new LineBasicMaterial({ color: 0xc6d6cf, transparent: true, opacity: 0.8 }))
    const footMaterial = this.track(new LineBasicMaterial({ color: 0x8c9c95, transparent: true, opacity: 0.7 }))
    for (const edge of edges) {
      // Shape x,y become world x,z after the quarter turn.
      const bottomGeometry = this.track(new ShapeGeometry(new Shape(edge.map((p) => new Vector2(p[0], p[2])))))
      bottomGeometry.rotateX(Math.PI / 2)
      bottomGeometry.translate(0, BASE, 0)
      this.scene.add(new Mesh(bottomGeometry, bottomMaterial))
      const rimGeometry = this.track(
        new BufferGeometry().setFromPoints(edge.map((p) => new Vector3(p[0], p[1] + 0.004, p[2]))),
      )
      this.scene.add(new LineLoop(rimGeometry, rimMaterial))
      const footGeometry = this.track(
        new BufferGeometry().setFromPoints(edge.map((p) => new Vector3(p[0], BASE, p[2]))),
      )
      this.scene.add(new LineLoop(footGeometry, footMaterial))
    }

    // Major roads (OpenStreetMap for Colorado, Census TIGER elsewhere): one batched line set per class, draped on the surface.
    const buckets: number[][] = [[], [], []]
    for (const road of data.roads) {
      const roadClass = road[0] ?? 2
      const out = buckets[roadClass] ?? buckets[2]
      if (!out) continue
      for (let r = 1; r + 3 < road.length; r += 2) {
        const lon0 = road[r] ?? 0
        const lat0 = road[r + 1] ?? 0
        const lon1 = road[r + 2] ?? 0
        const lat1 = road[r + 3] ?? 0
        const a = this.worldXZ(lon0, lat0)
        const b = this.worldXZ(lon1, lat1)
        const steps = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / 0.06))
        let previous: readonly [number, number, number] | null = null
        for (let s = 0; s <= steps; s += 1) {
          const t = s / steps
          const lon = lon0 + (lon1 - lon0) * t
          const lat = lat0 + (lat1 - lat0) * t
          const xz = this.worldXZ(lon, lat)
          const current: readonly [number, number, number] = [xz[0], this.heightAt(lon, lat) + 0.02, xz[1]]
          if (previous) out.push(...previous, ...current)
          previous = current
        }
      }
    }
    buckets.forEach((positions, roadClass) => {
      const style = ROAD_STYLE[roadClass]
      if (!style || positions.length === 0) return
      const roadGeometry = this.track(new BufferGeometry())
      roadGeometry.setAttribute("position", new Float32BufferAttribute(positions, 3))
      const lines = new LineSegments(
        roadGeometry,
        this.track(new LineBasicMaterial({ color: style.color, transparent: true, opacity: style.opacity })),
      )
      lines.renderOrder = 3 - roadClass
      this.scene.add(lines)
    })

    this.landmarks = (data.labels ?? LANDMARKS).map((landmark) => {
      const xz = this.worldXZ(landmark.lon, landmark.lat)
      return {
        title: landmark.title,
        sub: landmark.sub,
        point: new Vector3(xz[0], this.heightAt(landmark.lon, landmark.lat) + 0.02, xz[1]),
      }
    })
  }

  /** Columns (height = % built) under construction; slabs before and after. */
  setJobs(jobs: readonly PortfolioMapJob[], colors: SceneJobColors): void {
    if (!this.grid) {
      this.pendingJobs = { jobs, colors }
      return
    }
    this.pendingJobs = null
    for (const object of this.jobObjects) this.scene.remove(object)
    this.jobObjects.length = 0
    for (const marker of this.markers) {
      marker.mesh.geometry.dispose()
      marker.material.dispose()
      marker.edges.dispose()
      marker.flag?.geometry.dispose()
      marker.flagMaterial?.dispose()
    }
    this.markers = jobs.flatMap((job): Marker[] => {
      if (job.lon === null || job.lat === null) return []
      // Jobs in other states stay in the job list but have no place on this map.
      if (!this.inState(job.lon, job.lat)) return []
      const xz = this.worldXZ(job.lon, job.lat)
      const ground = this.heightAt(job.lon, job.lat)
      const building = job.phase === "construction"
      const height = building ? 0.25 + ((job.progress ?? 0) / 100) * 1.2 : 0.06
      const width = building ? 0.17 : 0.3
      const geometry = new BoxGeometry(width, height, width)
      const material = new MeshLambertMaterial({
        color: colors.byJobId?.get(job.id) ?? colors.phase[job.phase],
        transparent: true,
      })
      const mesh = new Mesh(geometry, material)
      mesh.position.set(xz[0], ground + height / 2 + 0.01, xz[1])
      mesh.userData.jobId = job.id
      const edges = new LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.35 })
      const edgeGeometry = new EdgesGeometry(geometry)
      mesh.add(new LineSegments(edgeGeometry, edges))
      this.disposables.push(edgeGeometry)
      this.scene.add(mesh)
      this.jobObjects.push(mesh)
      let flag: Mesh | null = null
      let flagMaterial: MeshBasicMaterial | null = null
      const alert = portfolioMarkerAlert(job)
      if (alert) {
        flagMaterial = new MeshBasicMaterial({
          color: alert === "late" ? colors.late : colors.risk,
          transparent: true,
        })
        flag = new Mesh(new OctahedronGeometry(0.06), flagMaterial)
        flag.position.set(xz[0], ground + height + 0.18, xz[1])
        this.scene.add(flag)
        this.jobObjects.push(flag)
      }
      return [{ job, mesh, material, edges, flag, flagMaterial, top: new Vector3(xz[0], ground + height + 0.02, xz[1]) }]
    })
    this.applyHighlight()
    this.rebuildMessageStacks()
    const focus = this.focusSelectedPending
      ? this.markers.find((item) => item.job.id === this.highlight.selectedJobId)
      : undefined
    if (focus) {
      this.focusSelectedPending = false
      this.flyTo(focus.top.x, focus.top.y * 0.6, focus.top.z, Math.max(this.view.zoom, 2.8))
    }
  }

  /** Show (or with null, hide) the Messages layer's tile stacks. */
  setMessageStacks(stacks: MessageStacks | null, colors: MessageStackColors): void {
    this.messageStacks = stacks ? { stacks, colors } : null
    this.rebuildMessageStacks()
  }

  private rebuildMessageStacks(): void {
    if (this.builtStacks) {
      this.scene.remove(this.builtStacks.group)
      this.builtStacks.dispose()
      this.builtStacks = null
    }
    if (this.messageStacks && this.markers.length > 0) {
      const tops = new Map(this.markers.map((marker) => [marker.job.id, marker.top]))
      this.builtStacks = buildMessageStacks(this.messageStacks.stacks, tops, this.messageStacks.colors)
      this.scene.add(this.builtStacks.group)
    }
    this.requestRender()
  }

  /** Fly to the selected job once its marker exists (used by single-job views). */
  focusSelectedWhenPlaced(): void {
    this.focusSelectedPending = true
  }

  private overlay(): WeatherOverlay | null {
    const g = this.grid
    if (!g) return null
    if (!this.weatherOverlay) {
      this.weatherOverlay = new WeatherOverlay({
        scene: this.scene,
        ground: (lon, lat, lift) => {
          const [x, z] = this.worldXZ(lon, lat)
          return new Vector3(x, this.heightAt(lon, lat) + lift, z)
        },
        unitsPerDegree: { lon: this.terrain.w / (g.east - g.west), lat: this.terrain.d / (g.north - g.south) },
        inBounds: (lon, lat) => this.inState(lon, lat),
        reduceMotion: this.reduceMotion,
      })
    }
    return this.weatherOverlay
  }

  /** Show (or with null, hide) the Weather layer at the time bar's step. */
  setWeather(view: WeatherSceneView | null): void {
    this.pendingWeather = view
    const overlay = view || this.weatherOverlay ? this.overlay() : null
    if (!overlay) return
    overlay.setWeather(view)
    this.labelSignature = ""
    this.requestRender()
  }

  /** Show (or with null, hide) the Fire & smoke layer. */
  setFire(view: FireSceneView | null): void {
    this.pendingFire = view
    const overlay = view || this.weatherOverlay ? this.overlay() : null
    if (!overlay) return
    overlay.setFire(view)
    this.labelSignature = ""
    this.requestRender()
  }

  setLayers(layers: SceneLayers): void {
    this.layers = layers
    this.applyLayers()
  }

  private applyLayers(): void {
    const material = this.topMaterial
    if (!material || !this.grid) return
    const u = material.uniforms
    const { zones, elevation } = this.layers
    this.layerLabels = []
    if (zones) {
      const edges = zones.edgesMiles.slice(0, MAX_ZONE_EDGES)
      u.uZonesOn.value = 1
      u.uHome.value.set(zones.home.lon, zones.home.lat)
      u.uZoneEdges.value = [...edges, ...new Array<number>(MAX_ZONE_EDGES - edges.length).fill(0)]
      u.uZoneEdgeCount.value = edges.length
      u.uZoneColor.value.setHex(zones.color)
      const homeXZ = this.worldXZ(zones.home.lon, zones.home.lat)
      this.layerLabels.push({
        key: "layer:home",
        title: zones.home.label.toUpperCase(),
        sub: "HOME BASE",
        point: new Vector3(homeXZ[0], this.heightAt(zones.home.lon, zones.home.lat) + 0.02, homeXZ[1]),
      })
      // Ring distance labels on the south side of each ring.
      edges.forEach((miles, index) => {
        const lat = zones.home.lat - miles / 69.05
        const xz = this.worldXZ(zones.home.lon, lat)
        this.layerLabels.push({
          key: `layer:ring:${index}`,
          title: `${miles} MI`,
          sub: `END OF ZONE ${index}`,
          point: new Vector3(xz[0], this.heightAt(zones.home.lon, lat) + 0.02, xz[1]),
        })
      })
    } else {
      u.uZonesOn.value = 0
    }
    if (elevation) {
      const bands = elevation.bandsFeet.slice(0, MAX_ELEVATION_BANDS)
      u.uElevOn.value = 1
      u.uBandY.value = [
        ...bands.map((feet) => this.toY(feet * 0.3048)),
        ...new Array<number>(MAX_ELEVATION_BANDS - bands.length).fill(0),
      ]
      u.uBandCount.value = bands.length
      u.uElevColor.value.setHex(elevation.color)
    } else {
      u.uElevOn.value = 0
    }
    this.labelSignature = ""
    this.requestRender()
  }

  setHighlight(next: SceneHighlight): void {
    const selectionChanged = next.selectedJobId !== this.highlight.selectedJobId
    this.highlight = next
    this.applyHighlight()
    if (selectionChanged && next.selectedJobId) {
      const marker = this.markers.find((item) => item.job.id === next.selectedJobId)
      if (marker) this.flyTo(marker.top.x, marker.top.y * 0.6, marker.top.z, Math.max(this.view.zoom, 2.4))
    }
  }

  private applyHighlight(): void {
    const { selectedJobId, hoveredJobId, selectedPhase } = this.highlight
    for (const marker of this.markers) {
      const selected = marker.job.id === selectedJobId
      const hovered = marker.job.id === hoveredJobId
      const dim = selectedPhase
        ? marker.job.phase !== selectedPhase
        : selectedJobId
          ? !selected && !hovered
          : false
      marker.material.opacity = dim ? 0.22 : 1
      marker.edges.color.setHex(selected ? 0xe8bf62 : 0xffffff)
      marker.edges.opacity = selected ? 1 : hovered ? 0.9 : dim ? 0.1 : 0.35
      marker.mesh.scale.set(selected ? 1.25 : 1, 1, selected ? 1.25 : 1)
      if (marker.flagMaterial) marker.flagMaterial.opacity = dim ? 0.25 : 1
    }
    this.requestRender()
  }

  zoomBy(factor: number): void {
    this.view.zoom = Math.max(0.7, Math.min(6, this.view.zoom * factor))
    this.animation = null
    this.requestRender()
  }

  rotateBy(radians: number): void {
    this.view.az += radians
    this.animation = null
    this.requestRender()
  }

  resetView(): void {
    this.view.az = DEFAULT_VIEW.az
    this.view.el = DEFAULT_VIEW.el
    this.flyTo(DEFAULT_VIEW.tx, DEFAULT_VIEW.ty, DEFAULT_VIEW.tz, DEFAULT_VIEW.zoom)
  }

  private flyTo(tx: number, ty: number, tz: number, zoom: number): void {
    const to: View = { ...this.view, tx, ty, tz, zoom }
    if (this.reduceMotion) {
      Object.assign(this.view, to)
      this.requestRender()
      return
    }
    this.animation = { from: { ...this.view }, to, start: performance.now() }
    this.requestRender()
  }

  private pick(event: PointerEvent): PortfolioPick | null {
    if (this.markers.length === 0) return null
    return pickPortfolioTarget(event, this.canvas, this.pointer, this.raycaster, this.camera,
      this.markers.map((marker) => marker.mesh), this.builtStacks?.meshes ?? [])
  }

  private readonly handleDown = (event: PointerEvent): void => {
    this.drag = { x: event.clientX, y: event.clientY, az: this.view.az, el: this.view.el, moved: false }
    this.canvas.setPointerCapture(event.pointerId)
  }

  private readonly handleMove = (event: PointerEvent): void => {
    if (this.drag) {
      const dx = event.clientX - this.drag.x
      const dy = event.clientY - this.drag.y
      if (Math.abs(dx) + Math.abs(dy) > 4) this.drag.moved = true
      this.view.az = this.drag.az - dx * 0.006
      this.view.el = Math.max(0.3, Math.min(1.3, this.drag.el + dy * 0.004))
      this.animation = null
      this.requestRender()
      return
    }
    const hovered = this.pick(event)?.jobId ?? null
    if (hovered !== this.highlight.hoveredJobId) this.callbacks.onHover(hovered)
  }

  private readonly handleUp = (event: PointerEvent): void => {
    const drag = this.drag
    this.drag = null
    if (this.canvas.hasPointerCapture(event.pointerId)) this.canvas.releasePointerCapture(event.pointerId)
    if (drag && !drag.moved) {
      const hit = this.pick(event)
      this.callbacks.onSelect(hit?.jobId ?? null, hit?.notificationId ?? null)
    }
  }

  private readonly handleLeave = (): void => {
    if (this.highlight.hoveredJobId) this.callbacks.onHover(null)
  }

  private readonly handleWheel = (event: WheelEvent): void => {
    event.preventDefault()
    this.zoomBy(Math.exp(-event.deltaY * 0.0015))
  }

  private resize(): void {
    const w = this.container.clientWidth
    const h = this.container.clientHeight
    if (w === 0 || h === 0) return
    this.size = { w, h }
    this.renderer.setSize(w, h, false)
    this.requestRender()
  }

  private requestRender(): void {
    this.labelsDirty = true
    this.requestFrame()
  }

  private requestFrame(): void {
    if (this.frame !== null || this.disposed) return
    this.frame = requestAnimationFrame(() => {
      this.frame = null
      this.render()
    })
  }

  private render(): void {
    const v = this.view
    if (this.animation) {
      const { from, to, start } = this.animation
      const t = Math.min(1, (performance.now() - start) / 700)
      const k = 1 - Math.pow(1 - t, 3)
      v.tx = from.tx + (to.tx - from.tx) * k
      v.ty = from.ty + (to.ty - from.ty) * k
      v.tz = from.tz + (to.tz - from.tz) * k
      v.zoom = from.zoom + (to.zoom - from.zoom) * k
      if (t >= 1) this.animation = null
    }
    const aspect = this.size.w / Math.max(1, this.size.h)
    const half = 5.6 / v.zoom
    this.camera.left = -half * aspect
    this.camera.right = half * aspect
    this.camera.top = half
    this.camera.bottom = -half
    this.camera.position.set(
      v.tx + Math.sin(v.az) * Math.cos(v.el) * CAMERA_DISTANCE,
      v.ty + Math.sin(v.el) * CAMERA_DISTANCE,
      v.tz + Math.cos(v.az) * Math.cos(v.el) * CAMERA_DISTANCE,
    )
    this.camera.lookAt(v.tx, v.ty, v.tz)
    this.camera.updateProjectionMatrix()
    const overlay = this.weatherOverlay
    if (overlay) {
      // Screen pixels (device) per world unit, for glows sized in world units.
      overlay.update(performance.now() / 1000, (this.size.h / (2 * half)) * this.renderer.getPixelRatio())
    }
    this.renderer.render(this.scene, this.camera)
    // Labels move only with the camera; skip the work on animation-only frames.
    const labelView = `${v.tx},${v.ty},${v.tz},${v.az},${v.el},${v.zoom},${this.size.w},${this.size.h}`
    if (this.labelsDirty || labelView !== this.labelView) {
      this.labelsDirty = false
      this.labelView = labelView
      this.emitLabels()
    }
    if (this.animation) this.requestRender()
    else if (overlay?.animating && this.onScreen) this.requestFrame()
  }

  private project(point: Vector3): { readonly x: number; readonly y: number; readonly onScreen: boolean } {
    this.scratch.copy(point).project(this.camera)
    return {
      x: Math.round(((this.scratch.x + 1) / 2) * this.size.w),
      y: Math.round(((1 - this.scratch.y) / 2) * this.size.h),
      onScreen: Math.abs(this.scratch.x) < 1.05 && Math.abs(this.scratch.y) < 1.05,
    }
  }

  private emitLabels(): void {
    const labels: SceneLabel[] = []
    const { selectedJobId, hoveredJobId } = this.highlight
    // Job labels first so they win any overlap with landmark labels.
    for (const marker of this.markers) {
      const selected = marker.job.id === selectedJobId
      if (!selected && marker.job.id !== hoveredJobId) continue
      // With the Messages layer on, the label sits above the job's tile stack.
      const screen = this.project(this.builtStacks?.tops.get(marker.job.id) ?? marker.top)
      if (!screen.onScreen) continue
      const unread = this.messageStacks?.stacks.get(marker.job.id)?.length ?? 0
      const town = marker.job.town ? marker.job.town.toUpperCase() : ""
      labels.push({
        key: marker.job.id,
        x: screen.x,
        y: screen.y,
        title: marker.job.name.toUpperCase(),
        sub: this.messageStacks ? [town, unread > 0 ? `${unread} UNREAD` : "ALL CLEAR"].filter(Boolean).join(" · ") : town,
        tone: selected ? "selected" : "hover",
      })
    }
    for (const label of this.layerLabels) {
      const screen = this.project(label.point)
      if (screen.onScreen) {
        labels.push({ key: label.key, x: screen.x, y: screen.y, title: label.title, sub: label.sub, tone: "landmark" })
      }
    }
    for (const label of this.weatherOverlay?.labels ?? []) {
      const screen = this.project(label.point)
      if (screen.onScreen) {
        labels.push({ key: label.key, x: screen.x, y: screen.y, title: label.title, sub: label.sub, tone: "landmark" })
      }
    }
    for (const landmark of this.landmarks) {
      const screen = this.project(landmark.point)
      if (screen.onScreen) {
        labels.push({ key: landmark.title, x: screen.x, y: screen.y, title: landmark.title, sub: landmark.sub, tone: "landmark" })
      }
    }
    const placed = placeWithoutOverlap(labels)
    const signature = JSON.stringify(placed)
    if (signature === this.labelSignature) return
    this.labelSignature = signature
    this.callbacks.onLabels(placed)
  }

  dispose(): void {
    this.disposed = true
    if (this.frame !== null) cancelAnimationFrame(this.frame)
    this.resizeObserver.disconnect()
    this.visibilityObserver?.disconnect()
    this.canvas.removeEventListener("pointerdown", this.handleDown)
    this.canvas.removeEventListener("pointermove", this.handleMove)
    this.canvas.removeEventListener("pointerup", this.handleUp)
    this.canvas.removeEventListener("pointerleave", this.handleLeave)
    this.canvas.removeEventListener("wheel", this.handleWheel)
    this.builtStacks?.dispose()
    this.weatherOverlay?.dispose()
    for (const marker of this.markers) {
      marker.mesh.geometry.dispose()
      marker.material.dispose()
      marker.edges.dispose()
      marker.flag?.geometry.dispose()
      marker.flagMaterial?.dispose()
    }
    for (const item of this.disposables) item.dispose()
    this.renderer.dispose()
  }
}
