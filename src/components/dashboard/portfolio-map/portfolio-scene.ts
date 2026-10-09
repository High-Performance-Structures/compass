import {
  AmbientLight,
  BoxGeometry,
  BufferGeometry,
  Color,
  ColorManagement,
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
  Vector2,
  Vector3,
  Vector4,
  WebGLRenderer,
  type Object3D,
} from "three"
import type { PortfolioMapJob, PortfolioPhaseId } from "@/lib/portfolio-map/model"
import {
  MAX_ELEVATION_BANDS,
  MAX_ZONE_EDGES,
  TOP_FRAGMENT,
  TOP_VERTEX,
  WALL_FRAGMENT,
  WALL_VERTEX,
} from "@/components/dashboard/portfolio-map/portfolio-shaders"

export const TERRAIN_URL = "/maps/colorado-terrain-v1.json"

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
  readonly onSelect: (jobId: string | null) => void
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
  readonly meters: Uint16Array
}

type TerrainData = {
  readonly grid: TerrainGrid
  readonly roads: readonly (readonly number[])[]
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

const W = 13.6
const D = 10
const VERTICAL_SCALE = 1.7
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
  return {
    grid: {
      w,
      h,
      west: numberField(grid, "west"),
      east: numberField(grid, "east"),
      north: numberField(grid, "north"),
      south: numberField(grid, "south"),
      meters,
    },
    roads,
  }
}

function toY(meters: number): number {
  return ((meters - 1000) / 3400) * VERTICAL_SCALE
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
  private readonly view: View = { ...DEFAULT_VIEW }
  private grid: TerrainGrid | null = null
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
  private disposed = false
  private readonly resizeObserver: ResizeObserver
  private readonly reduceMotion: boolean

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly container: HTMLElement,
    private readonly callbacks: SceneCallbacks,
  ) {
    // The scene's palette is authored in display (sRGB) values; skip linear conversion.
    ColorManagement.enabled = false
    this.renderer = new WebGLRenderer({ canvas, antialias: true })
    this.renderer.outputColorSpace = LinearSRGBColorSpace
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2))
    this.renderer.setClearColor(0x0a0f0c, 1)
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
    this.resize()
    void this.loadTerrain()
  }

  private async loadTerrain(): Promise<void> {
    try {
      // A versioned static file with an immutable cache header: fetched once per release.
      const response = await fetch(TERRAIN_URL)
      if (!response.ok) throw new Error(`terrain ${response.status}`)
      const data = parseTerrainData(await response.json())
      if (this.disposed) return
      this.grid = data.grid
      this.buildTerrain(data)
      if (this.pendingJobs) this.setJobs(this.pendingJobs.jobs, this.pendingJobs.colors)
      this.applyLayers()
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
    return toY(top * (1 - ty) + bottom * ty)
  }

  private worldXZ(lon: number, lat: number): readonly [number, number] {
    const g = this.grid
    if (!g) return [0, 0]
    return [
      ((lon - g.west) / (g.east - g.west) - 0.5) * W,
      ((g.north - lat) / (g.north - g.south) - 0.5) * D,
    ]
  }

  private track<T extends { dispose: () => void }>(item: T): T {
    this.disposables.push(item)
    return item
  }

  private buildTerrain(data: TerrainData): void {
    const g = data.grid
    const geometry = this.track(new PlaneGeometry(W, D, g.w - 1, g.h - 1))
    geometry.rotateX(-Math.PI / 2)
    const position = geometry.getAttribute("position")
    let maxH = 0
    for (let k = 0; k < position.count; k += 1) {
      const y = toY(g.meters[k] ?? 0)
      position.setY(k, y)
      maxH = Math.max(maxH, y)
    }
    geometry.computeVertexNormals()
    const depth = { uNear: { value: CAMERA_DISTANCE - 10 }, uFar: { value: CAMERA_DISTANCE + 10 } }
    const topMaterial = this.track(
      new ShaderMaterial({
        uniforms: {
          ...depth,
          uMaxH: { value: maxH },
          uLow: { value: new Color(0x111914) },
          uHigh: { value: new Color(0x7f938b) },
          uGeo: { value: new Vector4(g.west, g.east, g.north, g.south) },
          uSize: { value: new Vector2(W, D) },
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

    // Walls from the carved edge down to a flat base.
    const gx = (i: number): number => (i / (g.w - 1) - 0.5) * W
    const gz = (j: number): number => (j / (g.h - 1) - 0.5) * D
    const hy = (i: number, j: number): number => toY(g.meters[j * g.w + i] ?? 0)
    const edge: [number, number, number][] = []
    for (let i = 0; i < g.w; i += 1) edge.push([gx(i), hy(i, 0), gz(0)])
    for (let j = 1; j < g.h; j += 1) edge.push([gx(g.w - 1), hy(g.w - 1, j), gz(j)])
    for (let i = g.w - 2; i >= 0; i -= 1) edge.push([gx(i), hy(i, g.h - 1), gz(g.h - 1)])
    for (let j = g.h - 2; j >= 0; j -= 1) edge.push([gx(0), hy(0, j), gz(j)])
    const wallPositions: number[] = []
    const wallNormals: number[] = []
    edge.forEach((p, index) => {
      const q = edge[(index + 1) % edge.length] ?? p
      const length = Math.hypot(q[2] - p[2], q[0] - p[0]) || 1
      const nx = (q[2] - p[2]) / length
      const nz = -(q[0] - p[0]) / length
      const quad = [
        p[0], p[1], p[2], p[0], BASE, p[2], q[0], q[1], q[2],
        q[0], q[1], q[2], p[0], BASE, p[2], q[0], BASE, q[2],
      ]
      wallPositions.push(...quad)
      for (let v = 0; v < 6; v += 1) wallNormals.push(nx, 0, nz)
    })
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
    const bottomGeometry = this.track(new PlaneGeometry(W, D))
    bottomGeometry.rotateX(Math.PI / 2)
    bottomGeometry.translate(0, BASE, 0)
    this.scene.add(
      new Mesh(bottomGeometry, this.track(new MeshBasicMaterial({ color: 0x050806, side: DoubleSide }))),
    )
    const rimGeometry = this.track(
      new BufferGeometry().setFromPoints(edge.map((p) => new Vector3(p[0], p[1] + 0.004, p[2]))),
    )
    this.scene.add(
      new LineLoop(rimGeometry, this.track(new LineBasicMaterial({ color: 0xc6d6cf, transparent: true, opacity: 0.8 }))),
    )
    const footGeometry = this.track(
      new BufferGeometry().setFromPoints([
        new Vector3(-W / 2, BASE, -D / 2),
        new Vector3(W / 2, BASE, -D / 2),
        new Vector3(W / 2, BASE, D / 2),
        new Vector3(-W / 2, BASE, D / 2),
      ]),
    )
    this.scene.add(
      new LineLoop(footGeometry, this.track(new LineBasicMaterial({ color: 0x8c9c95, transparent: true, opacity: 0.7 }))),
    )

    // OSM roads: one batched line set per class, draped on the surface.
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

    this.landmarks = LANDMARKS.map((landmark) => {
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
      const xz = this.worldXZ(job.lon, job.lat)
      const ground = this.heightAt(job.lon, job.lat)
      const building = job.phase === "construction"
      const height = building ? 0.25 + ((job.progress ?? 0) / 100) * 1.2 : 0.06
      const width = building ? 0.17 : 0.3
      const geometry = new BoxGeometry(width, height, width)
      const material = new MeshLambertMaterial({ color: colors.phase[job.phase], transparent: true })
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
      if (job.health !== "ok") {
        flagMaterial = new MeshBasicMaterial({
          color: job.health === "late" ? colors.late : colors.risk,
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
    const focus = this.focusSelectedPending
      ? this.markers.find((item) => item.job.id === this.highlight.selectedJobId)
      : undefined
    if (focus) {
      this.focusSelectedPending = false
      this.flyTo(focus.top.x, focus.top.y * 0.6, focus.top.z, Math.max(this.view.zoom, 2.8))
    }
  }

  /** Fly to the selected job once its marker exists (used by single-job views). */
  focusSelectedWhenPlaced(): void {
    this.focusSelectedPending = true
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
        ...bands.map((feet) => toY(feet * 0.3048)),
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

  private pick(event: PointerEvent): Marker | null {
    if (this.markers.length === 0) return null
    const rect = this.canvas.getBoundingClientRect()
    this.pointer.set(
      ((event.clientX - rect.left) / rect.width) * 2 - 1,
      -((event.clientY - rect.top) / rect.height) * 2 + 1,
    )
    this.raycaster.setFromCamera(this.pointer, this.camera)
    const hit = this.raycaster.intersectObjects(this.markers.map((marker) => marker.mesh), false)[0]
    const jobId = hit?.object.userData.jobId
    return typeof jobId === "string" ? this.markers.find((marker) => marker.job.id === jobId) ?? null : null
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
    const hovered = this.pick(event)?.job.id ?? null
    if (hovered !== this.highlight.hoveredJobId) this.callbacks.onHover(hovered)
  }

  private readonly handleUp = (event: PointerEvent): void => {
    const drag = this.drag
    this.drag = null
    if (this.canvas.hasPointerCapture(event.pointerId)) this.canvas.releasePointerCapture(event.pointerId)
    if (drag && !drag.moved) this.callbacks.onSelect(this.pick(event)?.job.id ?? null)
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
    this.renderer.render(this.scene, this.camera)
    this.emitLabels()
    if (this.animation) this.requestRender()
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
      const screen = this.project(marker.top)
      if (!screen.onScreen) continue
      labels.push({
        key: marker.job.id,
        x: screen.x,
        y: screen.y,
        title: marker.job.name.toUpperCase(),
        sub: marker.job.town ? marker.job.town.toUpperCase() : "",
        tone: selected ? "selected" : "hover",
      })
    }
    for (const label of this.layerLabels) {
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
    this.canvas.removeEventListener("pointerdown", this.handleDown)
    this.canvas.removeEventListener("pointermove", this.handleMove)
    this.canvas.removeEventListener("pointerup", this.handleUp)
    this.canvas.removeEventListener("pointerleave", this.handleLeave)
    this.canvas.removeEventListener("wheel", this.handleWheel)
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
