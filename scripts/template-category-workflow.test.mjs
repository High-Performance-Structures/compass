import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import test from "node:test"

const actionsPath = "src/app/actions/project-templates.ts"
const inventoryImportPath = "src/lib/templates/buildertrend-template-inventory.ts"
const captureImportPath = "src/lib/templates/buildertrend-template-capture.ts"
const estimateCreatePath = "src/components/templates/estimate-template-create-dialog.tsx"
const estimateEditorPath = "src/components/templates/estimate-template-editor.tsx"
const estimateActionsPath = "src/app/actions/estimate-templates.ts"
const templateLibraryPath = "src/components/templates/template-library-view.tsx"

test("template library exposes category-only controls, filtering, and badges", async () => {
  const source = await readFile(templateLibraryPath, "utf8")

  assert.match(source, /CategoryControl/)
  assert.match(source, /Filter templates by category/)
  assert.match(source, /template\.tradeCategory \?\? "Other"/)
  assert.doesNotMatch(source, /departmentCode/)
  assert.doesNotMatch(source, /departmentFilter/)
  assert.doesNotMatch(source, /TEMPLATE_DEPARTMENTS/)
  assert.doesNotMatch(source, /Department for /)
})

test("category action only updates tradeCategory", async () => {
  const source = await readFile(actionsPath, "utf8")
  const action = source.match(
    /export async function updateProjectTemplateCategory[\s\S]*?\n}\n\nexport async function deleteProjectTemplate/
  )?.[0]

  assert.ok(action, "category update action must exist")
  assert.match(action, /tradeCategory: category/)
  assert.doesNotMatch(action, /departmentCode/)
  assert.doesNotMatch(action, /department:/)
})

test("new Buildertrend imports leave department selection to the destination project", async () => {
  const [inventorySource, captureSource] = await Promise.all(
    [inventoryImportPath, captureImportPath].map((path) => readFile(path, "utf8"))
  )

  assert.match(inventorySource, /Department\/branding is selected by the destination project/)
  assert.match(inventorySource, /sql\(null\),\n\s*sql\(template\.tradeCategory\)/)
  assert.doesNotMatch(captureSource, /departmentCode \?\? "ORC"/)
  assert.doesNotMatch(captureSource, /departmentCode === "D"/)
})

test("estimate templates inherit department from the destination project", async () => {
  const sources = await Promise.all(
    [estimateCreatePath, estimateEditorPath, estimateActionsPath].map((path) =>
      readFile(path, "utf8")
    )
  )
  for (const source of sources) {
    assert.doesNotMatch(source, /departmentCode/)
    assert.doesNotMatch(source, /templateDepartment/)
    assert.doesNotMatch(source, /template-department/)
  }
})

test("captured templates require an explicit count-verified publish action", async () => {
  const [actions, library] = await Promise.all([
    readFile(actionsPath, "utf8"),
    readFile(templateLibraryPath, "utf8"),
  ])

  assert.match(actions, /publishCapturedProjectTemplate/)
  assert.match(actions, /requiredModuleTypes/)
  assert.match(actions, /normalizationStatus/)
  assert.match(actions, /sourceItemCount/)
  assert.match(actions, /scheduleItems\.length !== scheduleModule\.sourceItemCount/)
  assert.match(actions, /review_status='verified'/)
  assert.match(library, /Review and publish/)
  assert.match(library, /documented conversion warnings/)
})
