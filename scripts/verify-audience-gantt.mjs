// Real Frappe/React browser proof; only authentication and server actions are isolated.
import { build } from "esbuild"
import postcss from "postcss"
import tailwind from "@tailwindcss/postcss"
import { chromium } from "playwright"
import { strict as assert } from "node:assert"
import { createServer } from "node:http"
import { mkdtemp, readFile, writeFile, mkdir, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
const root = process.cwd()
const output = await mkdtemp(path.join(tmpdir(), "compass-audience-gantt-"))
const screenshots =
  process.env.GANTT_SCREENSHOTS ?? path.join(output, "screenshots")
await mkdir(screenshots, { recursive: true })
await writeFile(
  path.join(output, "actions.ts"),
  `
async function record(kind,id,input){document.body.dataset.response=JSON.stringify({kind,id,input});return new URLSearchParams(location.search).has('fail')?{success:false,error:'The current schedule must be published before responding.'}:{success:true}}
export const respondToScheduleTaskAssignee=(id,input)=>record('assignment',id,input);
export const respondToScheduleTaskConfirmation=(id,response,note)=>record('legacy',id,{response,note});
export const proposeScheduleTaskChange=(id,input)=>record('proposal',id,input);
export async function getScheduleTaskAssignees(){if(new URLSearchParams(location.search).has('fail'))throw Error('Unavailable');return [{id:'assignment-a',displayName:'Alex Owner',responseStatus:'declined',responseMessage:'Windows delayed one week.',proposedStartDate:null,proposedWorkdays:null},{id:'assignment-b',displayName:'Stoneworks',responseStatus:'proposed',responseMessage:'Crew available Monday.',proposedStartDate:'2026-09-21',proposedWorkdays:5}]}

`
)
await writeFile(
  path.join(output, "navigation.ts"),
  `export function useRouter(){return {refresh(){document.body.dataset.refreshed='yes'}}}`
)
await writeFile(
  path.join(output, "entry.tsx"),
  `
import React from 'react';import {createRoot} from 'react-dom/client';
import {ProjectAudienceSchedule} from '@/components/projects/project-audience-schedule';
import {GanttChart} from '@/components/schedule/gantt-chart';
import {ScheduleCommitmentResponses} from '@/components/schedule/schedule-commitment-responses';
const query=new URLSearchParams(location.search);const owner=query.has('owner');const readonly=query.has('readonly');
const titles=['Owner-supplied windows delivered','Foundation and waterproofing','Custom steel framing','Roof dry-in','Owner-installed lighting','Stone and millwork','Final walkthrough'];
const items=Array.from({length:24},(_,i)=>({id:'task-'+i,title:titles[i%titles.length]+(i>=titles.length?' '+i:''),startDate:'2026-09-'+String(7+i%18).padStart(2,'0'),endDate:'2026-09-'+String(10+i%18).padStart(2,'0'),workdays:3,status:i===1?'COMPLETE':'PENDING',phase:'Construction',displayColor:['blue','green','purple','orange','yellow','teal','gray'][i%7],assignedTo:i===0?'Alex Owner':'Stoneworks',percentComplete:i===1?100:i===2?40:0,isMilestone:i===0,confirmationRequired:true,confirmationStatus:'confirmed',viewerCanConfirm:i===4,proposedStartDate:null,proposedWorkdays:null,proposalNote:null,proposalSubmittedAt:null,assignees:i===4?[]:[{id:'assignment-'+i,assignedUserId:owner?'owner':'vendor',projectContactId:null,displayName:owner?'Alex Owner':'Stoneworks',responseStatus:i===0?'confirmed':'pending',dateResponseStatus:'pending',durationResponseStatus:'pending',proposedStartDate:null,proposedWorkdays:null,responseMessage:null,viewerCanRespond:i===0}]}));
items.push({...items[1],id:'safe-title',title:'Trim <image href="bad" onload="window.unsafe=true" /> & finish',assignees:[]});
const tasks=items.map(i=>({id:i.id,name:i.title,start:i.startDate,end:i.endDate,progress:i.percentComplete,dependencies:'',custom_class:'display-color-'+i.displayColor,displayColor:i.displayColor,isMilestone:i.isMilestone,isCriticalPath:false}));
createRoot(document.getElementById('root')).render(<main style={{padding:16}}>{query.has('commitments')?<ScheduleCommitmentResponses taskId="task-1" onUseProposal={(p)=>document.body.dataset.applied=JSON.stringify(p)} />:query.has('internal')?<div style={{height:600}}><GanttChart tasks={tasks} viewMode="Week" readOnly={readonly} onDateChange={()=>document.body.dataset.dateChanged='yes'} onProgressChange={()=>document.body.dataset.progressChanged='yes'} /></div>:<ProjectAudienceSchedule audienceLabel={owner?'Owner':'Vendor'} items={items} publicationAvailable projectId="project-a" projectName="Cedar Ridge Residence" projectNumber="CR-26" />}</main>);
`
)
await build({
  entryPoints: [path.join(output, "entry.tsx")],
  outfile: path.join(output, "app.js"),
  bundle: true,
  platform: "browser",
  format: "iife",
  jsx: "automatic",
  tsconfig: path.join(root, "tsconfig.json"),
  nodePaths: [path.join(root, "node_modules")],
  define: { "process.env.NODE_ENV": '"development"', "process.env": "{}" },
  plugins: [
    {
      name: "boundaries",
      setup(b) {
        b.onResolve(
          { filter: /^@\/app\/actions\/schedule-confirmations$/ },
          () => ({ path: path.join(output, "actions.ts") })
        )
        b.onResolve({ filter: /^next\/navigation$/ }, () => ({
          path: path.join(output, "navigation.ts")
        }))
      }
    }
  ]
})
const ganttCss = await readFile(path.join(output, "app.css"), "utf8")
const css = await postcss([tailwind({ base: root })]).process(
  '@import "./src/app/globals.css";',
  { from: path.join(root, "fixture.css") }
)
await writeFile(path.join(output, "app.css"), css.css + "\n" + ganttCss)
const server = createServer(async (req, res) => {
  const url = new URL(req.url, "http://localhost")
  if (url.pathname === "/app.js" || url.pathname === "/app.css") {
    res.setHeader(
      "content-type",
      url.pathname.endsWith("js") ? "application/javascript" : "text/css"
    )
    res.end(await readFile(path.join(output, url.pathname.slice(1))))
    return
  }
  res.setHeader("content-type", "text/html")
  res.end(
    '<!DOCTYPE html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/app.css"></head><body><div id="root"></div><script src="/app.js"></script></body></html>'
  )
})
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve))
const browser = await chromium.launch({ headless: true })
try {
  const page = await browser.newPage({
    viewport: { width: 1440, height: 1000 }
  })
  const errors = []
  page.on("pageerror", (e) => {
    errors.push(e.message)
    console.error("Browser error:", e.message)
  })
  const url = "http://127.0.0.1:" + server.address().port
  const load = async (query = "") => {
    await page.goto(url + query)
    await page.getByRole("button", { name: "Gantt", exact: true }).click()
    await page.locator(".bar-wrapper").first().waitFor()
    await page.waitForTimeout(250)
  }
  await load("?owner")
  assert.equal(await page.locator(".handle").count(), 0)
  assert.equal(await page.locator(".bar-wrapper").count(), 25)
  assert.equal(
    await page.locator('.bar-wrapper[data-id="task-0"].milestone').count(),
    1
  )
  assert.equal(await page.locator(".bar-label image").count(), 0)
  assert.equal(await page.evaluate(() => window.unsafe), undefined)
  await page.screenshot({
    path: path.join(screenshots, "owner-gantt-desktop.png"),
    fullPage: true
  })
  const geometry = await page.evaluate(() => {
    const row = document.querySelector("tbody tr").getBoundingClientRect()
    const bar = document
      .querySelector('.bar-wrapper[data-id="task-18"] .bar')
      .getBoundingClientRect()
    return {
      rowHeight: row.height,
      centerDifference: Math.abs(
        row.y + row.height / 2 - bar.y - bar.height / 2
      )
    }
  })
  assert.equal(geometry.rowHeight, 48)
  assert.ok(geometry.centerDifference < 2, JSON.stringify(geometry))
  // Read-only applies to the actual bar, not just hiding editor callbacks.
  const bar = page.locator('.bar-wrapper[data-id="task-2"] .bar')
  const before = await bar.getAttribute("x")
  const bounds = await bar.boundingBox()
  if (bounds) {
    await page.mouse.move(bounds.x + 20, bounds.y + 10)
    await page.mouse.down()
    await page.mouse.move(bounds.x + 100, bounds.y + 10, { steps: 8 })
    await page.mouse.up()
  }
  assert.equal(await bar.getAttribute("x"), before)
  await page.keyboard.press("Escape")
  await page
    .getByRole("button", {
      name: "Owner-supplied windows delivered",
      exact: true
    })
    .click()
  await page.getByRole("button", { name: "Report conflict" }).click()
  await page
    .getByRole("textbox", { name: "Note (optional)" })
    .fill("Window delivery is delayed by one week.")
  await page.getByRole("button", { name: "Send conflict", exact: true }).click()
  await page
    .getByRole("dialog", { name: "Report a schedule conflict", exact: true })
    .waitFor({ state: "hidden" })
  await page.waitForFunction(() => document.body.dataset.response)
  let response = JSON.parse(
    await page.locator("body").getAttribute("data-response")
  )
  assert.deepEqual(response, {
    kind: "assignment",
    id: "assignment-0",
    input: {
      response: "declined",
      message: "Window delivery is delayed by one week."
    }
  })
  await page.getByRole("button", { name: "Suggest dates / duration" }).click()
  await page.getByLabel("Start date", { exact: true }).fill("2026-09-21")
  await page.getByLabel("Duration (workdays)").fill("5")
  await page.getByRole("button", { name: "Send proposal", exact: true }).click()
  await page
    .getByRole("dialog", { name: "Suggest dates or duration", exact: true })
    .waitFor({ state: "hidden" })
  response = JSON.parse(
    await page.locator("body").getAttribute("data-response")
  )
  assert.equal(response.input.proposedStartDate, "2026-09-21")
  assert.equal(response.input.proposedWorkdays, 5)
  await page
    .getByRole("dialog", {
      name: "Owner-supplied windows delivered",
      exact: true
    })
    .getByRole("button", { name: "Close", exact: true })
    .click()
  await page
    .getByRole("button", { name: "Foundation and waterproofing", exact: true })
    .click()
  assert.equal(
    await page.getByRole("button", { name: "Report conflict" }).count(),
    0
  )
  await page.keyboard.press("Escape")
  for (const mode of ["Day", "Month", "Year", "Week"]) {
    await page.getByRole("button", { name: "Gantt controls" }).click()
    await page.getByRole("menuitemradio", { name: mode, exact: true }).click()
    await page.waitForTimeout(100)
    assert.equal(await page.locator(".handle").count(), 0)
  }
  await page.getByRole("button", { name: "Zoom in", exact: true }).click()
  await page.getByRole("button", { name: "Zoom out", exact: true }).click()
  await page.getByRole("button", { name: "Today", exact: true }).first().click()
  const list = page.locator(".schedule-gantt-task-list")
  await list.evaluate((el) => {
    el.scrollTop = 250
  })
  await page.waitForTimeout(100)
  assert.ok(
    Math.abs(
      (await list.evaluate((el) => el.scrollTop)) -
        (await page.locator(".gantt-container").evaluate((el) => el.scrollTop))
    ) < 2
  )
  await page.locator(".gantt-container").evaluate((el) => {
    el.scrollTop = el.scrollHeight
  })
  await page.waitForTimeout(100)
  assert.ok(
    Math.abs(
      (await list.evaluate((el) => el.scrollTop)) -
        (await page.locator(".gantt-container").evaluate((el) => el.scrollTop))
    ) < 2,
    "bottom rows stay aligned"
  )
  await page.getByRole("button", { name: "List", exact: true }).click()
  assert.ok(
    (await page.getByRole("button", { name: "Confirm availability" }).count()) >
      0
  )
  await page.getByRole("button", { name: "Calendar", exact: true }).click()
  await page
    .getByRole("button", { name: "Previous month", exact: true })
    .click()
  await load("?fail&owner")
  await page
    .getByRole("button", {
      name: "Owner-supplied windows delivered",
      exact: true
    })
    .click()
  await page.getByRole("button", { name: "Confirm availability" }).click()
  await page
    .getByRole("button", { name: "Confirm commitment", exact: true })
    .click()
  await page
    .getByRole("alert")
    .filter({ hasText: "current schedule" })
    .waitFor()
  await page.keyboard.press("Escape")
  await page.keyboard.press("Escape")
  await load("?vendor")
  await page
    .getByRole("button", { name: "Owner-installed lighting", exact: true })
    .click()
  await page.getByRole("button", { name: "Report conflict" }).click()
  await page
    .getByRole("textbox", { name: "Note (optional)" })
    .fill("Need another day.")
  await page.getByRole("button", { name: "Send conflict", exact: true }).click()
  await page
    .getByRole("dialog", { name: "Report a schedule conflict", exact: true })
    .waitFor({ state: "hidden" })
  response = JSON.parse(
    await page.locator("body").getAttribute("data-response")
  )
  assert.equal(response.kind, "legacy")
  assert.equal(response.input.note, "Need another day.")
  await page.keyboard.press("Escape")
  await page.setViewportSize({ width: 390, height: 844 })
  await load("?owner")
  await page.screenshot({
    path: path.join(screenshots, "owner-gantt-mobile.png"),
    fullPage: true
  })
  assert.ok(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth
    )
  )
  await page.getByRole("button", { name: "Show items" }).click()
  await page
    .getByRole("button", {
      name: "Owner-supplied windows delivered",
      exact: true
    })
    .click()
  await page.getByRole("button", { name: "Report conflict" }).waitFor()
  await page.keyboard.press("Escape")
  await page.getByRole("button", { name: "Show chart" }).click()
  // Internal editing keeps its handles and popup; explicit readonly is enforced even with callbacks supplied.
  await page.setViewportSize({ width: 1440, height: 1000 })
  await page.goto(url + "?internal")
  await page.locator(".handle").first().waitFor()
  await page.locator(".bar-wrapper").first().click()
  await page.locator(".popup-wrapper .title").waitFor()
  await page.screenshot({
    path: path.join(screenshots, "internal-gantt-reference.png"),
    fullPage: true
  })
  await page.locator(".popup-wrapper").evaluate((el) => {
    el.style.display = "none"
  })
  const editableBar = page.locator('.bar-wrapper[data-id="task-2"] .bar')
  const editableBounds = await editableBar.boundingBox()
  assert.ok(editableBounds)
  await page.mouse.move(editableBounds.x + 10, editableBounds.y + 10)
  await page.mouse.down()
  await page.mouse.move(editableBounds.x + 150, editableBounds.y + 10, {
    steps: 10
  })
  await page.mouse.up()
  await page.waitForFunction(() => document.body.dataset.dateChanged === "yes")
  await page.goto(url + "?internal&readonly")
  await page.locator(".bar-wrapper").first().waitFor()
  assert.equal(await page.locator(".handle").count(), 0)
  await page.goto(url + "?commitments")
  await page.getByText("Windows delayed one week.", { exact: true }).waitFor()
  await page.getByText("Cannot commit", { exact: true }).waitFor()
  await page
    .getByRole("button", { name: "Use proposed dates", exact: true })
    .click()
  assert.deepEqual(
    JSON.parse(await page.locator("body").getAttribute("data-applied")),
    { startDate: "2026-09-21", workdays: 5 }
  )
  assert.equal(await page.locator("body").getAttribute("data-response"), null)
  await page.goto(url + "?commitments&fail")
  await page
    .getByRole("alert")
    .filter({ hasText: "Unable to load individual responses" })
    .waitFor()
  await page.getByRole("button", { name: "Retry", exact: true }).waitFor()
  assert.deepEqual(errors, [])
  console.log(JSON.stringify({ passed: true, screenshots, geometry }))
} finally {
  await browser.close()
  await new Promise((resolve) => server.close(resolve))
  if (process.env.GANTT_SCREENSHOTS)
    await rm(output, { recursive: true, force: true })
}
