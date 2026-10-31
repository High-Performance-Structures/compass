import type { ProjectDepartment } from "@/lib/project-branding"

/**
 * Email templates for the HPS, ORC and Design job workflows (Nu-Tech has its
 * own in src/lib/nutech/email-templates.ts). Every company detail comes from
 * the department profile in Settings → Company; companies replace any wording
 * in Settings → Workflows → Job emails.
 */

/** Who a template goes to: the client (logged as client contact) or someone else on the job. */
type JobEmailAudience = "client" | "other"

export type JobEmailTemplate = {
  /** Unique within its department. */
  readonly id: string
  readonly label: string
  readonly audience: JobEmailAudience
  /** Workflow steps where it is offered first. */
  readonly steps: readonly string[]
  readonly subject: string
  readonly body: string
}

/** Merge fields a template can use, as {{name}}. */
export const JOB_EMAIL_MERGE_FIELDS = [
  { name: "clientFirstName", label: "Client first name" },
  { name: "clientName", label: "Client full name" },
  { name: "projectNumber", label: "Job number" },
  { name: "projectName", label: "Job name" },
  { name: "jobAddress", label: "Job site address" },
  { name: "senderName", label: "Your name" },
  { name: "senderEmail", label: "Your email" },
  { name: "companyName", label: "Company name (department profile)" },
  { name: "legalName", label: "Legal name (department profile)" },
  { name: "companyEmail", label: "Company email (department profile)" },
  { name: "officePhone", label: "Office phone (department profile)" },
  { name: "officeHours", label: "Office hours (department profile)" },
  { name: "website", label: "Website (department profile)" },
  { name: "mailingAddress", label: "Mailing address (department profile)" },
] as const

type JobEmailMergeField = (typeof JOB_EMAIL_MERGE_FIELDS)[number]["name"]
export type JobEmailContext = Readonly<Record<JobEmailMergeField, string>>

const SIGNATURE = `{{senderName}}
{{companyName}}
{{officePhone}}`

const SCOPE_OF_WORK_EMAILS: readonly JobEmailTemplate[] = [
  {
    id: "plans_request",
    label: "Request plans and scope",
    audience: "client",
    steps: ["intake"],
    subject: "Plans and scope for {{projectName}}",
    body: `Hello {{clientFirstName}},

Thank you for thinking of {{companyName}} for {{projectName}}. So we can put together an accurate estimate, please send:

- The current plans (PDF is fine), including any engineering
- The portion of the work you would like us to price
- Your target start date and any site constraints we should know about

If the work is coming over from a design or materials job we already have with you, just let me know and I'll pull those plans.

Thank you,
${SIGNATURE}`,
  },
  {
    id: "estimate",
    label: "Estimate",
    audience: "client",
    steps: ["estimate"],
    subject: "Estimate for {{projectName}} ({{projectNumber}})",
    body: `Hello {{clientFirstName}},

Attached is our estimate for the requested scope of work at {{jobAddress}}. It lists what is included and, just as important, what is excluded, so please read the exclusions and assumptions closely.

If anything should be added, removed or priced differently, reply and I'll revise it. When it looks right, let me know and I'll send the agreement.

Thank you,
${SIGNATURE}`,
  },
  {
    id: "estimate_follow_up",
    label: "Estimate follow-up",
    audience: "client",
    steps: ["approval"],
    subject: "Following up: estimate for {{projectName}}",
    body: `Hello {{clientFirstName}},

I wanted to follow up on the estimate we sent for {{projectName}}. Do you have any questions, or anything you'd like adjusted? We're happy to walk through it with you.

When you're ready to move forward, reply and I'll send the agreement and get you on our schedule.

Thank you,
${SIGNATURE}`,
  },
  {
    id: "agreement",
    label: "Agreement and deposit",
    audience: "client",
    steps: ["agreement"],
    subject: "Agreement and deposit for {{projectName}}",
    body: `Hello {{clientFirstName}},

Thank you for choosing {{companyName}}. Attached are the agreement for the scope of work at {{jobAddress}} and the deposit invoice.

Once the signed agreement and the deposit are in, we'll confirm a start date and order materials.

Thank you,
${SIGNATURE}`,
  },
  {
    id: "insurance_w9",
    label: "Certificate of insurance and W-9",
    audience: "other",
    steps: ["agreement"],
    subject: "Certificate of insurance and W-9: {{legalName}}",
    body: `Hello,

Attached are the certificate of insurance and W-9 for {{legalName}} for {{projectName}} at {{jobAddress}}.

If you need yourself listed as an additional insured, or any other paperwork, let me know.

Thank you,
${SIGNATURE}`,
  },
  {
    id: "start_confirmation",
    label: "Start date and site readiness",
    audience: "client",
    steps: ["scheduling"],
    subject: "Start date for {{projectName}}",
    body: `Hello {{clientFirstName}},

We're scheduled to start at {{jobAddress}} on [start date]. Before we arrive, please make sure:

- The permit is issued and posted on site
- The site is accessible for our crew, equipment and deliveries
- Any work by others that comes before ours is complete

If anything changes on your end, let me know as soon as possible so we can adjust the schedule.

Thank you,
${SIGNATURE}`,
  },
  {
    id: "change_order",
    label: "Change order for approval",
    audience: "client",
    steps: ["work"],
    subject: "Change order for approval: {{projectName}}",
    body: `Hello {{clientFirstName}},

Attached is a change order for {{projectName}}. It describes the added or changed work and its effect on price and schedule.

We'll proceed with this work once the change order is signed. Let me know if you have any questions.

Thank you,
${SIGNATURE}`,
  },
  {
    id: "completion",
    label: "Work complete and final invoice",
    audience: "client",
    steps: ["completion"],
    subject: "Work complete at {{projectName}}",
    body: `Hello {{clientFirstName}},

Our scope of work at {{jobAddress}} is complete. Please let me know a good time for a walk-through so we can review it together.

The final invoice is attached. Once it's paid, we'll send the lien waiver.

Thank you,
${SIGNATURE}`,
  },
  {
    id: "lien_waiver",
    label: "Lien waiver",
    audience: "client",
    steps: ["completion"],
    subject: "Lien waiver for {{projectName}}",
    body: `Hello {{clientFirstName}},

Thank you for your payment. Attached is our lien waiver for {{projectName}} at {{jobAddress}}.

Thank you,
${SIGNATURE}`,
  },
  {
    id: "thank_you",
    label: "Thank you",
    audience: "client",
    steps: ["closed"],
    subject: "Thank you from {{companyName}}",
    body: `Hello {{clientFirstName}},

Thank you for the opportunity to work with you on {{projectName}}. We appreciate your business and would be glad to help on your next project.

If anything comes up with our work, reach us at {{officePhone}} or {{companyEmail}}.

Thank you,
${SIGNATURE}`,
  },
]

const CUSTOM_BUILD_EMAILS: readonly JobEmailTemplate[] = [
  {
    id: "new_client_packet",
    label: "New-client packet",
    audience: "client",
    steps: ["intake"],
    subject: "Welcome to {{companyName}}",
    body: `Hello {{clientFirstName}},

It was a pleasure speaking with you about your new home. Attached is our new-client packet: our planning and specifications guides, an overview of our design and pre-construction process, and answers to common questions.

Please look it over before we meet; it will help us make the most of our time together.

We look forward to working with you,
${SIGNATURE}`,
  },
  {
    id: "meeting_confirmation",
    label: "First meeting confirmation",
    audience: "client",
    steps: ["intake"],
    subject: "Our meeting about {{projectName}}",
    body: `Hello {{clientFirstName}},

This confirms our meeting on [date and time] at [location]. Please bring anything that will help us understand what you have in mind: the lot information, plans or sketches, photos of homes you like, and your budget and timeframe.

If you need to reschedule, call us at {{officePhone}}.

Thank you,
${SIGNATURE}`,
  },
  {
    id: "design_agreement",
    label: "Design agreement and retainer",
    audience: "client",
    steps: ["design_agreement"],
    subject: "Design and pre-construction agreement: {{projectName}}",
    body: `Hello {{clientFirstName}},

Attached is our Design and Pre-Construction Services agreement, along with the retainer invoice. The agreement explains what is included in design, the revision rounds, and the preliminary estimate.

Once the signed agreement and the retainer are in, we'll schedule the site assessment and begin.

Thank you,
${SIGNATURE}`,
  },
  {
    id: "site_visit",
    label: "Site assessment visit",
    audience: "client",
    steps: ["site_plan"],
    subject: "Site assessment at {{jobAddress}}",
    body: `Hello {{clientFirstName}},

We'd like to schedule the site assessment at {{jobAddress}}. We'll look at access, slope, views, utilities and soils so the preliminary plan fits the site. Does [date and time] work for you?

Thank you,
${SIGNATURE}`,
  },
  {
    id: "plan_review",
    label: "Plan for review",
    audience: "client",
    steps: ["site_plan", "specs"],
    subject: "Plans for your review: {{projectName}}",
    body: `Hello {{clientFirstName}},

Attached are the latest plans for {{projectName}}. Please review them and send your comments, marked up or in a list, whichever is easier.

Thank you,
${SIGNATURE}`,
  },
  {
    id: "specs_approval",
    label: "Specifications and elevations for approval",
    audience: "client",
    steps: ["specs"],
    subject: "Specifications and elevations for approval: {{projectName}}",
    body: `Hello {{clientFirstName}},

Attached are the plan specifications, lighting plan, and elevations for {{projectName}}. Please review them and reply with your written approval, or any changes you'd like.

The preliminary estimate is based on these, so approval keeps things moving.

Thank you,
${SIGNATURE}`,
  },
  {
    id: "preliminary_estimate",
    label: "Preliminary estimate",
    audience: "client",
    steps: ["preliminary_estimate"],
    subject: "Preliminary estimate: {{projectName}}",
    body: `Hello {{clientFirstName}},

Attached is the preliminary estimate for {{projectName}}. It's based on the approved plans and specifications, with allowances where selections are still open.

Let's go over it together. If it's above your budget, we'll look at where the plan can be adjusted.

Thank you,
${SIGNATURE}`,
  },
  {
    id: "contract_packet",
    label: "Final estimate and contract",
    audience: "client",
    steps: ["final_contract"],
    subject: "Final estimate and construction contract: {{projectName}}",
    body: `Hello {{clientFirstName}},

Attached are the final estimate and the construction contract packet for {{projectName}}. Please review each document; I'm happy to walk through any of it.

If you're financing the build, I can send the documents your lender needs at the same time.

Thank you,
${SIGNATURE}`,
  },
  {
    id: "permit_submitted",
    label: "Permit submitted",
    audience: "client",
    steps: ["permitting"],
    subject: "Permit submitted for {{projectName}}",
    body: `Hello {{clientFirstName}},

We've submitted the plans and permit application for {{projectName}}. Review times vary; we'll answer any corrections the building department sends and let you know as soon as the permits are issued.

Thank you,
${SIGNATURE}`,
  },
  {
    id: "selections_due",
    label: "Selections due",
    audience: "client",
    steps: ["preconstruction"],
    subject: "Finish selections due: {{projectName}}",
    body: `Hello {{clientFirstName}},

To keep {{projectName}} on schedule, we need your finish selections by [date]. Selections made after their cutoff can delay the schedule or add cost, so please let us know if you need help deciding.

Thank you,
${SIGNATURE}`,
  },
  {
    id: "groundbreaking",
    label: "Groundbreaking date",
    audience: "client",
    steps: ["preconstruction"],
    subject: "Groundbreaking for {{projectName}}",
    body: `Hello {{clientFirstName}},

We're planning to break ground at {{jobAddress}} on [date]. Before then we'll meet to go over the schedule, how we'll keep you updated, and how changes are handled.

Thank you,
${SIGNATURE}`,
  },
  {
    id: "change_order",
    label: "Change order for approval",
    audience: "client",
    steps: ["construction"],
    subject: "Change order for approval: {{projectName}}",
    body: `Hello {{clientFirstName}},

Attached is a change order for {{projectName}}. It describes the change and its effect on price and schedule. We'll proceed once it's signed.

Thank you,
${SIGNATURE}`,
  },
  {
    id: "draw_request",
    label: "Draw request",
    audience: "client",
    steps: ["construction"],
    subject: "Draw request: {{projectName}}",
    body: `Hello {{clientFirstName}},

Attached is the current draw request for {{projectName}}, with the work completed this period. Please let me know if you or your lender need anything else.

Thank you,
${SIGNATURE}`,
  },
  {
    id: "walkthrough",
    label: "Walk-through invitation",
    audience: "client",
    steps: ["closeout"],
    subject: "Walk-through at {{projectName}}",
    body: `Hello {{clientFirstName}},

Your home is nearly complete. Let's schedule a walk-through to go over everything together and make the punch list. Does [date and time] work?

Thank you,
${SIGNATURE}`,
  },
  {
    id: "final_invoice",
    label: "Final invoice",
    audience: "client",
    steps: ["closeout"],
    subject: "Final invoice: {{projectName}}",
    body: `Hello {{clientFirstName}},

Attached is the final invoice for {{projectName}}. Thank you for trusting us with your home.

Thank you,
${SIGNATURE}`,
  },
  {
    id: "warranty_welcome",
    label: "Warranty and homeowner manual",
    audience: "client",
    steps: ["warranty"],
    subject: "Your warranty and homeowner manual",
    body: `Hello {{clientFirstName}},

Congratulations on your new home! Attached are your limited warranty and homeowner manual. Your warranty runs one year from [start date].

To report a warranty item, email {{companyEmail}} or call {{officePhone}}. We'll check in before the warranty ends to schedule a walk-through.

Thank you,
${SIGNATURE}`,
  },
  {
    id: "eleven_month",
    label: "11-month check-in",
    audience: "client",
    steps: ["warranty"],
    subject: "Your 11-month walk-through",
    body: `Hello {{clientFirstName}},

Your home's warranty ends next month. Let's schedule a walk-through to look at anything you've noticed during the year. Does [date and time] work?

Thank you,
${SIGNATURE}`,
  },
]

const DESIGN_EMAILS: readonly JobEmailTemplate[] = [
  {
    id: "welcome",
    label: "Welcome and design process",
    audience: "client",
    steps: ["intake"],
    subject: "Welcome to {{companyName}}",
    body: `Hello {{clientFirstName}},

Thank you for reaching out about {{projectName}}. Attached is an overview of our design process and typical timeline.

Before we meet, it helps to know your program (rooms and how you'll live in the home), your budget, and any photos or sketches of what you like.

Thank you,
${SIGNATURE}`,
  },
  {
    id: "proposal",
    label: "Design proposal and retainer",
    audience: "client",
    steps: ["agreement"],
    subject: "Design proposal: {{projectName}}",
    body: `Hello {{clientFirstName}},

Attached are our design proposal for {{projectName}} and the retainer invoice. The proposal lists what's included, the revision rounds, and the deliverables.

Once it's signed and the retainer is in, we'll start on the schematic design.

Thank you,
${SIGNATURE}`,
  },
  {
    id: "schematic_review",
    label: "Schematic design for review",
    audience: "client",
    steps: ["schematic"],
    subject: "Schematic design for review: {{projectName}}",
    body: `Hello {{clientFirstName}},

Attached are the schematic floor plans and front elevation for {{projectName}}. Please review them and send your comments; we'll go over them together at our next meeting.

Thank you,
${SIGNATURE}`,
  },
  {
    id: "revision_set",
    label: "Revised plans",
    audience: "client",
    steps: ["development"],
    subject: "Revised plans: {{projectName}}",
    body: `Hello {{clientFirstName}},

Attached is the revised plan set for {{projectName}}, with the changes we discussed. Please review it and let us know what you think.

Thank you,
${SIGNATURE}`,
  },
  {
    id: "additional_services",
    label: "Additional services notice",
    audience: "client",
    steps: ["development"],
    subject: "Additional design services: {{projectName}}",
    body: `Hello {{clientFirstName}},

We've used the revision rounds included in the design agreement for {{projectName}}. We're glad to keep refining the design; further revisions are billed as additional services at the rates in the agreement.

Let me know how you'd like to proceed.

Thank you,
${SIGNATURE}`,
  },
  {
    id: "finish_schedule",
    label: "Finish schedule for approval",
    audience: "client",
    steps: ["engineering"],
    subject: "Finish schedule for approval: {{projectName}}",
    body: `Hello {{clientFirstName}},

Attached is the finish schedule for {{projectName}}. Please review it and reply with your approval or any changes.

Thank you,
${SIGNATURE}`,
  },
  {
    id: "final_plans",
    label: "Final plans and invoice",
    audience: "client",
    steps: ["deliverables"],
    subject: "Final plans: {{projectName}}",
    body: `Hello {{clientFirstName}},

The construction documents for {{projectName}} are complete. The digital set is attached, and the printed sets are ready for you. The final invoice is attached as well.

Thank you,
${SIGNATURE}`,
  },
  {
    id: "thank_you",
    label: "Thank you and next steps",
    audience: "client",
    steps: ["complete"],
    subject: "Thank you from {{companyName}}",
    body: `Hello {{clientFirstName}},

Thank you for designing {{projectName}} with us. If you'd like us to build it, or to price part of the work, we'd be glad to put together an estimate.

Thank you,
${SIGNATURE}`,
  },
]

/** Built-in templates per department; Nu-Tech's live in its own module. */
export const JOB_EMAIL_TEMPLATES: Readonly<Partial<Record<ProjectDepartment, readonly JobEmailTemplate[]>>> = {
  O: CUSTOM_BUILD_EMAILS,
  H: SCOPE_OF_WORK_EMAILS,
  D: DESIGN_EMAILS,
}

/** Settings key for a template's custom wording. */
export function jobEmailTemplateKey(department: ProjectDepartment, templateId: string): string {
  return `${department}.${templateId}`
}

export function jobEmailTemplate(department: ProjectDepartment, templateId: string): JobEmailTemplate | null {
  return JOB_EMAIL_TEMPLATES[department]?.find((template) => template.id === templateId) ?? null
}

/** The company's wording for a template, or the built-in wording. */
export function jobEmailTemplateText(
  department: ProjectDepartment,
  template: JobEmailTemplate,
  custom: Readonly<Record<string, { readonly subject: string; readonly body: string }>>,
): { readonly subject: string; readonly body: string } {
  return custom[jobEmailTemplateKey(department, template.id)] ?? { subject: template.subject, body: template.body }
}

/**
 * Fill {{field}} placeholders. Returns the text and the fields that were
 * empty, so the composer can point out what to fill in before sending.
 */
export function renderJobEmail(
  text: { readonly subject: string; readonly body: string },
  context: JobEmailContext,
): { readonly subject: string; readonly body: string; readonly missing: readonly string[] } {
  const values: Readonly<Record<string, string>> = context
  const missing = new Set<string>()
  const fill = (value: string): string =>
    value.replace(/\{\{\s*([a-zA-Z]+)\s*\}\}/g, (_match, name: string) => {
      const replacement = values[name]
      if (replacement === undefined || replacement === "") {
        missing.add(JOB_EMAIL_MERGE_FIELDS.find((field) => field.name === name)?.label ?? name)
        return ""
      }
      return replacement
    })
  // Collapse spaces and blank lines left by empty fields.
  const subject = fill(text.subject).replace(/\s{2,}/g, " ").replace(/\(\s*\)/g, "").trim()
  const body = fill(text.body).replace(/ +([,.])/g, "$1").replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim()
  return { subject, body, missing: [...missing] }
}

/** Templates for a job: this step's first, then the rest. */
export function jobTemplatesFor(
  department: ProjectDepartment,
  step: string | null,
): { readonly suggested: readonly JobEmailTemplate[]; readonly other: readonly JobEmailTemplate[] } {
  const all = JOB_EMAIL_TEMPLATES[department] ?? []
  const suggested = step ? all.filter((template) => template.steps.includes(step)) : []
  return { suggested, other: all.filter((template) => !suggested.includes(template)) }
}
