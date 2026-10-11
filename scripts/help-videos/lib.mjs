// Shared helpers for recording Help tutorial videos with Playwright.
// Headless Chromium draws no mouse pointer, so a visible cursor and a caption
// bar are injected into the page to make each step easy to follow.
import { chromium } from "@playwright/test"
import { execFileSync } from "node:child_process"
import { mkdirSync, readdirSync, renameSync, rmSync } from "node:fs"
import { join, resolve } from "node:path"

export const BASE_URL = process.env.HELP_VIDEO_BASE_URL ?? "http://127.0.0.1:3107"
export const PROJECT_URL = `${BASE_URL}/dashboard/projects/compass-developer`
const SIZE = { width: 1280, height: 720 }

const OVERLAY_SCRIPT = `
(() => {
  if (window.__helpVideoOverlay) return
  window.__helpVideoOverlay = true
  const install = () => {
    const style = document.createElement("style")
    style.textContent = \`
      nextjs-portal { display: none !important; }
      #help-video-cursor { position: fixed; z-index: 2147483647; width: 22px; height: 22px;
        margin: -4px 0 0 -4px; pointer-events: none; transition: transform 120ms ease; }
      #help-video-cursor.pressed { transform: scale(0.8); }
      #help-video-caption { position: fixed; z-index: 2147483646; left: 50%; bottom: 28px;
        transform: translateX(-50%); max-width: 880px; padding: 12px 20px; border-radius: 8px;
        background: rgba(17, 24, 20, 0.88); color: #fff; font: 500 18px/1.4 system-ui, sans-serif;
        text-align: center; pointer-events: none; opacity: 0; transition: opacity 200ms ease; }
      #help-video-caption.visible { opacity: 1; }
    \`
    document.head.appendChild(style)
    const cursor = document.createElement("div")
    cursor.id = "help-video-cursor"
    cursor.innerHTML = '<svg viewBox="0 0 24 24" width="22" height="22"><path d="M3 2l7 19 2.5-7.5L20 11z" fill="#111" stroke="#fff" stroke-width="1.5" stroke-linejoin="round"/></svg>'
    cursor.style.left = "640px"
    cursor.style.top = "360px"
    document.body.appendChild(cursor)
    const caption = document.createElement("div")
    caption.id = "help-video-caption"
    document.body.appendChild(caption)
    document.addEventListener("mousemove", (event) => {
      cursor.style.left = event.clientX + "px"
      cursor.style.top = event.clientY + "px"
    }, true)
    document.addEventListener("mousedown", () => cursor.classList.add("pressed"), true)
    document.addEventListener("mouseup", () => cursor.classList.remove("pressed"), true)
  }
  if (document.body) install()
  else document.addEventListener("DOMContentLoaded", install)
})()
`

const SAMPLE_PHOTOS = [
  ["North footing forms", "#8a9a7b"],
  ["Rebar inspection", "#9c8f7a"],
  ["Concrete pump setup", "#7f8c99"],
  ["Site cleanup", "#a39582"],
]

/** Renders labelled placeholder photos so no real project images are used. */
async function renderSamplePhotos(browser) {
  const page = await browser.newPage({ viewport: { width: 1200, height: 900 } })
  const images = []
  for (const [label, color] of SAMPLE_PHOTOS) {
    await page.setContent(`<body style="margin:0;width:1200px;height:900px;font-family:system-ui,sans-serif;
      background:linear-gradient(160deg, ${color}, #3e4a3d);display:flex;align-items:flex-end">
      <div style="padding:56px;color:white"><div style="font-size:64px;font-weight:600">${label}</div>
      <div style="font-size:30px;opacity:.8">Compass Developer · sample photo</div></div></body>`)
    images.push(await page.screenshot({ type: "jpeg", quality: 80 }))
  }
  await page.close()
  return images
}

/** A recording session: the page plus step helpers that read well on video. */
export async function startRecording(rawDir, options = {}) {
  const dir = resolve(rawDir)
  rmSync(dir, { recursive: true, force: true })
  mkdirSync(dir, { recursive: true })
  const browser = await chromium.launch()
  const context = await browser.newContext({
    viewport: SIZE,
    recordVideo: { dir, size: SIZE },
    deviceScaleFactor: 1,
  })
  await context.addInitScript(OVERLAY_SCRIPT)
  // Project photos normally stream from Google Drive; serve fictional
  // sample images instead so recordings never need real files.
  const samples = await renderSamplePhotos(browser)
  await context.route(/\/api\/(projects\/[^/]+\/photos|google\/download)\/([^/?]+)/, (route) => {
    const id = new URL(route.request().url()).pathname.split("/").pop() ?? ""
    const index = [...id].reduce((sum, char) => sum + char.charCodeAt(0), 0) % samples.length
    return route.fulfill({ status: 200, contentType: "image/jpeg", body: samples[index] })
  })
  const page = await context.newPage()
  const recordingStartedAt = Date.now()
  let contentStartsAt = 0
  if (options.captionAt === "top") {
    // For screens whose controls sit at the bottom, such as message editors.
    await context.addInitScript(() => {
      const style = document.createElement("style")
      style.textContent = "#help-video-caption { bottom: auto !important; top: 72px; }"
      document.addEventListener("DOMContentLoaded", () => document.head.appendChild(style))
    })
  }
  let mouse = { x: SIZE.width / 2, y: SIZE.height / 2 }

  const pause = (ms) => page.waitForTimeout(ms)

  /** Opens the clip's first page; the video is trimmed to start here. */
  async function open(url) {
    await page.goto(url, { waitUntil: "networkidle" })
    await pause(300)
    contentStartsAt = (Date.now() - recordingStartedAt) / 1000
  }

  async function caption(text, holdMs = 1800) {
    await page.evaluate((value) => {
      const element = document.getElementById("help-video-caption")
      if (!element) return
      element.textContent = value
      element.classList.toggle("visible", value.length > 0)
    }, text)
    if (holdMs > 0) await pause(holdMs)
  }

  async function moveTo(locator) {
    await locator.scrollIntoViewIfNeeded()
    const box = await locator.boundingBox()
    if (!box) throw new Error("Element has no position on screen.")
    const target = { x: box.x + Math.min(box.width / 2, 40), y: box.y + box.height / 2 }
    await page.mouse.move(target.x, target.y, { steps: 25 })
    mouse = target
    await pause(250)
  }

  async function click(locator) {
    await moveTo(locator)
    await locator.click()
    await pause(600)
  }

  async function type(locator, text) {
    await click(locator)
    await locator.pressSequentially(text, { delay: 28 })
    await pause(400)
  }

  async function finish(outputFile) {
    await caption("", 0)
    await pause(800)
    await context.close()
    await browser.close()
    const [webm] = readdirSync(dir).filter((name) => name.endsWith(".webm"))
    if (!webm) throw new Error("Playwright did not write a video.")
    const raw = join(dir, "raw.webm")
    renameSync(join(dir, webm), raw)
    // H.264 MP4 plays everywhere, including Safari and the iOS app.
    execFileSync("ffmpeg", [
      // Drop the blank frames recorded while the first page was loading.
      "-y", "-loglevel", "error", "-ss", contentStartsAt.toFixed(2), "-i", raw,
      "-c:v", "libx264", "-preset", "slow", "-crf", "24", "-pix_fmt", "yuv420p",
      "-movflags", "+faststart", "-an", resolve(outputFile),
    ])
    return resolve(outputFile)
  }

  return { page, open, pause, caption, moveTo, click, type, finish, get mouse() { return mouse } }
}
