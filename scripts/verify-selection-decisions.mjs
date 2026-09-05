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
  "@/app/actions/selection-decisions": `const save=(name,args)=>{document.body.dataset[name]=JSON.stringify(args);return {success:true}};export async function approveSelectionDecision(...args){return save('approved',args)}export async function publishSelectionDecision(...args){return save('published',args)}export async function linkSelectionPurchaseOrder(...args){return save('linked',args)}export async function unlinkSelectionProcurement(...args){return save('unlinked',args)}`,
  "@/app/actions/selection-requests": `export async function saveSelectionRequest(...args){document.body.dataset.request=JSON.stringify(args);return {success:true}}export async function closeSelectionRequest(...args){document.body.dataset.closed=JSON.stringify(args);return {success:true}}`,
  "next/navigation": `export function usePathname(){return window.location.pathname}export function useSearchParams(){return new URLSearchParams(window.location.search)}export function useRouter(){return {push(href){history.pushState(null,'',href);window.dispatchEvent(new PopStateEvent('popstate'))},refresh(){document.body.dataset.refreshed='true'}}}`,
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
    path.join(root, "__tests__/fixtures/selection-decisions-browser.tsx"),
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
  if (url === "/images/dashboard/custom-home-inspiration.webp") {
    response.setHeader("Content-Type", "image/webp")
    response.end(await readFile(path.join(root, "public", url)))
    return
  }
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
try {
  browser = await chromium.launch({ headless: true })
  const page = await browser.newPage({
    viewport: { width: 1440, height: 1100 },
  })
  const errors = []
  page.on("pageerror", (error) => errors.push(error.message))
  for (const role of ["owner", "partner", "staff"]) {
    for (const width of [1440, 390]) {
      await page.setViewportSize({ width, height: 1100 })
      await page.goto(`${origin}/?${role}`)
      await page
        .getByRole("heading", {
          name:
            role === "partner"
              ? "Approved selections"
              : "Selections & Decisions",
          exact: true,
        })
        .waitFor()
      assert.equal(
        await page.evaluate(
          () => document.documentElement.scrollWidth > innerWidth
        ),
        false,
        `${role} overflow at ${width}`
      )
      await page
        .getByLabel("Room", { exact: true })
        .selectOption("Primary suite")
      assert.equal(
        await (
          role === "staff"
            ? page.getByRole("button", { name: /^Review / })
            : page.getByRole("article")
        ).count(),
        1
      )
      await page.getByLabel("Room", { exact: true }).selectOption("")
      if (role === "partner")
        assert.equal(
          await page.getByText("Price to owner", { exact: true }).count(),
          0
        )
      if (process.env.SELECTION_SCREENSHOTS)
        await page.screenshot({
          path: `${process.env.SELECTION_SCREENSHOTS}/${role}-${width}.png`,
          fullPage: true,
        })
      await page.evaluate(() => document.documentElement.classList.add("dark"))
      assert.equal(
        await page.evaluate(
          () => document.documentElement.scrollWidth > innerWidth
        ),
        false
      )
    }
  }
  await page.setViewportSize({ width: 1440, height: 1100 })
  await page.goto(`${origin}/?owner`)
  const faucet = page.getByRole("article", {
    name: "Kitchen faucet",
    exact: true,
  })
  await faucet
    .getByRole("button", { name: "Approve selection", exact: true })
    .click()
  assert.match(await page.getByRole("alertdialog").innerText(), /2,500/)
  await page
    .getByRole("button", { name: "Approve this revision", exact: true })
    .click()
  await page.waitForFunction(() => document.body.dataset.approved)
  await faucet
    .getByRole("button", { name: "Request pricing / alternative" })
    .click()
  await page.getByLabel("Request type").selectOption("alternative")
  await page
    .getByLabel("What are you considering?")
    .fill("Please price the polished nickel finish")
  await page.getByRole("button", { name: "Send request", exact: true }).click()
  await page.waitForFunction(() => document.body.dataset.request)
  assert.match(
    await page.evaluate(() => document.body.dataset.request),
    /alternative/
  )
  await page.goto(`${origin}/?owner&request`)
  await page.getByRole("button", { name: "Edit request", exact: true }).click()
  await page
    .getByLabel("What are you considering?")
    .fill("Please price chrome instead")
  await page.getByRole("button", { name: "Save request", exact: true }).click()
  await page.waitForFunction(() => document.body.dataset.request)
  await page
    .getByRole("button", { name: "Withdraw request", exact: true })
    .click()
  await page
    .getByRole("alertdialog")
    .getByRole("button", { name: "Withdraw request", exact: true })
    .click()
  await page.waitForFunction(() => document.body.dataset.closed)
  await page.goto(`${origin}/?preview`)
  assert.equal(
    await page
      .getByRole("button", { name: "Approve selection", exact: true })
      .count(),
    0
  )
  await page.goto(`${origin}/?staff`)
  await page
    .getByRole("button", {
      name: "Review Kitchen: Kitchen faucet",
      exact: true,
    })
    .click()
  const staffCard = page.getByRole("article", {
    name: "Kitchen faucet",
    exact: true,
  })
  await staffCard
    .getByText("Publish decision / pricing", { exact: true })
    .click()
  await staffCard.getByLabel("Total price to owner ($)").fill("2700")
  await staffCard
    .getByRole("button", { name: "Save decision revision" })
    .click()
  await page.waitForFunction(() => document.body.dataset.published)
  assert.match(
    await page.evaluate(() => document.body.dataset.published),
    /2700/
  )
  await page.goto(`${origin}/?staff&large`)
  await page
    .getByRole("button", { name: "Review Kitchen: Selection 732", exact: true })
    .waitFor()
  assert.equal(
    await page.locator("form").count(),
    0,
    "Staff forms should load only when expanded"
  )
  await page.getByLabel("Find a selection").fill("Selection 732")
  assert.equal(await page.getByRole("button", { name: /^Review / }).count(), 1)
  await page
    .getByRole("button", { name: "Review Kitchen: Selection 732", exact: true })
    .click()
  await page
    .getByRole("article", { name: "Selection 732", exact: true })
    .waitFor()
  await page.goto(`${origin}/?empty`)
  await page.getByText(/Your team will publish room-by-room/).waitFor()
  assert.deepEqual(errors, [])
  console.log(
    "PASS: owner approval, pricing/alternative requests, edit/withdraw, staff publication, preview permissions, room filters, empty states, supplier privacy, responsive light/dark layouts"
  )
} finally {
  await browser?.close()
  server.close()
  await rm(output, { recursive: true, force: true })
}
