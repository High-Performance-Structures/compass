import { describe, expect, it } from "vitest"
import { DEPARTMENT_WORKFLOWS } from "@/lib/job-workflows/departments"
import { JOB_EMAIL_MERGE_FIELDS, JOB_EMAIL_TEMPLATES, jobTemplatesFor, renderJobEmail, type JobEmailContext } from "@/lib/job-workflows/email-templates"
import { jobEmailSettingsSchema } from "@/lib/feature-settings/registry"
import { DEPARTMENT_CODES } from "@/lib/department-profiles"

const CONTEXT: JobEmailContext = {
  clientFirstName: "Pat",
  clientName: "Pat Lee",
  projectNumber: "H-1-1",
  projectName: "Ridge Road",
  jobAddress: "1 Ridge Rd",
  senderName: "Sam",
  senderEmail: "sam@example.com",
  companyName: "Example Builders",
  legalName: "Example Builders Inc.",
  companyEmail: "office@example.com",
  officePhone: "555-0100",
  officeHours: "",
  website: "",
  mailingAddress: "PO Box 1",
}

describe("job email templates", () => {
  it("only use known merge fields and steps that exist in the department's workflow", () => {
    const known = new Set<string>(JOB_EMAIL_MERGE_FIELDS.map((field) => field.name))
    for (const code of DEPARTMENT_CODES) {
      const steps = new Set(DEPARTMENT_WORKFLOWS[code]?.steps.map((step) => step.id) ?? [])
      const templates = JOB_EMAIL_TEMPLATES[code] ?? []
      const ids = templates.map((template) => template.id)
      expect(new Set(ids).size).toBe(ids.length)
      for (const template of templates) {
        for (const match of `${template.subject}\n${template.body}`.matchAll(/\{\{\s*([a-zA-Z]+)\s*\}\}/g)) {
          expect(known.has(match[1] ?? ""), `${code}.${template.id} uses {{${match[1]}}}`).toBe(true)
        }
        for (const step of template.steps) expect(steps.has(step), `${code}.${template.id} step ${step}`).toBe(true)
        expect(jobEmailSettingsSchema.safeParse({ templates: { [`${code}.${template.id}`]: { subject: "s", body: "b" } } }).success).toBe(true)
      }
    }
  })

  it("fills merge fields and reports the empty ones", () => {
    const rendered = renderJobEmail({ subject: "Estimate for {{projectName}} ({{projectNumber}})", body: "Hi {{clientFirstName}}\n{{officeHours}}\n\n\nThanks" }, CONTEXT)
    expect(rendered.subject).toBe("Estimate for Ridge Road (H-1-1)")
    expect(rendered.body).toBe("Hi Pat\n\nThanks")
    expect(rendered.missing).toEqual(["Office hours (department profile)"])
    expect(renderJobEmail({ subject: "s", body: "Hello {{website}}," }, CONTEXT).body).toBe("Hello,")
  })

  it("offers the current step's emails first", () => {
    const { suggested, other } = jobTemplatesFor("H", "agreement")
    expect(suggested.map((template) => template.id)).toEqual(["agreement", "insurance_w9"])
    expect(other.some((template) => template.id === "estimate")).toBe(true)
    expect(jobTemplatesFor("N", "intake").suggested).toEqual([])
  })
})
