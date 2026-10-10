import type { NuTechEmailSettings } from "@/lib/feature-settings/registry"
import type { NuTechStepId } from "@/lib/nutech/order-steps"

/** Who a template goes to; decides the default recipients. */
export type NuTechEmailAudience = "customer" | "manufacturer" | "warehouse" | "carrier"

export type NuTechEmailTemplateId =
  | "price_sheets"
  | "estimate_pickup"
  | "estimate_delivery"
  | "invoice"
  | "order_placement"
  | "pickup_instructions"
  | "delivery_instructions"
  | "dock_time_request"
  | "missed_pickup"
  | "delivery_coordination"

export type NuTechEmailTemplate = {
  readonly id: NuTechEmailTemplateId
  readonly label: string
  readonly audience: NuTechEmailAudience
  /** Order steps where this email is offered first. */
  readonly steps: readonly NuTechStepId[]
  /** Only offered for this fulfillment, when set. */
  readonly fulfillment: "delivery" | "pickup" | null
  readonly subject: string
  readonly body: string
}

/** Merge fields a template can use, as {{name}}. */
export const NUTECH_EMAIL_MERGE_FIELDS = [
  { name: "customerFirstName", label: "Customer first name" },
  { name: "customerName", label: "Customer full name" },
  { name: "customerLastName", label: "Customer last name" },
  { name: "projectNumber", label: "Job number" },
  { name: "jobAddress", label: "Job / delivery address" },
  { name: "poNumber", label: "Purchase order number" },
  { name: "epsNumber", label: "Manufacturer confirmation (EPS) number" },
  { name: "requestedDate", label: "Requested delivery or pickup date" },
  { name: "trailerDimensions", label: "Trailer dimensions" },
  { name: "quantitySummary", label: "Block quantities and takeoff notes" },
  { name: "pricingLabel", label: "Pricing (standard or cash-discount)" },
  { name: "senderName", label: "Your name" },
  { name: "officePhone", label: "Office phone" },
  { name: "officeHours", label: "Office hours" },
  { name: "dealerAccountNumber", label: "Dealer account number" },
  { name: "warehouseName", label: "Warehouse name" },
  { name: "warehouseAddress", label: "Warehouse address" },
  { name: "warehousePhone", label: "Warehouse phone" },
  { name: "warehouseEmail", label: "Warehouse email" },
  { name: "warehouseDockHours", label: "Warehouse dock hours" },
] as const

export type NuTechEmailMergeField = (typeof NUTECH_EMAIL_MERGE_FIELDS)[number]["name"]
export type NuTechEmailContext = Readonly<Record<NuTechEmailMergeField, string>>

/**
 * Built-in wording, adapted from the Nu-Tech Estimate/Order Cheat Sheet.
 * Companies replace any of it in Settings → Workflows → Nu-Tech emails.
 */
export const NUTECH_EMAIL_TEMPLATES: readonly NuTechEmailTemplate[] = [
  {
    id: "price_sheets",
    label: "Price sheets",
    audience: "customer",
    steps: ["intake"],
    fulfillment: null,
    subject: "Fox Blocks price sheets",
    body: `Good afternoon, {{customerFirstName}},

Thank you for reaching out to us at Nu-Tech Systems! It was a pleasure speaking with you.

I have attached our price sheets for Fox Blocks ICFs: our standard pricing, and our cash-discounted pricing for orders paid with cash, check, or online check/ACH transfer.

If needed, we provide takeoff services for the Fox Blocks. Feel free to send over the project plans, and we can put together a takeoff and estimate. Another option is the Fox Blocks estimator at https://estimator.foxblocks.com/. If you would like to pull the takeoff yourself, email us your quantities and we will put together an estimate.

If you have any questions, reply to this email or call us at {{officePhone}} ({{officeHours}}). We look forward to working with you!

{{senderName}}`,
  },
  {
    id: "estimate_pickup",
    label: "Estimate (customer pickup)",
    audience: "customer",
    steps: ["estimate", "payment"],
    fulfillment: "pickup",
    subject: "Fox Blocks estimate {{projectNumber}}",
    body: `Good afternoon, {{customerFirstName}},

I'm pleased to share that the Fox Blocks estimate is complete and attached for your review. It reflects our {{pricingLabel}}, along with our takeoff acknowledgement.

{{quantitySummary}}

Since Fox Blocks are sold by the bundle, each item is rounded up to the nearest bundle. For customer pickups, Fox Blocks only requires the trailer dimensions and a picture of the trailer. If you notice any discrepancies, would like additional blocks or clips, or would like cash-discounted pricing applied, let me know and I will adjust the estimate.

Next steps: if everything looks good, reply with the signed takeoff acknowledgement and I will send the invoice. Once payment is received, send the trailer dimensions and picture and your requested pickup date, and I will place the order right away.

Thank you!
{{senderName}}`,
  },
  {
    id: "estimate_delivery",
    label: "Estimate (delivery)",
    audience: "customer",
    steps: ["estimate", "payment"],
    fulfillment: "delivery",
    subject: "Fox Blocks estimate {{projectNumber}}",
    body: `Hello, {{customerFirstName}},

The estimate for the Fox Block material is attached for your review, reflecting our {{pricingLabel}}, along with the takeoff acknowledgement.

{{quantitySummary}}

If you notice any discrepancies in heights or locations, would like additional blocks or clips, or would like cash-discounted pricing applied, let me know and I will adjust the estimate.

Next steps: if everything looks good, reply with the signed takeoff acknowledgement and I will send the invoice. Once payment is received, send your desired delivery date and I will place the order.

Thank you!
{{senderName}}`,
  },
  {
    id: "invoice",
    label: "Invoice and payment",
    audience: "customer",
    steps: ["payment"],
    fulfillment: null,
    subject: "Invoice for your Fox Blocks order {{projectNumber}}",
    body: `Good afternoon, {{customerFirstName}},

Attached is the invoice for your Fox Blocks order. Cash-discounted pricing applies to payment by cash, check, or online check/ACH transfer.

Once payment is received we will place your order. Let me know if you have any questions.

Thank you for your business!
{{senderName}}`,
  },
  {
    id: "order_placement",
    label: "New order to manufacturer",
    audience: "manufacturer",
    steps: ["order"],
    fulfillment: null,
    subject: "New order PO {{poNumber}} - {{customerLastName}}",
    body: `Good afternoon,

We would like to place a new order.

Dealer account #{{dealerAccountNumber}}

PO {{poNumber}} - {{customerLastName}}, for {{fulfillmentDetail}}. The order form is attached.

Requested date: {{requestedDate}}
{{trailerLine}}

Thank you very much!
{{senderName}}`,
  },
  {
    id: "pickup_instructions",
    label: "Pickup instructions",
    audience: "customer",
    steps: ["confirmed", "vendor_invoice", "complete"],
    fulfillment: "pickup",
    subject: "Your Fox Blocks order is ready for pickup ({{epsNumber}})",
    body: `Hello, {{customerFirstName}},

Your Fox Blocks order has been released for pickup on {{requestedDate}} from:

{{warehouseName}}
{{warehouseAddress}}

You or your carrier must schedule a dock time at least 24 hours before pickup: call {{warehousePhone}} or email {{warehouseEmail}}. Dock appointments are {{warehouseDockHours}}. Reference order {{epsNumber}} when scheduling and at pickup.

Arriving without a dock time may mean a long wait or not being loaded. If the trailer is not one the warehouse will load (for example flatbed, reefer, or curtain side), the bundles will be brought to the end of the dock for your driver to load.

If you miss your dock time, reschedule directly with the warehouse and let us know.

Thank you!
{{senderName}}`,
  },
  {
    id: "delivery_instructions",
    label: "Delivery instructions",
    audience: "customer",
    steps: ["confirmed", "vendor_invoice", "complete"],
    fulfillment: "delivery",
    subject: "Your Fox Blocks delivery ({{epsNumber}})",
    body: `Hello, {{customerFirstName}},

Your Fox Blocks order is scheduled for delivery to {{jobAddress}} on {{requestedDate}}. The carrier will call to schedule a delivery time.

The freight charge covers transportation to your jobsite, not unloading. If you need help unloading, let us know at least 2 days before the order is loaded so we can arrange it (additional charges apply).

Thank you!
{{senderName}}`,
  },
  {
    id: "dock_time_request",
    label: "Dock time request to warehouse",
    audience: "warehouse",
    steps: ["confirmed"],
    fulfillment: "pickup",
    subject: "Dock time request - order {{epsNumber}}",
    body: `Hello,

We would like to schedule a dock time for Fox Blocks order {{epsNumber}} (PO {{poNumber}} - {{customerLastName}}) on {{requestedDate}}.

Trailer: {{trailerDimensions}}

Thank you,
{{senderName}}
{{officePhone}}`,
  },
  {
    id: "missed_pickup",
    label: "Missed pickup notice to manufacturer",
    audience: "manufacturer",
    steps: ["confirmed"],
    fulfillment: "pickup",
    subject: "Missed pickup - {{epsNumber}} / PO {{poNumber}} - {{customerLastName}}",
    body: `Hello,

The customer missed the scheduled pickup for order {{epsNumber}} (PO {{poNumber}} - {{customerLastName}}). They are rescheduling directly with the warehouse; we will let you know the new date once it is set.

Thank you,
{{senderName}}`,
  },
  {
    id: "delivery_coordination",
    label: "Delivery coordination to carrier",
    audience: "carrier",
    steps: ["confirmed"],
    fulfillment: "delivery",
    subject: "Delivery for order {{epsNumber}} - {{jobAddress}}",
    body: `Hello,

Delivery details for Fox Blocks order {{epsNumber}} (PO {{poNumber}}):

Jobsite: {{jobAddress}}
Site contact: {{customerName}}
Requested date: {{requestedDate}}

Thank you,
{{senderName}}
{{officePhone}}`,
  },
]

/** Extra merge fields computed from the others, used by the order email. */
type DerivedContext = NuTechEmailContext & {
  readonly fulfillmentDetail: string
  readonly trailerLine: string
}

/** The company's wording for a template, or the built-in wording. */
export function nuTechTemplateText(
  template: NuTechEmailTemplate,
  settings: NuTechEmailSettings,
): { readonly subject: string; readonly body: string } {
  return settings.templates[template.id] ?? { subject: template.subject, body: template.body }
}

/**
 * Fill {{field}} placeholders. Returns the text and the fields that were
 * empty, so the composer can point out what to fill in before sending.
 */
export function renderNuTechEmail(
  text: { readonly subject: string; readonly body: string },
  context: NuTechEmailContext,
  fulfillment: "delivery" | "pickup" | null,
): { readonly subject: string; readonly body: string; readonly missing: readonly string[] } {
  const derived: DerivedContext = {
    ...context,
    fulfillmentDetail:
      fulfillment === "pickup"
        ? `customer pickup from the ${context.warehouseName || "warehouse"}`
        : `delivery to ${context.jobAddress || "the jobsite"}`,
    trailerLine:
      fulfillment === "pickup" && context.trailerDimensions
        ? `Trailer: ${context.trailerDimensions} (picture attached)`
        : "",
  }
  const values: Readonly<Record<string, string>> = derived
  const missing = new Set<string>()
  const fill = (value: string): string =>
    value.replace(/\{\{\s*([a-zA-Z]+)\s*\}\}/g, (_match, name: string) => {
      const replacement = values[name]
      if (replacement === undefined || replacement === "") {
        missing.add(NUTECH_EMAIL_MERGE_FIELDS.find((field) => field.name === name)?.label ?? name)
        return ""
      }
      return replacement
    })
  const subject = fill(text.subject).replace(/\s{2,}/g, " ").trim()
  // Collapse blank lines left by empty fields.
  const body = fill(text.body).replace(/\n{3,}/g, "\n\n").trim()
  return { subject, body, missing: [...missing] }
}

/** Templates to offer for a job: this step's first, then the rest, filtered by fulfillment. */
export function nuTechTemplatesFor(
  step: NuTechStepId | null,
  fulfillment: "delivery" | "pickup" | null,
): { readonly suggested: readonly NuTechEmailTemplate[]; readonly other: readonly NuTechEmailTemplate[] } {
  const fits = NUTECH_EMAIL_TEMPLATES.filter(
    (template) => template.fulfillment === null || fulfillment === null || template.fulfillment === fulfillment,
  )
  const suggested = step ? fits.filter((template) => template.steps.includes(step)) : []
  return { suggested, other: fits.filter((template) => !suggested.includes(template)) }
}
