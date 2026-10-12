#!/usr/bin/env bun
// Regenerates the iOS and Android app icons and launch splash images from the
// Compass mark (the ring and needle shown in the web sidebar). Run after
// changing the mark or its colors, then `bun run cap:sync`.

import { readdir } from "node:fs/promises"
import { join, resolve } from "node:path"
import sharp from "sharp"

const root = resolve(import.meta.dirname, "..")

// Icon colors match the web sidebar; the splash matches Field Mode's light frame.
const ICON = { background: "#0c1410", ring: "#d4dcd7", needle: "#5cc99a" }
const SPLASH = { background: "#ffffff", ring: "#12203a", needle: "#2e9e6e" }

function markSvg(size, markScale, colors, { transparent = false } = {}) {
  const mark = size * markScale
  const offset = (size - mark) / 2
  const scale = mark / 30
  return Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
${transparent ? "" : `<rect width="${size}" height="${size}" fill="${colors.background}"/>`}
<g transform="translate(${offset} ${offset}) scale(${scale})">
<circle cx="15" cy="15" r="13" fill="none" stroke="${colors.ring}" stroke-width="1.6"/>
<path d="M19.5 10.5L16.6 16.6 10.5 19.5 13.4 13.4z" fill="${colors.needle}" stroke="${colors.needle}" stroke-width="1" stroke-linejoin="round"/>
<circle cx="15" cy="15" r="1.4" fill="${transparent ? ICON.background : colors.background}"/>
</g>
</svg>`)
}

async function writePng(svg, path, { width, height, background, flatten = false }) {
  let image = sharp(svg).resize(width, height, { fit: "contain", background: background ?? { r: 0, g: 0, b: 0, alpha: 0 } })
  if (flatten) image = image.flatten({ background })
  await image.png().toFile(path)
}

async function splash(width, height, path) {
  const side = Math.min(width, height)
  const mark = Math.round(side * 0.28)
  const markPng = await sharp(markSvg(mark, 1, SPLASH, { transparent: true })).png().toBuffer()
  await sharp({ create: { width, height, channels: 3, background: SPLASH.background } })
    .composite([{ input: markPng, left: Math.round((width - mark) / 2), top: Math.round((height - mark) / 2) }])
    .png()
    .toFile(path)
}

// iOS: one 1024px opaque icon; Xcode derives the rest.
const iosIcon = join(root, "ios/App/App/Assets.xcassets/AppIcon.appiconset/AppIcon-512@2x.png")
await writePng(markSvg(1024, 0.62, ICON), iosIcon, { width: 1024, height: 1024, background: ICON.background, flatten: true })

const iosSplashDir = join(root, "ios/App/App/Assets.xcassets/Splash.imageset")
for (const name of (await readdir(iosSplashDir)).filter((file) => file.endsWith(".png"))) {
  await splash(2732, 2732, join(iosSplashDir, name))
}

// Android: legacy and round icons, plus the adaptive-icon foreground, whose
// mark stays inside the 66% safe zone so launcher masks never clip it.
const densities = { mdpi: 1, hdpi: 1.5, xhdpi: 2, xxhdpi: 3, xxxhdpi: 4 }
const res = join(root, "android/app/src/main/res")
for (const [density, factor] of Object.entries(densities)) {
  const legacy = Math.round(48 * factor)
  const foreground = Math.round(108 * factor)
  const dir = join(res, `mipmap-${density}`)
  await writePng(markSvg(legacy, 0.66, ICON), join(dir, "ic_launcher.png"), { width: legacy, height: legacy })
  const round = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${legacy}" height="${legacy}"><circle cx="${legacy / 2}" cy="${legacy / 2}" r="${legacy / 2}" fill="#fff"/></svg>`)
  await sharp(markSvg(legacy, 0.62, ICON)).composite([{ input: round, blend: "dest-in" }]).png().toFile(join(dir, "ic_launcher_round.png"))
  await writePng(markSvg(foreground, 0.46, ICON, { transparent: true }), join(dir, "ic_launcher_foreground.png"), { width: foreground, height: foreground })
}

for (const entry of await readdir(res)) {
  if (!entry.startsWith("drawable")) continue
  const path = join(res, entry, "splash.png")
  const meta = await sharp(path).metadata().catch(() => null)
  if (!meta?.width || !meta.height) continue
  await splash(meta.width, meta.height, path)
}

console.log("App icons and splash images regenerated.")
