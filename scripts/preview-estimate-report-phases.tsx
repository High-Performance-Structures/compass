import { mkdir, readFile, writeFile } from "node:fs/promises"
import { resolve } from "node:path"
import { renderToStaticMarkup } from "react-dom/server"
import { chromium } from "@playwright/test"
import { compile } from "@tailwindcss/node"
import { Scanner } from "@tailwindcss/oxide"

import { ProjectEstimateReportPhases } from "../src/components/projects/project-estimate-report-phases"
import { clientEstimatePhases, type ClientEstimateLine, type ClientEstimateLineCostItem } from "../src/lib/estimates/client-report"

function costItem(id: string, costCode: string, description: string, quantity: number, unit: string, unitCostCents: number): ClientEstimateLineCostItem {
  return { id, costCode, costCodeName: description, description, quantity, unit, unitCostCents, lineTotalCents: quantity * unitCostCents, taxCode: null, taxName: null, taxRateBasisPoints: 0, taxCents: 0 }
}

function line(id: string, description: string, amount: number, costItems: readonly ClientEstimateLineCostItem[] = []): ClientEstimateLine {
  return { id, reportPhaseId: id, divisionCode: "03", divisionName: "Concrete", costCode: "03 30 00", costCodeName: description, description, specifications: null, quantity: 1, unit: "LS", unitCostCents: amount, lineTotalCents: amount, taxCode: null, taxName: null, taxRateBasisPoints: 0, taxCents: 0, ownerVisible: true, includeInBuilderFee: true, sortOrder: 1, costItems }
}

const phases = clientEstimatePhases({ phaseDescriptions: {}, reportPhases: [
  { id: "fox", divisionCode: "03", name: "Fox Blocks insulating concrete forms", description: "Supply and install the Fox Blocks ICF wall system, including forms, accessories, and installation labor.", itemize: true, sortOrder: 1 },
  { id: "concrete", divisionCode: "03", name: "Structural concrete", description: "Concrete placement for footings, foundation walls, and slabs, including pumping and finishing. ICF forms and reinforcing steel are shown separately.", itemize: false, sortOrder: 2 },
  { id: "steel", divisionCode: "03", name: "Reinforcing steel", description: "Supply, fabricate, and install reinforcing steel for the Division 03 concrete work.", itemize: false, sortOrder: 3 },
], lines: [
  { ...line("fox", "Fox Blocks wall system", 3600000, [
    costItem("forms", "03 11 19", "Fox Blocks ICF forms", 4000, "SF", 500),
    costItem("accessories", "03 11 19", "Bracing and ICF accessories", 1, "LS", 400000),
    costItem("labor", "03 11 19", "ICF installation labor", 4000, "SF", 300),
  ]), costCode: "03 11 19" },
  line("concrete", "Concrete placement and finishing", 4800000),
  { ...line("steel", "Rebar supply and installation", 1200000), costCode: "03 20 00" },
] })

const markup = renderToStaticMarkup(<main className="bg-white p-6 text-black">
  <header className="flex justify-between gap-8 border-b pb-4">
    <div><p className="text-xs font-semibold uppercase tracking-wide">High Performance Structures</p><h1 className="mt-1 text-2xl font-semibold">Construction Estimate</h1><p className="mt-1 text-sm">Custom report phase example</p></div>
    <div className="text-right text-xs"><p>PREVIEW ONLY</p><p>Illustrative amounts</p><p>September 18, 2026</p></div>
  </header>
  <p className="mt-4 text-sm">Three separately named phases from the same CSI division, each with its own scope description and client detail choice.</p>
  <ProjectEstimateReportPhases phases={phases} reportMode="phase_summary" />
  <div className="mt-6 flex justify-between border-t-2 py-3 text-base font-semibold"><span>Total illustrated Division 03 work</span><span>$96,000.00</span></div>
  <p className="mt-3 text-xs text-muted-foreground">Sample costs only. Builder fees and any applicable taxes are omitted from this example. Phase customization is available in H, O, N, and D departments. Original CSI codes and estimate calculations remain unchanged.</p>
</main>)
const compiler = await compile(await readFile(resolve("src/app/globals.css"), "utf8"), { base: resolve("src/app"), onDependency: () => {} })
const scanner = new Scanner({})
const css = compiler.build(scanner.scanFiles([{ content: markup, extension: "html" }]))
const html = `<!doctype html><html><head><meta charset="utf-8"><style>${css}\nbody{font-family:Arial,sans-serif;background:white} main{width:816px;margin:auto} @page{size:letter;margin:0}</style></head><body>${markup}</body></html>`
const output = resolve("output/pdf")
await mkdir(output, { recursive: true })
await writeFile(resolve(output, "custom-report-phases-example.html"), html)
const browser = await chromium.launch({ headless: true })
try {
  const page = await browser.newPage({ viewport: { width: 816, height: 1056 }, deviceScaleFactor: 2 })
  await page.setContent(html)
  await page.emulateMedia({ media: "print" })
  await page.pdf({ path: resolve(output, "custom-report-phases-example.pdf"), format: "Letter", printBackground: true })
  await page.screenshot({ path: resolve(output, "custom-report-phases-example.png"), fullPage: true })
  console.log(`Preview: ${output}`)
} finally { await browser.close() }
