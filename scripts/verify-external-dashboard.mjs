// Render the actual workspace components with isolated action/router boundaries.
// No authentication service, database, or production mutation is contacted.
import { build } from "esbuild"
import postcss from "postcss"
import tailwind from "@tailwindcss/postcss"
import { chromium } from "playwright"
import { strict as assert } from "node:assert"
import { createServer } from "node:http"
import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"

const root = process.cwd()
const output = await mkdtemp(path.join(tmpdir(), "compass-dashboard-browser-"))
const mocks = {
  "next/navigation": `export function useRouter(){return {push(href){history.pushState(null,'',href);window.dispatchEvent(new PopStateEvent('popstate'))},refresh(){document.body.dataset.refreshed='true'}}}`,
  "next/link": `import React from 'react';export default function Link({href,children,...props}){return React.createElement('a',{...props,href,onClick(e){if(!e.metaKey&&!e.ctrlKey){e.preventDefault();history.pushState(null,'',href);window.dispatchEvent(new PopStateEvent('popstate'))}}},children)}`,
  "next/image": `import React from 'react';export default function Image({fill,unoptimized,priority,...props}){return React.createElement('img',{...props,style:fill?{position:'absolute',inset:0,width:'100%',height:'100%'}:props.style})}`,
  "@/app/actions/profile": `export async function logout(){document.body.dataset.loggedOut='true'};export async function updateWorkspacePhoto(){return {success:true}}`,
  "@/app/actions/project-audience-sub-vendor": `export async function createSubVendorRfi(projectId,input){document.body.dataset.rfi=JSON.stringify({projectId,input});return {success:true}}`,
  "@/components/theme-provider": `import React from 'react';export function useTheme(){const [theme,set]=React.useState(document.documentElement.classList.contains('dark')?'dark':'light');return {theme,setTheme(v){set(v);document.documentElement.classList.toggle('dark',v==='dark')}}};export function useCompassTheme(){return {activeThemeId:'default',async setVisualTheme(){}}}`,
  "@/components/notifications-popover": `import React from 'react';export function NotificationsPopover(){return React.createElement('button',{'aria-label':'Notifications'},'♧')}`,
  "@/components/projects/project-audience-notification-settings": `import React from 'react';export function ProjectAudienceNotificationSettings(){return React.createElement('button',{'aria-label':'Notification settings'},'⚙')}`,
  "@/components/projects/project-audience-direct-message-dialog": `import React from 'react';export function ProjectAudienceDirectMessageDialog({open,onOpenChange,shortcut}){return open?React.createElement('section',{role:'dialog','aria-label':'Message project team'},React.createElement('a',{href:shortcut.conversationHref},'Open conversation'),React.createElement('button',{onClick:()=>onOpenChange(false)},'Close message')):null}`,
}
const mockPaths = new Map()
for (const [name, source] of Object.entries(mocks)) {
  const file = path.join(output, `mock-${mockPaths.size}.mjs`)
  await writeFile(file, source)
  mockPaths.set(name, file)
}
await build({
  entryPoints: [
    path.join(
      root,
      "__tests__/fixtures/project-audience-dashboard-browser.tsx"
    ),
  ],
  outfile: path.join(output, "app.js"),
  bundle: true,
  platform: "browser",
  format: "iife",
  jsx: "automatic",
  tsconfig: path.join(root, "tsconfig.json"),
  nodePaths: [path.join(root, "node_modules")],
  define: { "process.env.NODE_ENV": '"development"' },
  plugins: [
    {
      name: "isolated-boundaries",
      setup(builder) {
        builder.onResolve({ filter: /.*/ }, (args) =>
          mockPaths.has(args.path)
            ? { path: mockPaths.get(args.path) }
            : undefined
        )
      },
    },
  ],
})
const css = await postcss([tailwind({ base: root })]).process(
  '@import "./src/app/globals.css";',
  { from: path.join(root, "fixture.css") }
)
await writeFile(path.join(output, "app.css"), css.css)
const mockup = await readFile(
  path.join(root, "docs/wip/ui-mockups/external-dashboard.html"),
  "utf8"
).catch(() => "")
const photoMatch = mockup.match(/src="data:image\/jpeg;base64,([^"]+)"/)
const image = photoMatch
  ? Buffer.from(photoMatch[1], "base64")
  : await readFile(path.join(root, "public/department-logos/hps-h-green.svg"))
const server = createServer(async (request, response) => {
  const url = request.url ?? "/"
  if (url.startsWith("/api/projects/")) {
    response.setHeader(
      "Content-Type",
      photoMatch ? "image/jpeg" : "image/svg+xml"
    )
    response.end(image)
    return
  }
  if (url === "/app.js" || url === "/app.css") {
    response.setHeader(
      "Content-Type",
      url.endsWith(".css") ? "text/css" : "application/javascript"
    )
    response.end(await readFile(path.join(output, url.slice(1))))
    return
  }
  if (url.startsWith("/department-logos/")) {
    response.setHeader("Content-Type", "image/svg+xml")
    response.end(
      await readFile(path.join(root, "public/department-logos/hps-h-green.svg"))
    )
    return
  }
  response.setHeader("Content-Type", "text/html")
  response.end(
    '<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/app.css"></head><body><div id="root"></div><script src="/app.js"></script></body></html>'
  )
})
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve))
const address = server.address()
assert(address && typeof address !== "string")
const origin = `http://127.0.0.1:${address.port}`
let browser
let page
try {
  browser = await chromium.launch({ headless: true })
  page = await browser.newPage({ viewport: { width: 1560, height: 1100 } })
  const errors = []
  page.on("pageerror", (error) => errors.push(error.message))
  for (const role of ["owner", "partner"]) {
    for (const width of [1560, 1024, 390]) {
      await page.setViewportSize({ width, height: 1100 })
      await page.goto(`${origin}/?role=${role}`)
      await page.getByRole("heading", { name: "Good morning, Alex" }).waitFor()
      assert.equal(
        await page.evaluate(
          () => document.documentElement.scrollWidth > innerWidth
        ),
        false,
        `${role} overflow at ${width}`
      )
      await page
        .locator('button[aria-label="Open account menu"]:visible')
        .click()
      await page.getByRole("menuitem", { name: "Log out" }).click()
      await page.waitForFunction(
        () => document.body.dataset.loggedOut === "true"
      )
      // Start a fresh signed-in fixture after testing the logout action boundary.
      await page.goto(`${origin}/?role=${role}`)
      await page
        .locator('[role="combobox"][aria-label="Switch project"]:visible')
        .click()
      await page.getByRole("option", { name: /O-124/ }).click()
      await page.waitForURL(/\/preview\/projects\/meadow\/(owner|sub-vendor)$/)
      const cookieName =
        role === "owner"
          ? "compass-owner-project"
          : "compass-sub-vendor-project"
      assert(
        (await page.context().cookies()).some(
          (cookie) => cookie.value === "meadow"
        ),
        `Project selection cookie missing (${cookieName})`
      )
      assert.equal(
        await page
          .locator('[aria-label="Project photos"] img')
          .first()
          .getAttribute("src"),
        `/api/projects/meadow/photos/photo-1?audience=${role === "owner" ? "owner" : "sub_vendor"}`
      )
      await page.getByRole("link", { name: "Full schedule" }).click()
      await page
        .locator('[role="combobox"][aria-label="Switch project"]:visible')
        .click()
      await page.getByRole("option", { name: /O-123/ }).click()
      await page.waitForURL(
        /\/preview\/projects\/cedar\/(owner|sub-vendor)\/schedule$/
      )
      await page
        .getByText("Email or text this project", { exact: true })
        .click()
      assert.equal(
        (await page.getByRole("link", { name: /project\+/ }).count()) > 0 ||
          (await page.locator('a[href^="mailto:"]').count()) > 0,
        true
      )
      assert.equal(await page.locator('a[href^="sms:"]').count(), 1)
      await page
        .getByText("Email or text this project", { exact: true })
        .click()
      if (process.env.DASHBOARD_SCREENSHOTS) {
        await page.goto(`${origin}/?role=${role}`)
        await page
          .getByRole("heading", { name: "Good morning, Alex" })
          .waitFor()
        await page.screenshot({
          path: path.join(
            process.env.DASHBOARD_SCREENSHOTS,
            `implemented-${role}-${width}.png`
          ),
          fullPage: true,
          animations: "disabled",
        })
      }
      console.log(
        `PASS ${role} ${width}px: account/logout, project switch + remembered selection, section retention, communication links, layout`
      )
    }
  }
  await page.goto(`${origin}/?role=partner`)
  await page.getByRole("button", { name: "Send an RFI", exact: true }).click()
  await page.getByLabel("Subject", { exact: true }).fill("Confirm roof detail")
  await page
    .getByLabel("Question", { exact: true })
    .fill("Please confirm the published beam connection detail.")
  await page.getByRole("button", { name: "Send RFI", exact: true }).click()
  await page.waitForFunction(() => document.body.dataset.rfi !== undefined)
  assert.equal(
    JSON.parse(await page.locator("body").getAttribute("data-rfi")).projectId,
    "cedar"
  )
  await page.goto(`${origin}/?role=partner&internal=1`)
  await page.getByRole("button", { name: "Send an RFI", exact: true }).click()
  await page.getByLabel("Subject", { exact: true }).fill("Preview only")
  await page
    .getByLabel("Question", { exact: true })
    .fill("This must not be submitted.")
  await page.getByRole("button", { name: "Send RFI", exact: true }).click()
  assert.equal(await page.locator("body").getAttribute("data-rfi"), null)
  await page.keyboard.press("Escape")
  await page.goto(`${origin}/?empty=1`)
  await page
    .getByText("Project photos will appear here", { exact: true })
    .waitFor()
  assert.equal(
    await page.getByRole("button", { name: "Next project photo" }).count(),
    0
  )
  await page.getByText(/Some summaries could not be loaded/).waitFor()
  await page.emulateMedia({ reducedMotion: "reduce" })
  await page.goto(origin)
  await page.getByRole("heading", { name: "Good morning, Alex" }).waitFor()
  assert.equal(
    await page.getByRole("button", { name: "Pause project photos" }).count(),
    0
  )
  await page.getByRole("button", { name: "Next project photo" }).click()
  await page.getByText("2 / 2", { exact: true }).waitFor()
  await page.emulateMedia({ reducedMotion: "no-preference" })
  await page.goto(origin)
  await page.getByText("2 / 2", { exact: true }).waitFor({ timeout: 10000 })
  await page.getByRole("button", { name: "Pause project photos" }).click()
  assert.equal(
    await page.getByRole("button", { name: "Play project photos" }).count(),
    1
  )
  await page.locator('button[aria-label="Toggle theme"]:visible').click()
  assert.equal(await page.locator("html").getAttribute("class"), "dark")
  if (process.env.DASHBOARD_SCREENSHOTS) {
    await page.setViewportSize({ width: 1560, height: 1100 })
    await page.screenshot({
      path: path.join(
        process.env.DASHBOARD_SCREENSHOTS,
        "implemented-owner-dark.png"
      ),
      fullPage: true,
      animations: "disabled",
    })
  }
  assert.deepEqual(errors, [])
  console.log(
    "PASS RFI form/action handoff, internal-preview write block, empty/error states, photo rotation + reduced motion, theme toggle; no browser runtime errors"
  )
} catch (error) {
  if (page) {
    await page.screenshot({
      path: path.join(root, "docs/wip/ui-mockups/implemented-failure.png"),
      fullPage: true,
    })
    console.error(await page.locator("body").innerText())
  }
  throw error
} finally {
  await browser?.close()
  server.close()
  await rm(output, { recursive: true, force: true })
}
