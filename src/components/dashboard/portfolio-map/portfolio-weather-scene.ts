import {
  AdditiveBlending,
  BufferGeometry,
  Color,
  Float32BufferAttribute,
  LineBasicMaterial,
  LineDashedMaterial,
  LineSegments,
  NormalBlending,
  Points,
  ShaderMaterial,
  Vector2,
  type Object3D,
  type Scene,
  type Vector3,
} from "three"
import { SMOKE_LEVELS, type AirCategory, type SmokeLevel } from "@/lib/weather/air"
import { pointInRing, ringBounds, type FlatRing } from "@/lib/weather/geometry"

/** One forecast cell at the time bar's step, ready to draw. */
type WeatherSceneCell = {
  readonly lon: number
  readonly lat: number
  readonly precipIn: number
  readonly snowIn: number
  readonly tempMinF: number | null
  readonly tempMaxF: number | null
  readonly gustMph: number | null
  readonly windDir: number | null
}

export type WeatherSublayers = {
  readonly rain: boolean
  readonly snow: boolean
  readonly wind: boolean
  readonly temperature: boolean
  readonly warnings: boolean
}

export type WeatherSceneView = {
  readonly cells: readonly WeatherSceneCell[]
  /** Size of one forecast cell, in degrees. */
  readonly spacing: { readonly lon: number; readonly lat: number }
  readonly limits: { readonly gustMph: number; readonly coldF: number; readonly heatF: number }
  readonly alerts: readonly { readonly rings: readonly FlatRing[]; readonly solid: boolean; readonly color: number }[]
  readonly show: WeatherSublayers
  readonly colors: { readonly rain: number; readonly snow: number; readonly wind: number; readonly cold: number; readonly heat: number }
}

export type FireSceneView = {
  readonly fires: readonly { readonly id: string; readonly name: string; readonly lon: number; readonly lat: number; readonly acres: number | null; readonly rings: readonly FlatRing[] }[]
  readonly alerts: readonly { readonly rings: readonly FlatRing[]; readonly solid: boolean }[]
  readonly smoke: readonly { readonly density: SmokeLevel; readonly rings: readonly FlatRing[] }[]
  readonly air: readonly { readonly id: string; readonly name: string; readonly lon: number; readonly lat: number; readonly aqi: number | null; readonly category: AirCategory }[]
  readonly colors: { readonly fire: number; readonly redFlag: number; readonly smoke: number; readonly air: Readonly<Record<AirCategory, number>> }
}

/** Haze strength per smoke density. */
const SMOKE_STRENGTH: Readonly<Record<SmokeLevel, number>> = { light: 0.2, medium: 0.36, heavy: 0.56 }
/** Most haze puffs drawn at once, across all plumes. */
const MAX_SMOKE_PUFFS = 6000

export type OverlayLabel = { readonly key: string; readonly title: string; readonly sub: string; readonly point: Vector3 }

type OverlayHost = {
  readonly scene: Scene
  /** World point on the terrain surface, lifted by `lift` world units. */
  readonly ground: (lon: number, lat: number, lift: number) => Vector3
  /** World units per degree of longitude and latitude. */
  readonly unitsPerDegree: { readonly lon: number; readonly lat: number }
  /** True inside the terrain block; outlines stop at its edge. */
  readonly inBounds: (lon: number, lat: number) => boolean
  readonly reduceMotion: boolean
}

const MAX_DROPS_PER_CELL = 140
const PRECIP_HEIGHT = 0.6
// Deterministic jitter so particles don't jump when the data refreshes.
function seeded(seed: number): () => number {
  let state = seed >>> 0 || 1
  return () => {
    state ^= state << 13
    state ^= state >>> 17
    state ^= state << 5
    return ((state >>> 0) % 100000) / 100000
  }
}

const PRECIP_VERTEX = /* glsl */ `
attribute float aSeed;
attribute float aGround;
uniform float uTime;
uniform float uSpeed;
uniform float uHeight;
uniform float uSize;
uniform vec2 uDrift;
varying float vFade;
void main() {
  float t = fract(aSeed + uTime * uSpeed);
  vec3 p = position;
  p.y = aGround + uHeight * (1.0 - t);
  p.xz += uDrift * t;
  vFade = smoothstep(0.0, 0.15, t) * (1.0 - smoothstep(0.85, 1.0, t));
  gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
  gl_PointSize = uSize;
}`

const RAIN_FRAGMENT = /* glsl */ `
uniform vec3 uColor;
varying float vFade;
void main() {
  vec2 c = gl_PointCoord - 0.5;
  if (abs(c.x) > 0.06) discard;
  gl_FragColor = vec4(uColor, vFade * 0.7 * (1.0 - abs(c.y) * 1.6));
}`

const SNOW_FRAGMENT = /* glsl */ `
uniform vec3 uColor;
varying float vFade;
void main() {
  float d = length(gl_PointCoord - 0.5);
  if (d > 0.5) discard;
  gl_FragColor = vec4(uColor, vFade * (1.0 - d * 1.7));
}`

const WIND_VERTEX = /* glsl */ `
attribute vec2 aTravel;
attribute vec2 aTail;
attribute float aSeed;
attribute float aHead;
uniform float uTime;
varying float vFade;
void main() {
  float t = fract(aSeed + uTime * 0.35);
  vec3 p = position;
  p.xz += aTravel * (t - 0.5) - aTail * (1.0 - aHead);
  vFade = sin(t * 3.14159) * (0.35 + 0.65 * aHead);
  gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
}`

const WIND_FRAGMENT = /* glsl */ `
uniform vec3 uColor;
varying float vFade;
void main() { gl_FragColor = vec4(uColor, vFade * 0.9); }`

const GLOW_VERTEX = /* glsl */ `
attribute float aSize;
attribute vec3 aColor;
uniform float uScale;
varying vec3 vColor;
void main() {
  vColor = aColor;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  gl_PointSize = aSize * uScale;
}`

const GLOW_FRAGMENT = /* glsl */ `
uniform float uTime;
uniform float uStrength;
varying vec3 vColor;
void main() {
  float d = length(gl_PointCoord - 0.5);
  if (d > 0.5) discard;
  float pulse = 0.8 + 0.2 * sin(uTime * 1.8);
  gl_FragColor = vec4(vColor, (1.0 - d * 2.0) * uStrength * pulse);
}`

/** A solid round dot with a soft edge and a darker rim, for air quality readings. */
const DOT_FRAGMENT = /* glsl */ `
uniform float uStrength;
varying vec3 vColor;
void main() {
  float d = length(gl_PointCoord - 0.5);
  if (d > 0.5) discard;
  vec3 color = mix(vColor, vColor * 0.45, smoothstep(0.32, 0.42, d));
  gl_FragColor = vec4(color, smoothstep(0.5, 0.44, d) * uStrength);
}`

/**
 * An outline as line-segment pairs, densified so it follows the terrain
 * between corners; pieces beyond the terrain block's edge are left off.
 */
function drapedSegments(host: OverlayHost, ring: FlatRing, lift: number): Vector3[] {
  const coords: [number, number][] = []
  const n = Math.floor(ring.length / 2)
  for (let i = 0; i < n; i += 1) {
    const lon = ring[i * 2] ?? 0
    const lat = ring[i * 2 + 1] ?? 0
    const nextLon = ring[((i + 1) % n) * 2] ?? lon
    const nextLat = ring[((i + 1) % n) * 2 + 1] ?? lat
    const steps = Math.max(1, Math.ceil(Math.hypot(nextLon - lon, nextLat - lat) / 0.03))
    for (let s = 0; s < steps; s += 1) {
      const k = s / steps
      coords.push([lon + (nextLon - lon) * k, lat + (nextLat - lat) * k])
    }
  }
  const segments: Vector3[] = []
  coords.forEach(([lon, lat], index) => {
    const [nextLon, nextLat] = coords[(index + 1) % coords.length] ?? [lon, lat]
    if (!host.inBounds(lon, lat) || !host.inBounds(nextLon, nextLat)) return
    segments.push(host.ground(lon, lat, lift), host.ground(nextLon, nextLat, lift))
  })
  return segments
}

/**
 * The Weather and Fire & smoke layers drawn over the terrain: falling rain
 * and snow, moving wind streaks, cold and heat glows, warning outlines, and
 * fire outlines with glowing points. Animated on the GPU; still when the
 * viewer asks for less motion.
 */
export class WeatherOverlay {
  private weatherObjects: Object3D[] = []
  private fireObjects: Object3D[] = []
  private weatherDisposables: { dispose: () => void }[] = []
  private fireDisposables: { dispose: () => void }[] = []
  private timedMaterials: ShaderMaterial[] = []
  private scaledMaterials: ShaderMaterial[] = []
  private fireLabels: OverlayLabel[] = []
  private hasMotion = false

  constructor(private readonly host: OverlayHost) {}

  /** True while something is moving, so the scene keeps drawing frames. */
  get animating(): boolean {
    return this.hasMotion && !this.host.reduceMotion
  }

  get labels(): readonly OverlayLabel[] {
    return this.fireLabels
  }

  /** Called every frame with seconds elapsed and screen pixels per world unit. */
  update(seconds: number, pixelsPerUnit: number): void {
    const time = this.host.reduceMotion ? 0 : seconds
    for (const material of this.timedMaterials) {
      const uniform = material.uniforms.uTime
      if (uniform) uniform.value = time
    }
    for (const material of this.scaledMaterials) {
      const uniform = material.uniforms.uScale
      if (uniform) uniform.value = pixelsPerUnit
    }
  }

  setWeather(view: WeatherSceneView | null): void {
    this.clear(this.weatherObjects, this.weatherDisposables)
    this.weatherObjects = []
    this.weatherDisposables = []
    if (view) this.buildWeather(view)
    this.refreshMotion()
  }

  setFire(view: FireSceneView | null): void {
    this.clear(this.fireObjects, this.fireDisposables)
    this.fireObjects = []
    this.fireDisposables = []
    this.fireLabels = []
    if (view) this.buildFire(view)
    this.refreshMotion()
  }

  dispose(): void {
    this.clear(this.weatherObjects, this.weatherDisposables)
    this.clear(this.fireObjects, this.fireDisposables)
    this.weatherObjects = []
    this.fireObjects = []
  }

  private refreshMotion(): void {
    this.timedMaterials = this.timedMaterials.filter((material) => this.isLive(material))
    this.scaledMaterials = this.scaledMaterials.filter((material) => this.isLive(material))
    this.hasMotion = this.timedMaterials.length > 0
  }

  private isLive(material: ShaderMaterial): boolean {
    return this.weatherDisposables.includes(material) || this.fireDisposables.includes(material)
  }

  private clear(objects: Object3D[], disposables: { dispose: () => void }[]): void {
    for (const object of objects) this.host.scene.remove(object)
    for (const item of disposables) item.dispose()
  }

  private add(object: Object3D, kind: "weather" | "fire"): void {
    object.renderOrder = 5
    this.host.scene.add(object)
    if (kind === "weather") this.weatherObjects.push(object)
    else this.fireObjects.push(object)
  }

  private own<T extends { dispose: () => void }>(item: T, kind: "weather" | "fire"): T {
    if (kind === "weather") this.weatherDisposables.push(item)
    else this.fireDisposables.push(item)
    return item
  }

  private shader(kind: "weather" | "fire", options: ConstructorParameters<typeof ShaderMaterial>[0], timed: boolean, scaled: boolean): ShaderMaterial {
    const material = this.own(new ShaderMaterial(options), kind)
    if (timed) this.timedMaterials.push(material)
    if (scaled) this.scaledMaterials.push(material)
    return material
  }

  private buildWeather(view: WeatherSceneView): void {
    const random = seeded(1729)
    const rain: { position: number[]; seed: number[]; ground: number[] } = { position: [], seed: [], ground: [] }
    const snow: { position: number[]; seed: number[]; ground: number[] } = { position: [], seed: [], ground: [] }
    const wind: { position: number[]; travel: number[]; tail: number[]; seed: number[]; head: number[] } = { position: [], travel: [], tail: [], seed: [], head: [] }
    const glow: { position: number[]; size: number[]; color: number[] } = { position: [], size: [], color: [] }
    const cold = new Color(view.colors.cold)
    const heat = new Color(view.colors.heat)
    const cellUnits = Math.min(view.spacing.lon * this.host.unitsPerDegree.lon, view.spacing.lat * this.host.unitsPerDegree.lat)

    for (const cell of view.cells) {
      const isSnow = cell.snowIn > 0 && (cell.snowIn / 10 >= cell.precipIn * 0.5 || (cell.tempMaxF ?? 99) <= 33)
      const target = isSnow ? snow : rain
      const showPrecip = isSnow ? view.show.snow : view.show.rain
      if (showPrecip && cell.precipIn >= 0.01) {
        const intensity = Math.min(1, Math.max(0.08, cell.precipIn / 0.3))
        const count = Math.round(intensity * MAX_DROPS_PER_CELL)
        for (let i = 0; i < count; i += 1) {
          const lon = cell.lon + (random() - 0.5) * view.spacing.lon
          const lat = cell.lat + (random() - 0.5) * view.spacing.lat
          const point = this.host.ground(lon, lat, 0.01)
          target.position.push(point.x, point.y, point.z)
          target.ground.push(point.y)
          target.seed.push(random())
        }
      }
      if (view.show.wind && cell.gustMph !== null && cell.windDir !== null && cell.gustMph >= view.limits.gustMph * 0.8) {
        // Wind blows toward the opposite of where it comes from; world z points south.
        const toward = ((cell.windDir + 180) * Math.PI) / 180
        const dir = new Vector2(Math.sin(toward), -Math.cos(toward))
        const strength = Math.min(1, (cell.gustMph - view.limits.gustMph * 0.8) / 30 + 0.3)
        const streaks = Math.round(4 + strength * 10)
        for (let i = 0; i < streaks; i += 1) {
          const lon = cell.lon + (random() - 0.5) * view.spacing.lon
          const lat = cell.lat + (random() - 0.5) * view.spacing.lat
          const point = this.host.ground(lon, lat, 0.12 + random() * 0.1)
          const seed = random()
          const travelX = dir.x * cellUnits * 1.2
          const travelZ = dir.y * cellUnits * 1.2
          const tailX = dir.x * cellUnits * 0.18 * (0.6 + strength)
          const tailZ = dir.y * cellUnits * 0.18 * (0.6 + strength)
          for (const head of [0, 1]) {
            wind.position.push(point.x, point.y, point.z)
            wind.travel.push(travelX, travelZ)
            wind.tail.push(tailX, tailZ)
            wind.seed.push(seed)
            wind.head.push(head)
          }
        }
      }
      if (view.show.temperature) {
        const isCold = cell.tempMinF !== null && cell.tempMinF <= view.limits.coldF
        const isHot = cell.tempMaxF !== null && cell.tempMaxF >= view.limits.heatF
        if (isCold || isHot) {
          const point = this.host.ground(cell.lon, cell.lat, 0.05)
          const color = isCold ? cold : heat
          glow.position.push(point.x, point.y, point.z)
          glow.size.push(cellUnits * 1.9)
          glow.color.push(color.r, color.g, color.b)
        }
      }
    }

    if (rain.position.length > 0) this.addPrecip(rain, view.colors.rain, RAIN_FRAGMENT, 1.1, 10)
    if (snow.position.length > 0) this.addPrecip(snow, view.colors.snow, SNOW_FRAGMENT, 0.18, 6)
    if (wind.position.length > 0) {
      const geometry = this.own(new BufferGeometry(), "weather")
      geometry.setAttribute("position", new Float32BufferAttribute(wind.position, 3))
      geometry.setAttribute("aTravel", new Float32BufferAttribute(wind.travel, 2))
      geometry.setAttribute("aTail", new Float32BufferAttribute(wind.tail, 2))
      geometry.setAttribute("aSeed", new Float32BufferAttribute(wind.seed, 1))
      geometry.setAttribute("aHead", new Float32BufferAttribute(wind.head, 1))
      const material = this.shader("weather", {
        uniforms: { uTime: { value: 0 }, uColor: { value: new Color(view.colors.wind) } },
        vertexShader: WIND_VERTEX,
        fragmentShader: WIND_FRAGMENT,
        transparent: true,
        depthWrite: false,
      }, true, false)
      this.add(new LineSegments(geometry, material), "weather")
    }
    if (glow.position.length > 0) {
      const geometry = this.own(new BufferGeometry(), "weather")
      geometry.setAttribute("position", new Float32BufferAttribute(glow.position, 3))
      geometry.setAttribute("aSize", new Float32BufferAttribute(glow.size, 1))
      geometry.setAttribute("aColor", new Float32BufferAttribute(glow.color, 3))
      const material = this.shader("weather", {
        uniforms: { uTime: { value: 0 }, uScale: { value: 1 }, uStrength: { value: 0.45 } },
        vertexShader: GLOW_VERTEX,
        fragmentShader: GLOW_FRAGMENT,
        transparent: true,
        depthWrite: false,
        depthTest: false,
        blending: NormalBlending,
      }, true, true)
      this.add(new Points(geometry, material), "weather")
    }
    if (view.show.warnings) {
      // One batch per color and style.
      const groups = new Map<string, { color: number; solid: boolean; rings: FlatRing[] }>()
      for (const alert of view.alerts) {
        const key = `${alert.color}:${alert.solid}`
        const group = groups.get(key) ?? { color: alert.color, solid: alert.solid, rings: [] }
        group.rings.push(...alert.rings)
        groups.set(key, group)
      }
      for (const group of groups.values()) this.addOutline(group.rings, group.color, group.solid, "weather")
    }
  }

  private addPrecip(data: { position: number[]; seed: number[]; ground: number[] }, color: number, fragment: string, speed: number, size: number): void {
    const geometry = this.own(new BufferGeometry(), "weather")
    geometry.setAttribute("position", new Float32BufferAttribute(data.position, 3))
    geometry.setAttribute("aSeed", new Float32BufferAttribute(data.seed, 1))
    geometry.setAttribute("aGround", new Float32BufferAttribute(data.ground, 1))
    const material = this.shader("weather", {
      uniforms: {
        uTime: { value: 0 },
        uSpeed: { value: speed },
        uHeight: { value: PRECIP_HEIGHT },
        uSize: { value: size * Math.min(window.devicePixelRatio || 1, 2) },
        uDrift: { value: new Vector2(0.04, 0.02) },
        uColor: { value: new Color(color) },
      },
      vertexShader: PRECIP_VERTEX,
      fragmentShader: fragment,
      transparent: true,
      depthWrite: false,
    }, true, false)
    this.add(new Points(geometry, material), "weather")
  }

  /** All outlines of one style as a single line batch: one draw call however many rings. */
  private addOutline(rings: readonly FlatRing[], color: number, solid: boolean, kind: "weather" | "fire"): void {
    const segments = rings.flatMap((ring) => drapedSegments(this.host, ring, 0.025))
    if (segments.length === 0) return
    const material = this.own(
      solid
        ? new LineBasicMaterial({ color, transparent: true, opacity: 0.95 })
        : new LineDashedMaterial({ color, dashSize: 0.08, gapSize: 0.06, transparent: true, opacity: 0.9 }),
      kind,
    )
    const geometry = this.own(new BufferGeometry().setFromPoints(segments), kind)
    const lines = new LineSegments(geometry, material)
    if (!solid) lines.computeLineDistances()
    this.add(lines, kind)
  }

  /** Smoke as soft gray haze puffs on a grid inside each plume, denser plumes more opaque. */
  private buildSmoke(view: FireSceneView): void {
    if (view.smoke.length === 0) return
    let area = 0
    for (const plume of view.smoke) for (const ring of plume.rings) {
      const box = ringBounds(ring)
      area += (box.east - box.west) * (box.north - box.south)
    }
    // Grid spacing so the whole picture stays under the puff budget.
    const step = Math.max(0.06, Math.sqrt(area / MAX_SMOKE_PUFFS))
    const puffUnits = step * Math.min(this.host.unitsPerDegree.lon, this.host.unitsPerDegree.lat) * 2.4
    const color = new Color(view.colors.smoke)
    for (const density of SMOKE_LEVELS) {
      const position: number[] = []
      const size: number[] = []
      const colors: number[] = []
      for (const plume of view.smoke) {
        if (plume.density !== density) continue
        for (const ring of plume.rings) {
          const box = ringBounds(ring)
          for (let lon = Math.ceil(box.west / step) * step; lon <= box.east; lon += step) {
            for (let lat = Math.ceil(box.south / step) * step; lat <= box.north; lat += step) {
              if (!this.host.inBounds(lon, lat) || !pointInRing(lon, lat, ring)) continue
              const point = this.host.ground(lon, lat, 0.08)
              position.push(point.x, point.y, point.z)
              size.push(puffUnits)
              colors.push(color.r, color.g, color.b)
            }
          }
        }
      }
      if (position.length === 0) continue
      const geometry = this.own(new BufferGeometry(), "fire")
      geometry.setAttribute("position", new Float32BufferAttribute(position, 3))
      geometry.setAttribute("aSize", new Float32BufferAttribute(size, 1))
      geometry.setAttribute("aColor", new Float32BufferAttribute(colors, 3))
      const material = this.shader("fire", {
        uniforms: { uTime: { value: 0 }, uScale: { value: 1 }, uStrength: { value: SMOKE_STRENGTH[density] } },
        vertexShader: GLOW_VERTEX,
        fragmentShader: GLOW_FRAGMENT,
        transparent: true,
        depthWrite: false,
        depthTest: false,
        blending: NormalBlending,
      }, true, true)
      this.add(new Points(geometry, material), "fire")
    }
  }

  /** Air quality: one dot per reporting area in its EPA category color; poor air is labeled. */
  private buildAir(view: FireSceneView): OverlayLabel[] {
    if (view.air.length === 0) return []
    const position: number[] = []
    const size: number[] = []
    const colors: number[] = []
    for (const reading of view.air) {
      if (!this.host.inBounds(reading.lon, reading.lat)) continue
      const point = this.host.ground(reading.lon, reading.lat, 0.05)
      const color = new Color(view.colors.air[reading.category])
      position.push(point.x, point.y, point.z)
      size.push(0.24)
      colors.push(color.r, color.g, color.b)
    }
    if (position.length > 0) {
      const geometry = this.own(new BufferGeometry(), "fire")
      geometry.setAttribute("position", new Float32BufferAttribute(position, 3))
      geometry.setAttribute("aSize", new Float32BufferAttribute(size, 1))
      geometry.setAttribute("aColor", new Float32BufferAttribute(colors, 3))
      const material = this.shader("fire", {
        uniforms: { uTime: { value: 0 }, uScale: { value: 1 }, uStrength: { value: 1 } },
        vertexShader: GLOW_VERTEX,
        fragmentShader: DOT_FRAGMENT,
        transparent: true,
        depthWrite: false,
        depthTest: false,
        blending: NormalBlending,
      }, true, true)
      this.add(new Points(geometry, material), "fire")
    }
    // Label only air past "Moderate" (AQI over 100), worst first.
    return view.air
      .filter((reading) => reading.aqi !== null && reading.aqi > 100 && this.host.inBounds(reading.lon, reading.lat))
      .sort((a, b) => (b.aqi ?? 0) - (a.aqi ?? 0))
      .slice(0, 6)
      .map((reading) => ({
        key: `air:${reading.id}`,
        title: `AQI ${reading.aqi ?? ""}`,
        sub: reading.name.toUpperCase(),
        point: this.host.ground(reading.lon, reading.lat, 0.06),
      }))
  }

  private buildFire(view: FireSceneView): void {
    this.buildSmoke(view)
    const airLabels = this.buildAir(view)
    this.fireLabels = airLabels
    this.addOutline(view.alerts.filter((alert) => alert.solid).flatMap((alert) => alert.rings), view.colors.redFlag, true, "fire")
    this.addOutline(view.alerts.filter((alert) => !alert.solid).flatMap((alert) => alert.rings), view.colors.redFlag, false, "fire")
    this.addOutline(view.fires.flatMap((fire) => fire.rings), view.colors.fire, true, "fire")
    if (view.fires.length === 0) return
    const position: number[] = []
    const size: number[] = []
    const color: number[] = []
    const fireColor = new Color(view.colors.fire)
    for (const fire of view.fires) {
      const point = this.host.ground(fire.lon, fire.lat, 0.04)
      position.push(point.x, point.y, point.z)
      // Glow grows with the fire's size: 0.15–0.6 world units.
      const acres = Math.max(1, fire.acres ?? 1)
      size.push(Math.min(0.6, 0.15 + Math.log10(acres) * 0.09))
      color.push(fireColor.r, fireColor.g, fireColor.b)
    }
    const geometry = this.own(new BufferGeometry(), "fire")
    geometry.setAttribute("position", new Float32BufferAttribute(position, 3))
    geometry.setAttribute("aSize", new Float32BufferAttribute(size, 1))
    geometry.setAttribute("aColor", new Float32BufferAttribute(color, 3))
    const material = this.shader("fire", {
      uniforms: { uTime: { value: 0 }, uScale: { value: 1 }, uStrength: { value: 0.95 } },
      vertexShader: GLOW_VERTEX,
      fragmentShader: GLOW_FRAGMENT,
      transparent: true,
      depthWrite: false,
      depthTest: false,
      blending: AdditiveBlending,
    }, true, true)
    this.add(new Points(geometry, material), "fire")
    // Name the largest fires; the label placer drops any that overlap.
    const fireLabels = [...view.fires]
      .sort((a, b) => (b.acres ?? 0) - (a.acres ?? 0))
      .slice(0, 8)
      .map((fire) => ({
        key: `fire:${fire.id}`,
        title: fire.name.toUpperCase(),
        sub: fire.acres !== null ? `${Math.round(fire.acres).toLocaleString("en-US")} ACRES` : "FIRE",
        point: this.host.ground(fire.lon, fire.lat, 0.05),
      }))
    // Fires first: the label placer keeps earlier labels when two overlap.
    this.fireLabels = [...fireLabels, ...airLabels]
  }
}
