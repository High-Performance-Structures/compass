import assert from "node:assert/strict"
import { execFile } from "node:child_process"
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test from "node:test"
import { promisify } from "node:util"

import { assembleBuildertrendTemplateNextBatchContent } from "./lib/buildertrend-template-next-batch-content.mjs"

const execFileAsync = promisify(execFile)
const paths = {
  release: "scripts/fixtures/buildertrend-template-content-next-batch-release-2026-08-04.json",
  manifest: "scripts/fixtures/buildertrend-template-next-batch-2026-08-04.json",
  reviewed: "scripts/fixtures/buildertrend-active-template-capture-2026-07-31.json",
}

async function inputs() {
  const [release, nextBatchManifest, reviewedCapture] = await Promise.all(
    Object.values(paths).map(async (path) => JSON.parse(await readFile(path, "utf8")))
  )
  const documents = await Promise.all(release.templates.map(async (template) => ({
    source: template.fragmentPath,
    document: JSON.parse(await readFile(template.fragmentPath, "utf8")),
  })))
  return { release, nextBatchManifest, reviewedCapture, documents }
}

test("assembles the thirteen gate-complete templates with reviewed schedules", async () => {
  const result = assembleBuildertrendTemplateNextBatchContent(await inputs())

  assert.deepEqual(
    result.capture.assembly.sourceTemplateIds,
    ["12859981", "12978371", "12581937", "12594475", "30917204", "12646335", "12650792", "12819873", "12649495", "30914491", "12858966", "12649292", "12650557"]
  )
  assert.equal(result.capture.assembly.draftOnly, true)
  assert.equal(result.capture.assembly.publish, false)
  assert.equal(result.capture.assembly.excludedIncompleteTemplateCount, 21)
  assert.equal(result.capture.assembly.excludedArchivedTemplateCount, 27)
  assert.equal(result.capture.assembly.eligibleAfterThisBatch, 0)
  assert.equal(result.capture.templates.reduce((sum, item) => sum + item.tasks.length, 0), 372)
  assert.equal(result.capture.templates.reduce((sum, item) => sum + item.scheduleItems.length, 0), 61)
  assert.equal(result.capture.templates.reduce((sum, item) => sum + (item.selections?.length ?? 0), 0), 13)
  assert.equal(result.capture.templates.reduce((sum, item) => sum + (item.bidPackages?.length ?? 0), 0), 8)
  assert.equal(result.capture.templates.reduce(
    (sum, item) => sum + item.scheduleItems.flatMap((row) => row.predecessors).length,
    0
  ), 48)
  assert.equal(result.inventory.expectedActiveCount, 13)
  assert.equal(result.inventory.excludedArchivedCount, 27)
  assert.deepEqual(
    result.inventory.templates.map((template) => template.sourceTemplateId),
    ["12859981", "12978371", "12581937", "12594475", "30917204", "12646335", "12650792", "12819873", "12649495", "30914491", "12858966", "12649292", "12650557"]
  )
})

test("preserves the reviewed Siding hierarchy, selections, bid package, and copy warnings", async () => {
  const result = assembleBuildertrendTemplateNextBatchContent(await inputs())
  const siding = result.capture.templates.find((template) => template.sourceTemplateId === "30917204")
  assert.ok(siding)
  assert.equal(siding.tasks.length, 29)
  assert.equal(siding.tasks.filter((task) => task.parentSourceItemId === null).length, 3)
  assert.deepEqual(
    siding.tasks.filter((task) => task.parentSourceItemId === "180199031").map((task) => task.title),
    [
      "Level Horizontally",
      "Level Vertically",
      "Joints Blocked & Butt Joints Caulked or Concealed w/ Batten Strips",
      "Nails Recessed & Caulked",
      "Drip Cap",
      "Corner Detailing",
      "Wedges",
      "Chinking completed",
      "No Gouges",
      "No Cracks",
      "No Breaking",
      "No Exposed Underlayment",
      "No Buckles or Ripples",
      "No Dents",
      "No Chips",
      "No Scratches",
      "No Loose Siding",
      "No Shrinking",
      "No Twists",
      "No Bows",
      "No Knots Falling Out (Wood Siding)",
      "No Splits @ Nails",
      "Lap on Bevel Siding",
      "No Delamination",
      "Jobsite Cleanup Satisfactory",
      "OK to Pay",
    ]
  )
  assert.deepEqual(
    siding.tasks.filter((task) => task.parentSourceItemId === "180199031").map((task) => task.sortOrder),
    Array.from({ length: 26 }, (_, index) => index + 1)
  )

  assert.equal(siding.selections.length, 4)
  const sidingType = siding.selections.find((selection) => selection.sourceSelectionId === "63637592")
  assert.ok(sidingType)
  assert.equal(sidingType.allowMultipleSelectedChoices, false)
  assert.equal(sidingType.choiceOrdering, "Auto")
  assert.deepEqual(
    sidingType.choices.map((choice) => ({
      sourceChoiceId: choice.sourceChoiceId,
      title: choice.title,
      attachment: choice.attachments[0].fileName,
    })),
    [
      { sourceChoiceId: "262674474", title: "Composite Siding", attachment: "bardage-composite-eternit.jpg" },
      { sourceChoiceId: "262674473", title: "Fiber Cement", attachment: "james-hardie-siding-calgary.jpg" },
      { sourceChoiceId: "262674472", title: "LP SmartSide", attachment: "LP SmartSide.jpg" },
      { sourceChoiceId: "262674476", title: "Metal Siding", attachment: "Metal Siding.jpg" },
      { sourceChoiceId: "262674475", title: "Natural Wood Siding", attachment: "Natural wood siding.jpg" },
      { sourceChoiceId: "262674471", title: "Vinyl Siding", attachment: "Vinyl siding.jpg" },
    ]
  )
  assert.match(
    siding.selections.find((selection) => selection.sourceSelectionId === "63637593").description,
    /select your primary color/
  )
  assert.match(
    siding.selections.find((selection) => selection.sourceSelectionId === "63637594").description,
    /secondary accent color/
  )
  assert.match(
    siding.selections.find((selection) => selection.sourceSelectionId === "63637595").description,
    /siding trim at corners and around openings/
  )

  assert.equal(siding.bidPackages.length, 1)
  const bidPackage = siding.bidPackages[0]
  assert.equal(bidPackage.sourceBidPackageId, "13414442")
  assert.equal(bidPackage.title, "Siding - (Proj. Address) (Est. Phase)")
  assert.equal(bidPackage.pricingFormat, "Line Items")
  assert.deepEqual(
    bidPackage.lineItems.map((lineItem) => ({
      title: lineItem.title,
      costCode: lineItem.costCode,
      costType: lineItem.costType,
    })),
    [
      {
        title: "Metal Siding Installation Labor & Misc. Materials",
        costCode: "07 46 19 - Steel Siding",
        costType: "None",
      },
      {
        title: "Metal Siding Materials",
        costCode: "07 46 19 - Steel Siding",
        costType: "Material",
      },
      {
        title: "Hardie Siding Installation Labor & Misc. Materials",
        costCode: "07 46 46 - Fiber-Cement Siding",
        costType: "None",
      },
      {
        title: "Hardie Siding Materials",
        costCode: "07 46 46 - Fiber-Cement Siding",
        costType: "Material",
      },
    ]
  )

  assert.equal(siding.scheduleItems.length, 3)
  assert.equal(siding.scheduleItems.find((item) => item.sourceItemId === "180238656").title, "HPS Siding QC Inpsection")
  assert.deepEqual(
    siding.scheduleItems.flatMap((item) => item.predecessors).map((dependency) => ({
      predecessorSourceItemId: dependency.predecessorSourceItemId,
      successorSourceItemId: dependency.successorSourceItemId,
      type: dependency.type,
      lagDays: dependency.lagDays,
    })),
    [
      { predecessorSourceItemId: "180238306", successorSourceItemId: "180238320", type: "SS", lagDays: -1 },
      { predecessorSourceItemId: "180238306", successorSourceItemId: "180238656", type: "FS", lagDays: 0 },
    ]
  )

  const sidingExceptions = result.capture.conversionExceptions.filter(
    (exception) => exception.templateSourceTemplateId === "30917204"
  )
  assert.equal(sidingExceptions.length, 2)
  assert.deepEqual(sidingExceptions.map((exception) => exception.field), [
    "lineItems.multipleCostTypes[0]",
    "lineItems.multipleCostTypes[1]",
  ])
  assert.equal(sidingExceptions.every((exception) => exception.sourceItemId === null), true)
  assert.equal(sidingExceptions.every((exception) => /do not infer/.test(exception.recoveryPlan)), true)
})

test("preserves the reviewed Concrete Slab checklist, schedule, and bid specifications", async () => {
  const result = assembleBuildertrendTemplateNextBatchContent(await inputs())
  const slab = result.capture.templates.find((template) => template.sourceTemplateId === "12594475")
  assert.ok(slab)
  assert.equal(slab.tasks.length, 36)
  assert.equal(slab.tasks.filter((task) => task.parentSourceItemId === null).length, 15)
  assert.equal(slab.tasks.filter((task) => task.parentSourceItemId !== null).length, 21)
  assert.deepEqual(
    slab.tasks.filter((task) => task.parentSourceItemId === "75705647").map((task) => task.title),
    ["Final Grade @ Correct Elevation", "Final Grade @ Correct Slope"]
  )
  assert.deepEqual(
    slab.tasks.filter((task) => task.parentSourceItemId === "75705682").map((task) => task.title),
    [
      "Slab is Flat",
      "No Dips",
      "Radiant Lines Pressurized to 60 psi",
      "Rigid Insulation in Stagger Pattern",
      "Rigid Insulation Taped",
      "Slab Reinforcing Installed",
      "Slab at Correct Elevation",
    ]
  )
  assert.equal(slab.tasks.filter((task) => task.parentSourceItemId === "75705684").length, 12)
  assert.equal(slab.scheduleItems.length, 8)
  assert.equal(slab.scheduleItems.flatMap((item) => item.predecessors).length, 8)

  assert.equal(slab.bidPackages.length, 1)
  const bidPackage = slab.bidPackages[0]
  assert.equal(bidPackage.sourceBidPackageId, "10290610")
  assert.equal(bidPackage.title, "Flat Work - (Project Address) (Estimate Phase)")
  assert.equal(bidPackage.status, "Draft")
  assert.equal(bidPackage.pricingFormat, "Line Items")
  assert.match(bidPackage.description, /Contract and Insurance Requirements/)
  assert.match(bidPackage.internalNotes, /Input the SQFT into the QTY Line/)
  assert.deepEqual(
    bidPackage.lineItems.map((item) => ({
      sourceLineItemId: item.sourceLineItemId,
      costCode: item.costCode,
      costType: item.costType,
      unit: item.unit,
      description: item.description,
    })),
    [
      {
        sourceLineItemId: "17860313",
        costCode: "03 35 00 - Concrete Finishing",
        costType: "Subcontractor",
        unit: "SQFT",
        description: "Concrete CUYD: (X) CUYD, Finish: Slick",
      },
      {
        sourceLineItemId: "17860314",
        costCode: "32 13 13 - Concrete Paving",
        costType: "Subcontractor",
        unit: "SQFT",
        description: "Concrete CUYD: (X) CUYD; Finish: Broom",
      },
    ]
  )
})

test("preserves Interior Wall checklist, bid specifications, and reviewed dependency", async () => {
  const result = assembleBuildertrendTemplateNextBatchContent(await inputs())
  const interiorWall = result.capture.templates.find(
    (template) => template.sourceTemplateId === "12646335"
  )
  assert.ok(interiorWall)
  assert.equal(interiorWall.tasks.length, 34)
  assert.equal(interiorWall.tasks.filter((task) => task.parentSourceItemId === null).length, 6)
  assert.equal(interiorWall.tasks.filter((task) => task.parentSourceItemId !== null).length, 28)

  const taskIds = new Set(interiorWall.tasks.map((task) => task.sourceItemId))
  for (const task of interiorWall.tasks) {
    if (task.parentSourceItemId !== null) assert.equal(taskIds.has(task.parentSourceItemId), true)
  }

  assert.equal(interiorWall.scheduleItems.length, 2)
  assert.deepEqual(interiorWall.scheduleItems[1].predecessors, [{
    predecessorSourceItemId: "141652402",
    successorSourceItemId: "141654663",
    type: "FS",
    lagDays: 0,
  }])

  assert.equal(interiorWall.bidPackages.length, 1)
  const bid = interiorWall.bidPackages[0]
  assert.equal(bid.sourceBidPackageId, "13414443")
  assert.equal(bid.description.includes("Contract and Insurance Requirements"), true)
  assert.deepEqual(
    bid.lineItems.map((item) => item.sourceLineItemId),
    ["23494886", "23494887", "23494888", "23494889", "23494890", "23494891"]
  )
  assert.deepEqual(
    bid.lineItems.map((item) => item.costCode),
    [
      "06 11 00 - Wood Framing",
      "06 15 00 - Wood Decking",
      "06 15 13 - Wood Floor Decking",
      "06 15 16 - Wood Roof Decking",
      "08 00 00 - Openings",
      "08 50 00 - Windows",
    ]
  )
  assert.equal(bid.lineItems.every((item) => item.costType === "Subcontractor"), true)
  assert.equal(bid.lineItems.every((item) => item.description.length > 0), true)
})

test("preserves Roof Trusses checklist hierarchy and reviewed schedule graph", async () => {
  const result = assembleBuildertrendTemplateNextBatchContent(await inputs())
  const roof = result.capture.templates.find(
    (template) => template.sourceTemplateId === "12650792"
  )
  assert.ok(roof)
  assert.equal(roof.tasks.length, 28)
  assert.equal(roof.tasks.filter((task) => task.parentSourceItemId === null).length, 12)
  assert.equal(roof.tasks.filter((task) => task.parentSourceItemId !== null).length, 16)
  assert.deepEqual(
    roof.tasks.filter((task) => task.parentSourceItemId === null).map((task) => ({
      sourceItemId: task.sourceItemId,
      title: task.title,
      sortOrder: task.sortOrder,
    })),
    [
      { sourceItemId: "75711450", title: "Cut (X) Level Roof Truss Blocking", sortOrder: 1 },
      { sourceItemId: "75711451", title: "(X) Level Roof Truss Layout", sortOrder: 2 },
      { sourceItemId: "75711452", title: "Set (X) Level Roof Trusses", sortOrder: 3 },
      { sourceItemId: "75711453", title: "(X) Level Roof Roll/Fire Blocking", sortOrder: 4 },
      { sourceItemId: "75711454", title: "Sheet (X) Level Gable End Trusses", sortOrder: 5 },
      { sourceItemId: "75711455", title: "(X) Level Wall Framing Nailers", sortOrder: 6 },
      { sourceItemId: "75711456", title: "(X) Level (TYPE) Hurricane Ties", sortOrder: 7 },
      { sourceItemId: "75711457", title: "(X) Level Roof Backout", sortOrder: 8 },
      { sourceItemId: "75711458", title: "(X) Level Roof Tie-Ins", sortOrder: 9 },
      { sourceItemId: "75711459", title: "(X) Level Roof Sub-Fascia Installed", sortOrder: 10 },
      { sourceItemId: "75711460", title: "Sheet (X) Level Roof", sortOrder: 11 },
      { sourceItemId: "75711461", title: "HPS Roof Framing QC Inspection", sortOrder: 12 },
    ]
  )
  assert.deepEqual(
    roof.tasks.filter((task) => task.parentSourceItemId === "75711456").map((task) => ({
      sourceItemId: task.sourceItemId,
      title: task.title,
      sortOrder: task.sortOrder,
    })),
    [
      { sourceItemId: "75711763", title: "(Direction) Wall Hurricane Ties", sortOrder: 1 },
      { sourceItemId: "75711764", title: "(Direction) Wall Hurricane Ties", sortOrder: 2 },
    ]
  )
  assert.deepEqual(
    roof.tasks.filter((task) => task.parentSourceItemId === "75711461").map((task) => task.title),
    [
      "Trusses @ Correct Spacing",
      "All Trusses In Correct Spots According to Layout",
      "All Ties/Hold Downs in correct spots",
      "No Truss Lift",
      "Roof Decking/Sheathing Complete and Correct",
      "Roofline/Pitch Correct",
      "No Cracked Trusses",
      "Jobsite Cleanup Satisfactory",
      "OK to Pay",
    ]
  )

  assert.equal(roof.scheduleItems.length, 5)
  assert.deepEqual(
    roof.scheduleItems.map((item) => ({
      sourceItemId: item.sourceItemId,
      title: item.title,
      startDate: item.startDate,
      workdays: item.workdays,
      phase: item.phase,
      displayColor: item.displayColor,
    })),
    [
      { sourceItemId: "141696826", title: "(X) Level Truss Setting Prep", startDate: "2022-04-13", workdays: 1, phase: "Rough: Frame", displayColor: "#ABBE91" },
      { sourceItemId: "141695529", title: "Set (X) Level Roof Trusses", startDate: "2022-04-14", workdays: 1, phase: "Rough: Frame", displayColor: "#ABBE91" },
      { sourceItemId: "141696771", title: "(X) Level Rough Roof Framing", startDate: "2022-04-15", workdays: 5, phase: "Rough: Frame", displayColor: "#ABBE91" },
      { sourceItemId: "141698217", title: "(X) Level Roof Sheeting", startDate: "2022-04-22", workdays: 4, phase: "Rough: Frame", displayColor: "#ABBE91" },
      { sourceItemId: "180255949", title: "HPS Roof Framing QC Inpsection", startDate: "2022-04-28", workdays: 1, phase: "UNASSIGNED", displayColor: "#2222DD" },
    ]
  )
  assert.deepEqual(
    roof.scheduleItems.flatMap((item) => item.predecessors).map((dependency) => ({
      predecessorSourceItemId: dependency.predecessorSourceItemId,
      successorSourceItemId: dependency.successorSourceItemId,
      type: dependency.type,
      lagDays: dependency.lagDays,
    })),
    [
      { predecessorSourceItemId: "141696826", successorSourceItemId: "141695529", type: "FS", lagDays: 0 },
      { predecessorSourceItemId: "141695529", successorSourceItemId: "141696771", type: "FS", lagDays: 0 },
      { predecessorSourceItemId: "141696771", successorSourceItemId: "141698217", type: "FS", lagDays: 0 },
      { predecessorSourceItemId: "141696771", successorSourceItemId: "180255949", type: "FS", lagDays: 0 },
      { predecessorSourceItemId: "141698217", successorSourceItemId: "180255949", type: "FS", lagDays: 0 },
    ]
  )
})

test("preserves Fascia and Soffit checklist hierarchy and reviewed schedule graph", async () => {
  const result = assembleBuildertrendTemplateNextBatchContent(await inputs())
  const fascia = result.capture.templates.find(
    (template) => template.sourceTemplateId === "12819873"
  )
  assert.ok(fascia)
  assert.equal(fascia.tasks.length, 25)
  assert.equal(fascia.tasks.filter((task) => task.parentSourceItemId === null).length, 7)
  assert.equal(fascia.tasks.filter((task) => task.parentSourceItemId !== null).length, 18)
  assert.deepEqual(
    fascia.tasks.filter((task) => task.parentSourceItemId === null).map((task) => ({
      sourceItemId: task.sourceItemId,
      title: task.title,
      sortOrder: task.sortOrder,
    })),
    [
      { sourceItemId: "75714140", title: "Install (X Direction) Wall Soffit Ribbon", sortOrder: 1 },
      { sourceItemId: "75714141", title: "Install (X Direction) Wall Soffit", sortOrder: 2 },
      { sourceItemId: "75714142", title: "Install (X Direction) Fascia", sortOrder: 3 },
      { sourceItemId: "75714143", title: "Paint (X Direction) Wall Soffit", sortOrder: 4 },
      { sourceItemId: "75714145", title: "Paint (X Direction) Wall Fascia", sortOrder: 5 },
      { sourceItemId: "75714147", title: "HPS Soffit & Fascia QC Inspection", sortOrder: 6 },
      { sourceItemId: "75714149", title: "HPS Soffit & Fascia QC Inpsection", sortOrder: 7 },
    ]
  )
  assert.deepEqual(
    fascia.tasks.filter((task) => task.parentSourceItemId === "75714147").map((task) => task.title),
    [
      "All Installed Properly",
      "No Large Gaps",
      "No Cracks",
      "Caulked",
      "Vented (as necessary)",
      "Nail/Screws Recessed & Caulked",
      "Ready to Paint",
      "Jobsite Cleanup Satisfactory",
      "OK to Pay",
    ]
  )
  assert.deepEqual(
    fascia.tasks.filter((task) => task.parentSourceItemId === "75714149").map((task) => task.title),
    [
      "All Soffits & Fascia Boards Installed Properly",
      'No Large Gaps (1/8" or greater)',
      "No cracks",
      "No Sagging",
      "Caulked",
      "Vented (as necessary)",
      "Nail/Screws Recessed and Caulked",
      "Jobsite Cleanup Satisfactory",
      "OK to Pay",
    ]
  )

  assert.equal(fascia.scheduleItems.length, 3)
  assert.deepEqual(
    fascia.scheduleItems.map((item) => ({
      sourceItemId: item.sourceItemId,
      title: item.title,
      startDate: item.startDate,
      workdays: item.workdays,
      phase: item.phase,
      displayColor: item.displayColor,
    })),
    [
      { sourceItemId: "143416707", title: "Install Fascia & Soffit", startDate: "2022-05-04", workdays: 2, phase: "Rough: Frame", displayColor: "#ABBE91" },
      { sourceItemId: "143417168", title: "HPS Fascia & Soffit QC Inspection", startDate: "2022-05-06", workdays: 1, phase: "Rough: Frame", displayColor: "#2222DD" },
      { sourceItemId: "143416713", title: "Paint Fascia & Soffit", startDate: "2022-05-06", workdays: 1, phase: "Exterior Finish", displayColor: "#6C3815" },
    ]
  )
  assert.deepEqual(
    fascia.scheduleItems.flatMap((item) => item.predecessors).map((dependency) => ({
      predecessorSourceItemId: dependency.predecessorSourceItemId,
      successorSourceItemId: dependency.successorSourceItemId,
      type: dependency.type,
      lagDays: dependency.lagDays,
    })),
    [
      { predecessorSourceItemId: "143416707", successorSourceItemId: "143417168", type: "FS", lagDays: 0 },
      { predecessorSourceItemId: "143416707", successorSourceItemId: "143416713", type: "FS", lagDays: 0 },
    ]
  )
})

test("preserves Floor System task hierarchy and reviewed schedule graph", async () => {
  const result = assembleBuildertrendTemplateNextBatchContent(await inputs())
  const floor = result.capture.templates.find(
    (template) => template.sourceTemplateId === "12649495"
  )
  assert.ok(floor)
  assert.equal(floor.tasks.length, 24)
  assert.equal(floor.tasks.filter((task) => task.parentSourceItemId === null).length, 9)
  assert.equal(floor.tasks.filter((task) => task.parentSourceItemId !== null).length, 15)
  assert.deepEqual(
    floor.tasks.filter((task) => task.parentSourceItemId === null).map((task) => task.sourceItemId),
    ["75707940", "75707941", "75707942", "75707943", "75707944", "75707945", "75707946", "75707947", "75707948"]
  )
  assert.deepEqual(
    floor.tasks.filter((task) => task.parentSourceItemId === "75707947").map((task) => task.title),
    ["Joist Spacing Correct", "Joists Level", "Installed Correctly w/ Hangers", "Jobsite Cleanup Satisfactory", "OK to Pay"]
  )
  assert.deepEqual(
    floor.scheduleItems.map((item) => item.sourceItemId),
    ["141677809", "141680084", "141679645", "141680773"]
  )
  assert.deepEqual(
    floor.scheduleItems.flatMap((item) => item.predecessors).map((dependency) => [
      dependency.predecessorSourceItemId,
      dependency.successorSourceItemId,
      dependency.type,
      dependency.lagDays,
    ]),
    [
      ["141679645", "141680084", "SS", 0],
      ["141677809", "141679645", "FS", 0],
      ["141680084", "141680773", "FS", 0],
    ]
  )
})

test("preserves Tiling checklist, selections, bid specification, and reviewed schedule graph", async () => {
  const result = assembleBuildertrendTemplateNextBatchContent(await inputs())
  const tiling = result.capture.templates.find(
    (template) => template.sourceTemplateId === "30914491"
  )
  assert.ok(tiling)
  assert.equal(tiling.tasks.length, 16)
  assert.deepEqual(
    tiling.tasks.filter((task) => task.parentSourceItemId === null).map((task) => ({
      sourceItemId: task.sourceItemId,
      title: task.title,
      sortOrder: task.sortOrder,
    })),
    [
      { sourceItemId: "75810249", title: "HPS (x area) Tile QC Inspection", sortOrder: 1 },
      { sourceItemId: "75810250", title: "Ceramic Tile Installation Complete", sortOrder: 2 },
      { sourceItemId: "75810251", title: "Verify Ceramic Tile Lead Times", sortOrder: 3 },
      { sourceItemId: "75810252", title: "Tile Received and Stored", sortOrder: 4 },
      { sourceItemId: "75810253", title: "Stage Tile for Installer", sortOrder: 5 },
    ]
  )
  assert.deepEqual(
    tiling.tasks.filter((task) => task.parentSourceItemId === "75810249").map((task) => task.title),
    [
      "Colors Match",
      "No Cracks",
      "No Broken Tiles",
      "No Scratches",
      "No Chips",
      "No Gouges",
      "No Nicks",
      "Grouted Properly",
      "No Cracks in Grout",
      "No Discoloration in Grout",
      "No Uncemented Tiles",
    ]
  )

  assert.deepEqual(
    tiling.selections.map((selection) => ({
      sourceSelectionId: selection.sourceSelectionId,
      title: selection.title,
      category: selection.category,
      location: selection.location,
      choiceCount: selection.choices.length,
    })),
    [
      { sourceSelectionId: "58772646", title: "Bath Surround Add Ons", category: "06 41 00 - Architectural Wood Casework", location: "Unassigned", choiceCount: 5 },
      { sourceSelectionId: "44740313", title: "Bath Surround Tile Patterns", category: "09 30 00 - Tiling", location: "Master Bath", choiceCount: 5 },
      { sourceSelectionId: "53868242", title: "Shower Pan Tile", category: "09 30 00 - Tiling", location: "Unassigned", choiceCount: 0 },
      { sourceSelectionId: "44740441", title: "Shower Surround Tile", category: "09 30 00 - Tiling", location: "Unassigned", choiceCount: 0 },
      { sourceSelectionId: "53868233", title: "Tile Backsplash at Countertop/Vanity (If Desired)", category: "09 30 00 - Tiling", location: "Unassigned", choiceCount: 0 },
    ]
  )
  assert.deepEqual(
    tiling.selections[0].choices.map((choice) => [choice.sourceChoiceId, choice.title]),
    [
      ["236393277", "Corner Bath/Shower Shelf"],
      ["236393275", "One Wall Niche (Shelf)"],
      ["236393273", "Safety/Grab Bar"],
      ["236393274", "Soap Dish"],
      ["236393276", "Two Bath Surround Wall Niches (Shelves)"],
    ]
  )
  assert.deepEqual(
    tiling.selections[1].choices.map((choice) => [choice.sourceChoiceId, choice.title]),
    [
      ["170341816", "Brick Layout With No Design Band"],
      ["170341814", "Diamond Layout With No Design Band"],
      ["170341815", "Diamond Layout With One Design Band"],
      ["170341812", "Straight Lay No Design Band"],
      ["170341813", "Straight Lay With One Design Band"],
    ]
  )
  assert.equal(tiling.selections.flatMap((selection) => selection.choices).every(
    (choice) => choice.status === "Unreleased" && choice.price === 0 && choice.attachmentCount === 1
  ), true)
  assert.equal(tiling.selections[0].choices[0].attachments[0].fileName, "Corner shower shelf.jpg")

  assert.equal(tiling.bidPackages.length, 1)
  assert.deepEqual(tiling.bidPackages[0], {
    sourceItemId: "9601783",
    sourceBidPackageId: "9601783",
    title: "Tile - 11913 Hillcrest Rd Final Cost Estimate",
    status: "Draft",
    allowMultipleApprovedBids: false,
    deadline: null,
    time: null,
    linkToSchedule: false,
    reminderLeadDays: 2,
    plansAndSpecs: false,
    pricingFormat: "Line Items",
    description: "",
    internalNotes: "",
    attachments: [
      { fileName: "StrucPlans_11913 Hillcrest Road_2024-02-09 stamped.pdf" },
      { fileName: "RAINEY_CDS_1-29-2024.pdf" },
    ],
    lineItems: [{
      title: "Shower Wrap Installation Labor & Misc Materials",
      costCode: "09 30 00 - Tiling",
      costType: "Labor, Subcontractor",
      quantity: 1,
      unit: null,
    }],
  })

  assert.deepEqual(
    tiling.scheduleItems.map((item) => ({
      sourceItemId: item.sourceItemId,
      title: item.title,
      startDate: item.startDate,
      workdays: item.workdays,
      phase: item.phase,
      displayColor: item.displayColor,
    })),
    [
      { sourceItemId: "180219816", title: "Tile Delivery", startDate: "2023-08-22", workdays: 1, phase: "UNASSIGNED", displayColor: "#DDC817" },
      { sourceItemId: "180219733", title: "Tile", startDate: "2023-08-23", workdays: 5, phase: "UNASSIGNED", displayColor: "#008000" },
      { sourceItemId: "180219926", title: "HPS Tile QC Inspection", startDate: "2023-08-30", workdays: 1, phase: "UNASSIGNED", displayColor: "#2222DD" },
    ]
  )
  assert.deepEqual(
    tiling.scheduleItems.flatMap((item) => item.predecessors).map((dependency) => ({
      predecessorSourceItemId: dependency.predecessorSourceItemId,
      successorSourceItemId: dependency.successorSourceItemId,
      type: dependency.type,
      lagDays: dependency.lagDays,
    })),
    [
      { predecessorSourceItemId: "180219733", successorSourceItemId: "180219816", type: "SS", lagDays: -1 },
      { predecessorSourceItemId: "180219733", successorSourceItemId: "180219926", type: "FS", lagDays: 0 },
    ]
  )
  const tilingExceptions = result.capture.conversionExceptions.filter(
    (exception) => exception.templateSourceTemplateId === "30914491"
  )
  assert.deepEqual(tilingExceptions.map((exception) => exception.field), [
    "choices.description",
    "choices.attachments.fileName",
  ])
  assert.equal(tilingExceptions.every((exception) => /do not/.test(exception.recoveryPlan)), true)
})

test("preserves exact Piers task identities, hierarchy, schedule, and dependencies", async () => {
  const result = assembleBuildertrendTemplateNextBatchContent(await inputs())
  const piers = result.capture.templates.find(
    (template) => template.sourceTemplateId === "12858966"
  )
  assert.ok(piers)
  assert.deepEqual(
    piers.tasks.map((task) => ({
      sourceItemId: task.sourceItemId,
      parentSourceItemId: task.parentSourceItemId,
      title: task.title,
      sortOrder: task.sortOrder,
    })),
    [
      { sourceItemId: "75715160", parentSourceItemId: null, title: "Dig (X LOCATION) Pier", sortOrder: 1 },
      { sourceItemId: "75715161", parentSourceItemId: null, title: "Set (X LOCATION) Piers Sonotube", sortOrder: 2 },
      { sourceItemId: "75715162", parentSourceItemId: null, title: "Place (X LOCATION) Pier Vertical Reinforcing", sortOrder: 3 },
      { sourceItemId: "75715163", parentSourceItemId: null, title: "Place (X LOCATION) Pier Reinforcing Ties", sortOrder: 4 },
      { sourceItemId: "75715164", parentSourceItemId: null, title: "Pass Building Department Footing: Piers Inspection", sortOrder: 5 },
      { sourceItemId: "75715165", parentSourceItemId: null, title: "Pour Piers", sortOrder: 6 },
      { sourceItemId: "75715166", parentSourceItemId: null, title: "Order Piers Estimated Concrete", sortOrder: 7 },
      { sourceItemId: "75715167", parentSourceItemId: null, title: "Update Concrete Order with Field Takeoffs", sortOrder: 8 },
      { sourceItemId: "75715168", parentSourceItemId: null, title: "Pull Piers Concrete Takeoffs", sortOrder: 9 },
      { sourceItemId: "75715169", parentSourceItemId: null, title: "HPS Piers QC & Pre-Pour Inspection", sortOrder: 10 },
      { sourceItemId: "75715323", parentSourceItemId: "75715169", title: "All Piers Level", sortOrder: 1 },
      { sourceItemId: "75715324", parentSourceItemId: "75715169", title: "Rebar Correct In All Piers", sortOrder: 2 },
      { sourceItemId: "75715325", parentSourceItemId: "75715169", title: "Embeds Ready", sortOrder: 3 },
      { sourceItemId: "75715326", parentSourceItemId: "75715169", title: "Permit/plans on site", sortOrder: 4 },
      { sourceItemId: "75715170", parentSourceItemId: null, title: "Request Piers Engineer/BD Inspection", sortOrder: 11 },
      { sourceItemId: "75715171", parentSourceItemId: null, title: "Schedule Concrete Pump", sortOrder: 12 },
    ]
  )
  assert.deepEqual(
    piers.scheduleItems.map((item) => ({
      sourceItemId: item.sourceItemId,
      title: item.title,
      startDate: item.startDate,
      workdays: item.workdays,
      phase: item.phase,
      displayColor: item.displayColor,
    })),
    [
      { sourceItemId: "143851212", title: "Dig Piers", startDate: "2022-05-10", workdays: 1, phase: "Structure-Shell: Footings", displayColor: "#442121" },
      { sourceItemId: "143852801", title: "Form Piers", startDate: "2022-05-11", workdays: 2, phase: "Structure-Shell: Footings", displayColor: "#676767" },
      { sourceItemId: "143853023", title: "Building Department Footing Inspection: Piers", startDate: "2022-05-13", workdays: 1, phase: "Structure-Shell: Footings", displayColor: "#ED2591" },
      { sourceItemId: "143853005", title: "HPS Piers QC Inspection", startDate: "2022-05-13", workdays: 1, phase: "Structure-Shell: Footings", displayColor: "#2222DD" },
      { sourceItemId: "143853032", title: "Pour Concrete Piers", startDate: "2022-05-16", workdays: 1, phase: "Structure-Shell: Footings", displayColor: "#DD2222" },
    ]
  )
  assert.deepEqual(
    piers.scheduleItems.flatMap((item) => item.predecessors).map((dependency) => ({
      predecessorSourceItemId: dependency.predecessorSourceItemId,
      successorSourceItemId: dependency.successorSourceItemId,
      type: dependency.type,
      lagDays: dependency.lagDays,
    })),
    [
      { predecessorSourceItemId: "143851212", successorSourceItemId: "143852801", type: "FS", lagDays: 0 },
      { predecessorSourceItemId: "143852801", successorSourceItemId: "143853023", type: "FS", lagDays: 0 },
      { predecessorSourceItemId: "143852801", successorSourceItemId: "143853005", type: "FS", lagDays: 0 },
      { predecessorSourceItemId: "143853023", successorSourceItemId: "143853032", type: "FS", lagDays: 0 },
    ]
  )
})

test("preserves Exterior Wall task hierarchy and reviewed schedule graph", async () => {
  const result = assembleBuildertrendTemplateNextBatchContent(await inputs())
  const exteriorWall = result.capture.templates.find(
    (template) => template.sourceTemplateId === "12649292"
  )
  assert.ok(exteriorWall)
  assert.equal(exteriorWall.tasks.length, 16)
  assert.deepEqual(
    exteriorWall.tasks.filter((task) => task.parentSourceItemId === null).map((task) => ({
      sourceItemId: task.sourceItemId,
      title: task.title,
      sortOrder: task.sortOrder,
    })),
    [
      { sourceItemId: "75707377", title: "Layout X Level Exterior Wood Framed Walls", sortOrder: 1 },
      { sourceItemId: "75707378", title: "Build X Room Exterior Framed Walls", sortOrder: 2 },
      { sourceItemId: "75707379", title: "Set X Room Exterior Framed Walls", sortOrder: 3 },
      { sourceItemId: "75707380", title: "HPS (X Room) Exterior Wall Framed Wall", sortOrder: 4 },
    ]
  )
  assert.deepEqual(
    exteriorWall.tasks.filter((task) => task.parentSourceItemId === "75707379").map((task) => ({
      sourceItemId: task.sourceItemId,
      title: task.title,
      sortOrder: task.sortOrder,
    })),
    [
      { sourceItemId: "75707542", title: "Glue", sortOrder: 1 },
      { sourceItemId: "75707553", title: "DO NOT GLUE AT DOOR OPENINGS", sortOrder: 2 },
      { sourceItemId: "75707555", title: "Set Exterior Walls", sortOrder: 3 },
    ]
  )
  assert.deepEqual(
    exteriorWall.tasks.filter((task) => task.parentSourceItemId === "75707380").map((task) => task.title),
    [
      "Structural Headers Correct",
      "Flitch Plate Correct",
      "Jacks or Liners Correct",
      "Exterior Sheathing Correct",
      "Walls Plumb",
      "Stud Spacing Correct",
      "Plates Correct",
      "Jobsite Cleanup Satisfactory",
      "OK to Pay",
    ]
  )
  assert.deepEqual(
    exteriorWall.scheduleItems.map((item) => ({
      sourceItemId: item.sourceItemId,
      title: item.title,
      startDate: item.startDate,
      workdays: item.workdays,
      phase: item.phase,
      displayColor: item.displayColor,
    })),
    [
      { sourceItemId: "141675409", title: "X Level Exterior Framed Walls", startDate: "2022-04-13", workdays: 5, phase: "UNASSIGNED", displayColor: "#ABBE91" },
      { sourceItemId: "141676547", title: "HPS X Room Exterior Framed Wall QC Inspection", startDate: "2022-04-20", workdays: 1, phase: "UNASSIGNED", displayColor: "#2222DD" },
    ]
  )
  assert.deepEqual(
    exteriorWall.scheduleItems.flatMap((item) => item.predecessors).map((dependency) => ({
      predecessorSourceItemId: dependency.predecessorSourceItemId,
      successorSourceItemId: dependency.successorSourceItemId,
      type: dependency.type,
      lagDays: dependency.lagDays,
    })),
    [
      { predecessorSourceItemId: "141675409", successorSourceItemId: "141676547", type: "FS", lagDays: 0 },
    ]
  )
})

test("preserves Post-Frost earthwork checklists, fill-material bid specifications, and schedule graph", async () => {
  const result = assembleBuildertrendTemplateNextBatchContent(await inputs())
  const postFrost = result.capture.templates.find(
    (template) => template.sourceTemplateId === "12650557"
  )
  assert.ok(postFrost)
  assert.equal(postFrost.tasks.length, 12)
  assert.deepEqual(
    postFrost.tasks.filter((task) => task.parentSourceItemId === null).map((task) => ({
      sourceItemId: task.sourceItemId,
      title: task.title,
      sortOrder: task.sortOrder,
    })),
    [
      { sourceItemId: "75710600", title: "Frost Walls Backfilled & Compacted", sortOrder: 1 },
      { sourceItemId: "75710602", title: "Mark Exterior Slab Elevations", sortOrder: 2 },
      { sourceItemId: "75710603", title: "Snap Lines for Exterior Slab Elevations", sortOrder: 3 },
      { sourceItemId: "75710605", title: "Grade To Elevations", sortOrder: 4 },
      { sourceItemId: "75710607", title: "Mark Interior Sub-Slab Grade Elevations", sortOrder: 5 },
      { sourceItemId: "75710609", title: "Snap Lines for Interior Sub-Slab Grade", sortOrder: 6 },
      { sourceItemId: "75710611", title: "Grade to Elevation", sortOrder: 7 },
      { sourceItemId: "75710613", title: "Trench for Water-Line Tie-In Complete", sortOrder: 8 },
      { sourceItemId: "75710615", title: "Trench for Sewer Line Tie-In Complete", sortOrder: 9 },
      { sourceItemId: "75710617", title: "Trench Gas Line Tie-in Complete", sortOrder: 10 },
    ]
  )
  assert.deepEqual(
    postFrost.tasks.filter((task) => task.parentSourceItemId !== null).map((task) => ({
      sourceItemId: task.sourceItemId,
      parentSourceItemId: task.parentSourceItemId,
      title: task.title,
      sortOrder: task.sortOrder,
    })),
    [
      { sourceItemId: "75710710", parentSourceItemId: "75710605", title: "Grade is Level to 1/8\" Tolerance", sortOrder: 1 },
      { sourceItemId: "75710711", parentSourceItemId: "75710611", title: "Grade Level Through-out to 1/8\" tolerance", sortOrder: 1 },
    ]
  )

  assert.equal(postFrost.bidPackages.length, 1)
  const bid = postFrost.bidPackages[0]
  assert.equal(bid.sourceBidPackageId, "10290501")
  assert.equal(bid.title, "Fill Material - (Project Address) (Estimate Phase)")
  assert.equal(bid.status, "Draft")
  assert.equal(bid.allowMultipleApprovedBids, false)
  assert.equal(bid.linkToSchedule, false)
  assert.equal(bid.pricingFormat, "Line Items")
  assert.deepEqual(bid.attachments, [])
  assert.match(bid.description, /Contract and Insurance Requirements/)
  assert.equal(
    bid.internalNotes,
    "Please input the # of Tons necessary and allow delivery contractors to fill in delivery qty. For Teller county area check from Houchin, Van Egmond, and Mule Creek. For El Paso county check with Pioneer sand & gravel."
  )
  assert.deepEqual(
    bid.lineItems.map((item) => ({
      sourceLineItemId: item.sourceLineItemId,
      title: item.title,
      costCode: item.costCode,
      costType: item.costType,
      quantity: item.quantity,
      unit: item.unit,
      description: item.description,
    })),
    [
      { sourceLineItemId: "17744559", title: "Structural Fill Material", costCode: "31 23 23.13 - Backfill", costType: "Material", quantity: 1, unit: "Tons", description: "Please Include compactable, structural fill material." },
      { sourceLineItemId: "17744577", title: "Structural Fill Delivery", costCode: "31 23 23.13 - Backfill", costType: "Subcontractor", quantity: 0, unit: "Loads", description: "" },
      { sourceLineItemId: "17744578", title: "Site Fill", costCode: "31 23 23.13 - Backfill", costType: "Material", quantity: 1, unit: "Tons", description: "Please include non-structural site fill material." },
      { sourceLineItemId: "17744579", title: "Site Fill Delivery", costCode: "31 23 23.13 - Backfill", costType: "Subcontractor", quantity: 0, unit: "Loads", description: "" },
    ]
  )

  assert.deepEqual(
    postFrost.scheduleItems.map((item) => ({
      sourceItemId: item.sourceItemId,
      title: item.title,
      startDate: item.startDate,
      workdays: item.workdays,
      phase: item.phase,
      displayColor: item.displayColor,
    })),
    [
      { sourceItemId: "141693118", title: "Backfill & Compact Frost Walls", startDate: "2022-04-13", workdays: 1, phase: "Structure-Shell: FDN", displayColor: "#442121" },
      { sourceItemId: "141693661", title: "Grade for Exterior Entry Slabs", startDate: "2022-04-14", workdays: 1, phase: "Base Infrastructure", displayColor: "#442121" },
      { sourceItemId: "141693829", title: "Rough Grade Interior Sub-Slab", startDate: "2022-04-14", workdays: 1, phase: "Base Infrastructure", displayColor: "#442121" },
      { sourceItemId: "141693850", title: "Trench for Water/Sewer/Gas Tie-In", startDate: "2022-04-14", workdays: 1, phase: "Base Infrastructure", displayColor: "#442121" },
    ]
  )
  assert.deepEqual(
    postFrost.scheduleItems.flatMap((item) => item.predecessors).map((dependency) => ({
      predecessorSourceItemId: dependency.predecessorSourceItemId,
      successorSourceItemId: dependency.successorSourceItemId,
      type: dependency.type,
      lagDays: dependency.lagDays,
    })),
    [
      { predecessorSourceItemId: "141693118", successorSourceItemId: "141693661", type: "FS", lagDays: 0 },
      { predecessorSourceItemId: "141693118", successorSourceItemId: "141693829", type: "FS", lagDays: 0 },
      { predecessorSourceItemId: "141693118", successorSourceItemId: "141693850", type: "FS", lagDays: 0 },
    ]
  )
})

test("fails stale when a newly complete template is not in the reviewed release", async () => {
  const stale = await inputs()
  stale.documents.push({
    source: "26-12650713.capture.json",
    document: {
      sourceTemplateId: "12650713",
      sourceName: "Framing - Stair Installation",
      tasks: Array.from({ length: 10 }, (_, index) => ({
        sourceItemId: `stair-task-${index + 1}`,
        parentSourceItemId: null,
        title: `Stair task ${index + 1}`,
      })),
    },
  })
  assert.throws(
    () => assembleBuildertrendTemplateNextBatchContent(stale),
    /scope is stale for the currently reviewed fragments/
  )

  const reviewed = structuredClone(stale)
  const stair = reviewed.nextBatchManifest.templates.find(
    (template) => template.sourceTemplateId === "12650713"
  )
  assert.ok(stair)
  reviewed.release.scope.structurallyCompleteTemplatesIncluded = 14
  reviewed.release.scope.incompleteTemplatesExcluded = 20
  reviewed.release.templates.push({
    sourceTemplateId: stair.sourceTemplateId,
    sourceName: stair.sourceName,
    workplanSequence: stair.workplanSequence,
    moduleCounts: stair.moduleCounts,
    fragmentPath: stair.fragmentPath,
    browserCaptureGates: "complete",
  })

  const result = assembleBuildertrendTemplateNextBatchContent(reviewed)
  assert.deepEqual(
    result.capture.assembly.sourceTemplateIds,
    ["12859981", "12978371", "12581937", "12594475", "30917204", "12646335", "12650792", "12819873", "12649495", "30914491", "12858966", "12649292", "12650557", "12650713"]
  )
  assert.equal(result.capture.assembly.excludedIncompleteTemplateCount, 20)
  const releasedStair = result.capture.templates.find(
    (template) => template.sourceTemplateId === "12650713"
  )
  assert.ok(releasedStair)
  assert.equal(releasedStair.tasks.length, 10)
  assert.equal(releasedStair.scheduleItems.length, 3)
})

test("rejects partial capture, duplicate release scope, and publication requests", async () => {
  const partial = await inputs()
  partial.documents[0].document.tasks = partial.documents[0].document.tasks.slice(1)
  assert.throws(
    () => assembleBuildertrendTemplateNextBatchContent(partial),
    /tasks expected 48, found 47/
  )

  const concrete = await inputs()
  concrete.release.templates.push({
    sourceTemplateId: "12581937",
    sourceName: "Concrete - Footer Assembly",
    fragmentPath: "scripts/fixtures/buildertrend-template-content-next-batch/fragments/08-12581937.capture.json",
    browserCaptureGates: "complete",
  })
  assert.throws(
    () => assembleBuildertrendTemplateNextBatchContent(concrete),
    /duplicates a sourceTemplateId/
  )

  const publish = await inputs()
  publish.publishRequested = true
  assert.throws(
    () => assembleBuildertrendTemplateNextBatchContent(publish),
    /publication requests are prohibited/
  )
})

test("builds SQL that remains draft-only and includes every released template", async () => {
  const directory = await mkdtemp(join(tmpdir(), "compass-next-batch-content-"))
  const capture = join(directory, "capture.json")
  const inventory = join(directory, "inventory.json")
  const output = join(directory, "import.sql")
  try {
    await execFileAsync("bun", [
      "scripts/assemble-buildertrend-template-next-batch-content.mjs",
      "--capture-output", capture,
      "--inventory-output", inventory,
    ])
    const result = await execFileAsync("bun", [
      "scripts/build-buildertrend-template-next-batch-content-sql.mjs",
      "--capture", capture,
      "--inventory", inventory,
      "--output", output,
    ])
    assert.deepEqual(JSON.parse(result.stdout), {
      templateCount: 13,
      tasks: 372,
      scheduleItems: 61,
      selections: 13,
      bidPackages: 8,
      excludedArchivedCount: 27,
      draftOnly: true,
      output,
    })
    const sql = await readFile(output, "utf8")
    assert.match(sql, /bt-template-version:12859981:1/)
    assert.match(sql, /bt-template-version:12978371:1/)
    assert.match(sql, /bt-template-version:12581937:1/)
    assert.match(sql, /bt-template-version:12594475:1/)
    assert.match(sql, /bt-template-version:30917204:1/)
    assert.match(sql, /bt-template-version:12646335:1/)
    assert.match(sql, /bt-template-version:12650792:1/)
    assert.match(sql, /bt-template-version:12819873:1/)
    assert.match(sql, /bt-template-version:12649495:1/)
    assert.match(sql, /bt-template-version:30914491:1/)
    assert.match(sql, /bt-template-version:12858966:1/)
    assert.match(sql, /bt-template-version:12649292:1/)
    assert.match(sql, /bt-template-version:12650557:1/)
    assert.match(sql, /INSERT INTO schedule_template_items/)
    assert.match(sql, /review_status='content_captured', lifecycle_status='draft'/)
    assert.doesNotMatch(sql, /status='published'|lifecycle_status='active'|review_status='verified'/)

    const invalidRelease = join(directory, "invalid-release.json")
    const release = JSON.parse(await readFile(paths.release, "utf8"))
    release.scope.archivedTemplatesIncluded = 1
    await writeFile(invalidRelease, JSON.stringify(release))
    await assert.rejects(
      () => execFileAsync("bun", [
        "scripts/build-buildertrend-template-next-batch-content-sql.mjs",
        "--capture", capture,
        "--inventory", inventory,
        "--release", invalidRelease,
        "--dry-run",
      ]),
      /invalid reviewed scope/
    )
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

test("SQL command rejects publish flags before generating output", async () => {
  await assert.rejects(
    () => execFileAsync("bun", [
      "scripts/build-buildertrend-template-next-batch-content-sql.mjs",
      "--publish-captured-schedules",
    ]),
    /publication requests are prohibited/
  )
})
