/** GLSL for the portfolio terrain: the carved top surface (with optional layers) and its walls. */

export const MAX_ZONE_EDGES = 8
export const MAX_ELEVATION_BANDS = 6

export const TOP_VERTEX = `
varying float vH; varying vec3 vN; varying float vDepth; varying vec2 vXZ;
void main() {
  vH = position.y; vN = normal; vXZ = position.xz;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  vDepth = -mv.z;
  gl_Position = projectionMatrix * mv;
}`

/*
 * Elevation and depth shading, faint contour lines and a fine grain, then the
 * optional zone rings (miles from home base, equirectangular around the mid
 * latitude) and elevation bands.
 */
export const TOP_FRAGMENT = `
uniform float uMaxH; uniform float uNear; uniform float uFar; uniform vec3 uLow; uniform vec3 uHigh;
uniform vec4 uGeo; uniform vec2 uSize;
uniform float uZonesOn; uniform vec2 uHome; uniform float uZoneEdges[${MAX_ZONE_EDGES}]; uniform int uZoneEdgeCount; uniform vec3 uZoneColor;
uniform float uElevOn; uniform float uBandY[${MAX_ELEVATION_BANDS}]; uniform int uBandCount; uniform vec3 uElevColor;
varying float vH; varying vec3 vN; varying float vDepth; varying vec2 vXZ;
void main() {
  vec3 n = normalize(vN);
  float light = clamp(dot(n, normalize(vec3(-0.5, 0.75, 0.35))), 0.0, 1.0);
  float e = clamp(vH / uMaxH, 0.0, 1.0);
  float d = clamp((vDepth - uNear) / (uFar - uNear), 0.0, 1.0);
  vec3 col = mix(uLow, uHigh, e * 0.45 + light * 0.55);
  col *= mix(1.2, 0.45, d);
  float cf = vH * 18.0;
  float c = abs(fract(cf - 0.5) - 0.5) / max(fwidth(cf), 0.0001);
  col += (1.0 - min(c, 1.0)) * 0.05;
  float gr = fract(sin(dot(gl_FragCoord.xy, vec2(12.9898, 78.233))) * 43758.5453);
  col += (gr - 0.5) * 0.03;
  if (uElevOn > 0.5) {
    float band = 0.0; float line = 0.0; float wy = max(fwidth(vH), 0.0001);
    for (int i = 0; i < ${MAX_ELEVATION_BANDS}; i++) {
      if (i >= uBandCount) break;
      if (vH >= uBandY[i]) band += 1.0;
      line = max(line, 1.0 - min(abs(vH - uBandY[i]) / wy, 1.0));
    }
    col = mix(col, uElevColor, min(band * 0.24, 0.6));
    col = mix(col, uElevColor, line * 0.85);
  }
  if (uZonesOn > 0.5) {
    float lon = uGeo.x + (vXZ.x / uSize.x + 0.5) * (uGeo.y - uGeo.x);
    float lat = uGeo.z - (vXZ.y / uSize.y + 0.5) * (uGeo.z - uGeo.w);
    float dx = (lon - uHome.x) * 69.17 * cos(radians((lat + uHome.y) * 0.5));
    float miles = length(vec2(dx, (lat - uHome.y) * 69.05));
    float wm = max(fwidth(miles) * 1.3, 0.0001);
    float zone = 0.0; float ring = 0.0;
    for (int i = 0; i < ${MAX_ZONE_EDGES}; i++) {
      if (i >= uZoneEdgeCount) break;
      // Whole-mile boundaries: 25 mi rounds into the inner zone up to 25.5.
      float edge = uZoneEdges[i] + 0.5;
      if (miles > edge) zone += 1.0;
      ring = max(ring, 1.0 - min(abs(miles - edge) / wm, 1.0));
    }
    // Zone 0 (no charge) stays untinted.
    col = mix(col, uZoneColor, zone > 0.5 ? 0.04 + zone * 0.07 : 0.0);
    col = mix(col, uZoneColor, ring * 0.95);
  }
  gl_FragColor = vec4(col, 1.0);
}`

export const WALL_VERTEX = `
varying float vY; varying vec3 vN; varying float vDepth;
void main() {
  vY = position.y; vN = normal;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  vDepth = -mv.z;
  gl_Position = projectionMatrix * mv;
}`

/* Carved-block walls: lit by face direction, with faint strata. */
export const WALL_FRAGMENT = `
uniform float uBase; uniform float uTop; uniform float uNear; uniform float uFar;
varying float vY; varying vec3 vN; varying float vDepth;
void main() {
  float t = clamp((vY - uBase) / (uTop - uBase), 0.0, 1.0);
  float face = 0.6 + 0.55 * abs(dot(normalize(vN), normalize(vec3(-0.6, 0.0, 0.8))));
  vec3 col = mix(vec3(0.20, 0.235, 0.22), vec3(0.36, 0.41, 0.39), t) * face;
  float strata = smoothstep(0.42, 0.5, abs(fract(vY * 9.0) - 0.5));
  col += strata * 0.03;
  float d = clamp((vDepth - uNear) / (uFar - uNear), 0.0, 1.0);
  col *= mix(1.1, 0.75, d);
  gl_FragColor = vec4(col, 1.0);
}`
