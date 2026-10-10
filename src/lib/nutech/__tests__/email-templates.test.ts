import { describe, expect, it } from "vitest"
import { FEATURE_SETTINGS } from "@/lib/feature-settings/registry"
import {
  NUTECH_EMAIL_MERGE_FIELDS,
  NUTECH_EMAIL_TEMPLATES,
  nuTechTemplatesFor,
  nuTechTemplateText,
  renderNuTechEmail,
  type NuTechEmailContext,
} from "@/lib/nutech/email-templates"

const context: NuTechEmailContext = {
  customerFirstName: "Erron",
  customerName: "Erron Stevenson",
  customerLastName: "Stevenson",
  projectNumber: "N-850-508",
  jobAddress: "12 Main St, Fairplay, CO",
  poNumber: "1767",
  epsNumber: "81532-EPS",
  requestedDate: "Monday, April 7, 2025",
  trailerDimensions: `8'6" wide × 26' long`,
  quantitySummary: "265.3 linear feet, 6 corners, 4 T's at 2' 8\"",
  pricingLabel: "standard pricing",
  senderName: "Rebekah",
  officePhone: "719-900-8850",
  officeHours: "8:00 am – 4:00 pm",
  dealerAccountNumber: "701888",
  warehouseName: "Sonoco",
  warehouseAddress: "1100 Garden of the Gods Rd, Colorado Springs, CO 80907",
  warehousePhone: "719-598-0602 ext. 0",
  warehouseEmail: "shipping@example.com",
  warehouseDockHours: "8 am – 3 pm",
}

const template = (id: string) => {
  const found = NUTECH_EMAIL_TEMPLATES.find((entry) => entry.id === id)
  if (!found) throw new Error(id)
  return found
}

describe("Nu-Tech email templates", () => {
  it("uses only known merge fields", () => {
    const known = new Set<string>([...NUTECH_EMAIL_MERGE_FIELDS.map((field) => field.name), "fulfillmentDetail", "trailerLine"])
    for (const entry of NUTECH_EMAIL_TEMPLATES) {
      for (const match of `${entry.subject}\n${entry.body}`.matchAll(/\{\{\s*([a-zA-Z]+)\s*\}\}/g)) {
        expect(known.has(match[1] ?? "")).toBe(true)
      }
    }
  })

  it("fills the order email for a customer pickup", () => {
    const rendered = renderNuTechEmail(template("order_placement"), context, "pickup")
    expect(rendered.subject).toBe("New order PO 1767 - Stevenson")
    expect(rendered.body).toContain("Dealer account #701888")
    expect(rendered.body).toContain("customer pickup from the Sonoco")
    expect(rendered.body).toContain(`Trailer: 8'6" wide × 26' long (picture attached)`)
    expect(rendered.missing).toEqual([])
  })

  it("lists blank fields instead of leaving placeholders", () => {
    const rendered = renderNuTechEmail(template("pickup_instructions"), { ...context, epsNumber: "", warehouseEmail: "" }, "pickup")
    expect(rendered.body).not.toContain("{{")
    expect(rendered.missing).toEqual(["Manufacturer confirmation (EPS) number", "Warehouse email"])
  })

  it("prefers the company's wording over the built-in text", () => {
    const settings = {
      ...FEATURE_SETTINGS["nutech-emails"].defaults,
      templates: { invoice: { subject: "Your invoice {{projectNumber}}", body: "Hi {{customerFirstName}}" } },
    }
    const rendered = renderNuTechEmail(nuTechTemplateText(template("invoice"), settings), context, null)
    expect(rendered).toEqual({ subject: "Your invoice N-850-508", body: "Hi Erron", missing: [] })
  })

  it("suggests this step's emails for the job's fulfillment", () => {
    const pickup = nuTechTemplatesFor("estimate", "pickup")
    expect(pickup.suggested.map((entry) => entry.id)).toEqual(["estimate_pickup"])
    expect(pickup.other.map((entry) => entry.id)).not.toContain("estimate_delivery")
    const confirmed = nuTechTemplatesFor("confirmed", "delivery")
    expect(confirmed.suggested.map((entry) => entry.id)).toEqual(["delivery_instructions", "delivery_coordination"])
  })
})
