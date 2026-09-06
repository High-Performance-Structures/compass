// Browser proof using real UI components with isolated server-action boundaries.
import { build } from "esbuild"
import postcss from "postcss"
import tailwind from "@tailwindcss/postcss"
import { chromium } from "playwright"
import { PDFDocument } from "pdf-lib"
import { strict as assert } from "node:assert"
import { createServer } from "node:http"
import { mkdtemp, readFile, writeFile, rm, mkdir } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
const root = process.cwd()
const output = await mkdtemp(path.join(tmpdir(), "compass-inbox-"))
const screenshots =
  process.env.INBOX_SCREENSHOTS ?? path.join(output, "screenshots")
await mkdir(screenshots, { recursive: true })
const actionsPath = path.join(output, "actions.ts")
await writeFile(
  actionsPath,
  `
const people=[{userId:'staff',name:'Jordan Miller',email:'jordan@example.test',role:'staff',delivery:'compass'}];
let conversations=['Kitchen cabinets','Roof detail','Cabinet finish','Archived cabinet'].map((subject,index)=>({id:'c'+index,projectId:'project-a',subject,excerpt:'Project correspondence',lastActivityAt:'2026-09-06T12:00:00Z',people,unread:index<2,saved:false,followUp:false,archived:index===3,closed:false,shareReadReceipts:true}));
export function fixtureInbox(){return {compositionDraft:null,viewerId:'owner',projectName:'Cedar Ridge Residence',workspace:'owner',contacts:people,conversations}}
export async function getCorrespondenceInbox(){return {success:true,data:fixtureInbox()}}
export async function getCorrespondenceDetail(project,id){document.body.dataset.detailLoaded=id;return {success:true,data:{conversation:conversations.find(c=>c.id===id),participantVersion:1,hasEarlier:false,draft:null,messages:[{id:'m'+id,sequence:1,source:'compass',authorName:'Jordan Miller',authorUserId:'staff',sentAt:'2026-09-06T12:00:00Z',body:'Please review the cabinet plan and photograph.',recipients:[{name:'Alex',kind:'to'}],attachments:[{id:'photo',name:'Kitchen.jpg',size:1000,contentType:'image/jpeg',available:true},{id:'plan',name:'Plan.pdf',size:1000,contentType:'application/pdf',available:true},{id:'html',name:'Reference.html',size:200,contentType:'text/html',available:true}],editedAt:null,retractedAt:null,delivery:'saved',canEdit:false,readReceipts:[]}]}}}
export async function searchCorrespondence(project,query){return {success:true,data:{hits:conversations.filter(c=>c.subject.toLowerCase().includes(query.toLowerCase())).map(c=>({conversationId:c.id,messageId:'m'+c.id,subject:c.subject,excerpt:'Matching cabinet detail',sentAt:c.lastActivityAt})),hasMore:false}}}
export async function markCorrespondenceOpened(project,id){document.body.dataset.opened=id;conversations=conversations.map(c=>c.id===id?{...c,unread:false}:c);return {success:true,data:null}}
export async function updateCorrespondenceInbox(project,ids,action){if(new URLSearchParams(location.search).has('failBulk'))return {success:false,error:'Update failed; try again.'};document.body.dataset.bulk=JSON.stringify({ids,action});conversations=conversations.map(c=>!ids.includes(c.id)?c:{...c,...(action==='read'?{unread:false}:action==='archive'?{archived:true}:action==='restore'?{archived:false}:action==='save'||action==='unsave'?{saved:action==='save'}:{followUp:action==='follow-up'})});return {success:true,data:null}}
export async function setCorrespondenceState(){return {success:true,data:null}}
export async function setCorrespondenceClosed(){return {success:true,data:null}}
export async function setCorrespondenceReceiptPreference(){return {success:true,data:null}}
export async function saveCorrespondenceDraft(){return {success:true,data:{version:1}}}
export async function saveCorrespondenceCompositionDraft(){return {success:true,data:{version:1}}}
export async function discardCorrespondenceDraft(){return {success:true,data:null}}
export async function reviseCorrespondenceMessage(){throw Error('Unexpected mutation')}
export async function sendCorrespondence(){throw Error('Unexpected send')}
`,
)
const navigationPath = path.join(output, "navigation.ts")
await writeFile(
  navigationPath,
  `export function useSearchParams(){return new URLSearchParams(location.search)}`,
)
const entry = path.join(output, "entry.tsx")
await writeFile(
  entry,
  `import React from 'react';import {createRoot} from 'react-dom/client';import {ProjectCorrespondenceWorkspace} from '@/components/correspondence/project-correspondence-workspace';import {fixtureInbox} from './actions';createRoot(document.getElementById('root')).render(<ProjectCorrespondenceWorkspace projectId="project-a" initialInbox={fixtureInbox()} />);`,
)
await build({
  entryPoints: [entry],
  outfile: path.join(output, "app.js"),
  bundle: true,
  platform: "browser",
  format: "iife",
  jsx: "automatic",
  tsconfig: path.join(root, "tsconfig.json"),
  nodePaths: [path.join(root, "node_modules")],
  define: {
    "process.env.NODE_ENV": '"development"',
    "import.meta.url": "window.location.href",
  },
  plugins: [
    {
      name: "isolated-actions",
      setup(b) {
        b.onResolve(
          {
            filter:
              /^@\/app\/actions\/(project-correspondence|correspondence-inbox)$/,
          },
          () => ({ path: actionsPath }),
        )
        b.onResolve({ filter: /^next\/navigation$/ }, () => ({
          path: navigationPath,
        }))
      },
    },
  ],
})
const css = await postcss([tailwind({ base: root })]).process(
  '@import "./src/app/globals.css";',
  { from: path.join(root, "fixture.css") },
)
await writeFile(path.join(output, "app.css"), css.css)
const pdf = await PDFDocument.create()
pdf.addPage([400, 300]).drawText("Cabinet plan preview", { x: 30, y: 240 })
const pdfBytes = Buffer.from(await pdf.save())
const image = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jhWQAAAAASUVORK5CYII=",
  "base64",
)
const server = createServer(async (req, res) => {
  const url = new URL(req.url, "http://localhost")
  if (url.pathname.endsWith("/pdf.worker.min.mjs")) {
    res.setHeader("content-type", "application/javascript")
    res.end(
      await readFile(
        path.join(root, "node_modules/pdfjs-dist/build/pdf.worker.min.mjs"),
      ),
    )
    return
  }
  if (url.pathname.startsWith("/api/correspondence/attachments/")) {
    const isPdf = url.pathname.endsWith("/plan")
    res.setHeader("content-type", isPdf ? "application/pdf" : "image/png")
    res.setHeader(
      "content-disposition",
      url.searchParams.has("preview")
        ? "inline"
        : 'attachment; filename="attachment"',
    )
    res.end(isPdf ? pdfBytes : image)
    return
  }
  if (url.pathname === "/app.js" || url.pathname === "/app.css") {
    res.setHeader(
      "content-type",
      url.pathname.endsWith(".css") ? "text/css" : "application/javascript",
    )
    res.end(await readFile(path.join(output, url.pathname.slice(1))))
    return
  }
  res.setHeader("content-type", "text/html")
  res.end(
    '<html><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/app.css"></head><body><div id="root" class="flex h-dvh overflow-hidden"></div><script src="/app.js"></script></body></html>',
  )
})
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve))
const address = server.address()
assert(address && typeof address === "object")
const origin = `http://127.0.0.1:${address.port}`
let browser
try {
  browser = await chromium.launch({ headless: true })
  const page = await browser.newPage()
  const errors = []
  page.on("pageerror", (e) => errors.push(e.message))
  let downloads = 0
  page.on("download", () => downloads++)
  for (const width of [1440, 768, 390, 320]) {
    await page.setViewportSize({ width, height: 900 })
    await page.goto(origin)
    await page.getByRole("heading", { name: "Cedar Ridge Residence" }).waitFor()
    const inbox = page.getByRole("complementary", { name: "Message inbox" })
    const archive = inbox.getByRole("button", { name: "Archived", exact: true })
    const box = await archive.boundingBox()
    assert(box && box.x >= 0 && box.x + box.width <= width)
    assert.equal(
      await page.evaluate(
        () => document.documentElement.scrollWidth > innerWidth,
      ),
      false,
    )
    assert.equal(
      await page.locator("body").getAttribute("data.detailLoaded"),
      null,
    )
    assert.equal(
      await inbox
        .getByText("Kitchen cabinets", { exact: true })
        .evaluate((el) => getComputedStyle(el).fontWeight),
      "700",
    )
    await inbox.getByRole("button", { name: /^Unread/ }).click()
    assert.equal(
      await inbox
        .getByRole("checkbox", { name: /^Select conversation:/ })
        .count(),
      2,
    )
    await page.getByRole("searchbox").fill("cabinet")
    await inbox
      .getByRole("button", { name: /Matching cabinet detail/ })
      .waitFor()
    assert.equal(
      await inbox
        .getByRole("checkbox", { name: /^Select conversation:/ })
        .count(),
      1,
    )
    await page.getByRole("searchbox").fill("")
    await inbox
      .getByRole("checkbox", { name: "Select all visible conversations" })
      .click()
    assert.equal(await page.locator("body").getAttribute("data-opened"), null)
    await page.screenshot({
      path: path.join(screenshots, `selection-${width}.png`),
    })
    await inbox
      .getByRole("button", { name: "Mark as read", exact: true })
      .click()
    await inbox.getByText("No unread conversations match this view.").waitFor()
    assert.equal(
      JSON.parse(await page.locator("body").getAttribute("data-bulk")).ids
        .length,
      2,
    )
    await inbox.getByRole("button", { name: "Inbox", exact: true }).click()
    await inbox
      .getByRole("checkbox", { name: "Select all visible conversations" })
      .click()
    await inbox
      .getByRole("button", { name: "Needs reply", exact: true })
      .last()
      .click()
    await inbox
      .getByRole("status")
      .getByText(/flagged as needs reply/)
      .waitFor()
    await inbox
      .getByRole("button", { name: "Needs reply", exact: true })
      .click()
    assert.equal(
      await inbox
        .getByRole("checkbox", { name: /^Select conversation:/ })
        .count(),
      3,
    )
    await inbox
      .getByRole("checkbox", { name: "Select all visible conversations" })
      .click()
    await inbox
      .getByRole("button", { name: "Clear needs reply", exact: true })
      .click()
    await inbox.getByText("No conversations match this view.").waitFor()
    await inbox.getByRole("button", { name: "Inbox", exact: true }).click()
    await inbox
      .getByRole("checkbox", { name: "Select all visible conversations" })
      .click()
    await inbox.getByRole("button", { name: "Save", exact: true }).click()
    await inbox.getByRole("status").getByText("3 conversations saved.", { exact: true }).waitFor()
    await inbox.getByRole("button", { name: "Saved", exact: true }).click()
    assert.equal(await inbox.getByRole("checkbox", { name: /^Select conversation:/ }).count(), 3)
    await inbox.getByRole("checkbox", { name: "Select all visible conversations" }).click()
    await inbox.getByRole("button", { name: "Remove from Saved", exact: true }).click()
    await inbox.getByText("No conversations match this view.").waitFor()
    await inbox.getByRole("status").getByText("3 conversations removed from Saved.", { exact: true }).waitFor()
    await inbox.getByRole("button", { name: "Inbox", exact: true }).click()
    await inbox.getByRole("checkbox", { name: "Select all visible conversations" }).click()
    await inbox.getByRole("button", { name: "Archive", exact: true }).click()
    await inbox.getByText("No conversations match this view.").waitFor()
    await archive.click()
    assert.equal(
      await inbox
        .getByRole("checkbox", { name: /^Select conversation:/ })
        .count(),
      4,
    )
    await inbox
      .getByRole("checkbox", { name: "Select all visible conversations" })
      .click()
    await inbox.getByRole("button", { name: "Restore", exact: true }).click()
    await inbox.getByText("No conversations match this view.").waitFor()
    console.log(
      `PASS ${width}px unread/search, bold, selection, read, needs reply, save/unsave, archive/restore, uncut filters`,
    )
  }
  await page.setViewportSize({ width: 1280, height: 900 })
  await page.goto(origin)
  await page.getByText("Kitchen cabinets", { exact: true }).click()
  await page.getByRole("button", { name: "Preview Kitchen.jpg" }).click()
  await page.getByRole("dialog").getByRole("img").waitFor()
  assert.equal(downloads, 0)
  assert.match(
    await page.getByRole("dialog").getByRole("img").getAttribute("src"),
    /preview=1/,
  )
  await page.keyboard.press("Escape")
  await page.getByRole("button", { name: "Preview Plan.pdf" }).click()
  await page.getByRole("img", { name: "Plan.pdf, page 1" }).waitFor()
  assert.equal(downloads, 0)
  await page.screenshot({ path: path.join(screenshots, "pdf-preview.png") })
  await page.keyboard.press("Escape")
  await page.getByRole("button", { name: "Preview Reference.html" }).click()
  await page
    .getByText(
      "Preview is not available for this file type. Download it to open in its application.",
    )
    .waitFor()
  assert.equal(await page.getByRole("dialog").locator("iframe,img").count(), 0)
  await page.keyboard.press("Escape")
  const download = page.waitForEvent("download")
  await page.getByRole("link", { name: "Download Plan.pdf" }).click()
  await download
  assert.equal(downloads, 1)
  await page.goto(origin + "/?failBulk=1")
  await page
    .getByRole("checkbox", { name: "Select all visible conversations" })
    .click()
  await page.getByRole("button", { name: "Archive", exact: true }).click()
  await page
    .getByRole("status")
    .getByText(/Update failed/)
    .waitFor()
  assert.equal(
    await page
      .getByRole("checkbox", { name: /^Select conversation:/, checked: true })
      .count(),
    3,
  )
  assert.deepEqual(errors, [])
  console.log(
    "PASS attachment preview before download, unsupported fallback, bulk failure retention; no browser errors",
  )
} finally {
  await browser?.close()
  await new Promise((resolve) => server.close(resolve))
  await rm(output, { recursive: true, force: true })
}
