import type { WorkflowDefinition } from "@/lib/job-workflows/engine"
import { NUTECH_ORDER_WORKFLOW } from "@/lib/nutech/order-steps"
import type { ProjectDepartment } from "@/lib/project-branding"

/**
 * Subcontracted scope of work: someone brings plans, or comes from a Design
 * or Nu-Tech job, and asks for a portion of the work. The company estimates
 * that scope and carries it through to the lien waiver.
 */
export const SCOPE_OF_WORK_WORKFLOW: WorkflowDefinition = {
  title: "scope of work",
  steps: [
    {
      id: "intake",
      label: "Intake",
      jobStatusId: "intake",
      items: [
        { id: "client", label: "Add the customer as a client contact", fact: "clientContact", path: "contacts" },
        { id: "address", label: "Add the job site address", fact: "hasAddress", path: "information" },
        { id: "plans", label: "Plans and the requested scope received", path: "documents" },
        {
          id: "source",
          label: "Link the Design or Nu-Tech job it came from (or tick if the customer brought plans)",
          fact: "linkedToOtherDepartment",
          tickable: true,
          path: null,
        },
      ],
    },
    {
      id: "estimate",
      label: "Takeoff & estimate",
      jobStatusId: "estimating",
      items: [
        { id: "takeoff", label: "Take off quantities for the requested scope", path: null },
        { id: "built", label: "Build the estimate", fact: "estimateBuilt", path: "estimate" },
        { id: "sent", label: "Send the estimate to the customer", fact: "estimateSent", tickable: true, path: "estimate" },
      ],
    },
    {
      id: "approval",
      label: "Follow-up & approval",
      jobStatusId: "estimate_sent",
      items: [
        { id: "accepted", label: "Customer accepts the estimate", fact: "estimateAccepted", tickable: true, path: "estimate" },
      ],
    },
    {
      id: "agreement",
      label: "Agreement & deposit",
      jobStatusId: "contract",
      items: [
        { id: "signed", label: "Agreement or subcontract signed", fact: "agreementSigned", tickable: true, path: "contracts" },
        { id: "coi", label: "Send our certificate of insurance", path: null },
        { id: "w9", label: "Send our W-9", path: null },
        { id: "deposit", label: "Deposit received", path: null },
      ],
    },
    {
      id: "scheduling",
      label: "Scheduling & materials",
      jobStatusId: "awarded",
      items: [
        { id: "permit", label: "Permit issued, or not required", path: null },
        { id: "scheduled", label: "Schedule the work", fact: "scheduled", tickable: true, path: "schedule" },
        { id: "materials", label: "Order materials", fact: "purchaseOrdered", tickable: true, path: "purchase-orders" },
      ],
    },
    {
      id: "work",
      label: "Work in progress",
      jobStatusId: "under_construction",
      items: [
        { id: "started", label: "Crew on site (first daily log)", fact: "dailyLogged", tickable: true, path: "daily-logs" },
        { id: "finished", label: "Our scope of work is finished", path: null },
      ],
    },
    {
      id: "completion",
      label: "Completion",
      jobStatusId: "punchlist",
      items: [
        { id: "walkthrough", label: "Final walk-through with the customer", path: null },
        { id: "invoice", label: "Send the final invoice", path: null },
        { id: "lien_waiver", label: "Deliver the lien waiver once paid", path: null },
      ],
    },
    {
      id: "closed",
      label: "Closed",
      jobStatusId: "complete",
      items: [{ id: "closed", label: "Set the job status to complete", fact: "jobClosed", path: "information" }],
    },
  ],
}

/**
 * Custom build: the design and preconstruction process through permit, then
 * construction, closeout and the one-year warranty. Finishing the work is
 * always ticked by a person; records only show that work happened.
 */
export const CUSTOM_BUILD_WORKFLOW: WorkflowDefinition = {
  title: "custom build",
  steps: [
    {
      id: "intake",
      label: "Lead & intake",
      jobStatusId: "intake",
      items: [
        { id: "client", label: "Add the client as a client contact", fact: "clientContact", path: "contacts" },
        { id: "address", label: "Add the site address", fact: "hasAddress", path: "information" },
        { id: "details", label: "Land, timeframe, budget and plan idea noted", path: "information" },
        { id: "packet", label: "Send the new-client packet", path: null },
        { id: "meeting", label: "First meeting held", path: null },
        { id: "drive", label: "Project Drive folder", fact: "driveFolder", tickable: true, path: "documents" },
      ],
    },
    {
      id: "design_agreement",
      label: "Design agreement",
      jobStatusId: "design_proposal_sent",
      items: [
        { id: "signed", label: "Design & pre-construction agreement signed", path: null },
        { id: "retainer", label: "Retainer received", path: null },
      ],
    },
    {
      id: "site_plan",
      label: "Site & preliminary plan",
      jobStatusId: "in_design",
      items: [
        { id: "site_visit", label: "Site assessment visit", path: null },
        { id: "soils", label: "Soils / perc test ordered and received", path: null },
        { id: "preliminary_plan", label: "Preliminary plan reviewed with the client", path: null },
      ],
    },
    {
      id: "specs",
      label: "Specs, lighting & elevations",
      jobStatusId: "in_design",
      items: [
        { id: "specifications", label: "Specifications and lighting plan approved in writing", path: null },
        { id: "elevations", label: "Elevations and sections approved", path: null },
      ],
    },
    {
      id: "preliminary_estimate",
      label: "Preliminary estimate",
      jobStatusId: "budget_estimate_sent",
      items: [
        { id: "sent", label: "Send the preliminary estimate", fact: "estimateSent", tickable: true, path: "estimate" },
        { id: "approved", label: "Client approves it, or the plan is revised to budget", path: null },
      ],
    },
    {
      id: "construction_documents",
      label: "Construction documents",
      jobStatusId: "engineering",
      items: [
        { id: "plot_plan", label: "Plot plan and house stake", path: null },
        { id: "engineering", label: "Structural and foundation engineering", path: null },
        { id: "mechanical", label: "Mechanical / sprinkler design, if required", path: null },
        { id: "stamped_set", label: "Stamped full set", path: "documents" },
        { id: "payment", label: "Design-development payment received", path: null },
      ],
    },
    {
      id: "final_contract",
      label: "Final estimate & contract",
      jobStatusId: "contract_docs_sent",
      items: [
        { id: "accepted", label: "Final estimate accepted", fact: "estimateAccepted", tickable: true, path: "estimate" },
        { id: "contract", label: "Contract packet signed", fact: "agreementSigned", tickable: true, path: "contracts" },
        { id: "lender", label: "Lender documents, if financed", path: null },
        { id: "payment", label: "Final design payment received", path: null },
      ],
    },
    {
      id: "permitting",
      label: "Permitting",
      jobStatusId: "permitting",
      items: [
        { id: "submitted", label: "Plans and application submitted", path: null },
        { id: "corrections", label: "Plan corrections answered", path: null },
        { id: "issued", label: "Permits issued (building, septic, well, driveway, fire)", path: null },
      ],
    },
    {
      // "Pre-construction" is the company's name for the design and engineering
      // stage (see the design agreement step), so this step is named for the wait.
      id: "preconstruction",
      label: "Awaiting groundbreaking",
      jobStatusId: "awaiting_groundbreaking",
      items: [
        { id: "selections", label: "Finish selections approved", fact: "selectionsApproved", tickable: true, path: "selections" },
        { id: "schedule", label: "Build the schedule", fact: "scheduled", tickable: true, path: "schedule" },
        { id: "buyout", label: "Bids in; subcontracts and POs issued", fact: "purchaseOrdered", tickable: true, path: "purchase-orders" },
        { id: "meeting", label: "Pre-groundbreaking meeting held", path: null },
        { id: "groundbreaking", label: "Groundbreaking date set", path: "schedule" },
      ],
    },
    {
      id: "construction",
      label: "Construction",
      jobStatusId: "under_construction",
      items: [
        { id: "started", label: "Crew on site (first daily log)", fact: "dailyLogged", tickable: true, path: "daily-logs" },
        { id: "owner_update", label: "Owner update sent this week", fact: "ownerUpdateRecent", path: "owner-updates" },
        { id: "change_orders", label: "No change orders waiting on an answer", fact: "changeOrdersAnswered", path: "change-orders" },
        { id: "inspections", label: "Inspections passed", path: null },
        { id: "finished", label: "Construction finished", path: null },
      ],
    },
    {
      id: "closeout",
      label: "Closeout",
      jobStatusId: "punchlist",
      items: [
        { id: "first_walkthrough", label: "First walk-through and punch list", path: null },
        { id: "punch_list", label: "Punch list complete", path: null },
        { id: "signoff", label: "Second walk-through and owner sign-off", path: null },
        { id: "occupancy", label: "Certificate of occupancy", path: "documents" },
        { id: "final_invoice", label: "Final invoice paid", path: null },
      ],
    },
    {
      id: "warranty",
      label: "Warranty",
      jobStatusId: "under_warranty",
      items: [
        { id: "start_date", label: "Warranty start date recorded (occupancy or final payment)", path: "warranty" },
        { id: "manual", label: "Send the homeowner warranty manual", path: null },
        { id: "eleven_month", label: "11-month walk-through done", path: null },
        { id: "closed", label: "Set the job status to complete", fact: "jobClosed", path: "information" },
      ],
    },
  ],
}

/** Design only: drawings and engineering handed to the client, a builder, or our own build. */
export const DESIGN_WORKFLOW: WorkflowDefinition = {
  title: "project",
  steps: [
    {
      id: "intake",
      label: "Intake",
      jobStatusId: "intake",
      items: [
        { id: "client", label: "Add the client as a client contact", fact: "clientContact", path: "contacts" },
        { id: "address", label: "Add the site address", fact: "hasAddress", path: "information" },
        { id: "program", label: "Program and budget noted", path: "information" },
        { id: "meeting", label: "Initial meeting held", path: null },
      ],
    },
    {
      id: "agreement",
      label: "Proposal & agreement",
      jobStatusId: "design_proposal_sent",
      items: [
        { id: "signed", label: "Design proposal signed", path: null },
        { id: "retainer", label: "Retainer received", path: null },
      ],
    },
    {
      id: "schematic",
      label: "Schematic design",
      jobStatusId: "in_design",
      items: [{ id: "delivered", label: "Schematic floor plans and front elevation delivered", path: "documents" }],
    },
    {
      id: "development",
      label: "Design development",
      jobStatusId: "in_design",
      items: [
        { id: "revisions", label: "Review meetings and revisions done (additional services past the included rounds)", path: null },
        { id: "estimate", label: "Preliminary estimate sent, if in scope", fact: "estimateSent", tickable: true, path: "estimate" },
      ],
    },
    {
      id: "engineering",
      label: "Engineering & selections",
      jobStatusId: "engineering",
      items: [
        { id: "engineering", label: "Engineering ordered and received", path: null },
        { id: "finish_schedule", label: "Finish schedule complete", fact: "selectionsApproved", tickable: true, path: "selections" },
      ],
    },
    {
      id: "deliverables",
      label: "Deliverables",
      jobStatusId: null,
      items: [
        { id: "documents", label: "Construction documents delivered (sets and digital)", path: "documents" },
        { id: "payment", label: "Final payment received", path: null },
      ],
    },
    {
      id: "complete",
      label: "Complete",
      jobStatusId: "complete",
      items: [
        { id: "handoff", label: "Handed off to the builder, or converted to a build job", path: null },
        { id: "closed", label: "Set the job status to complete", fact: "jobClosed", path: "information" },
      ],
    },
  ],
}

/** The built-in workflow for each department that has one. */
export const DEPARTMENT_WORKFLOWS: Readonly<Partial<Record<ProjectDepartment, WorkflowDefinition>>> = {
  O: CUSTOM_BUILD_WORKFLOW,
  H: SCOPE_OF_WORK_WORKFLOW,
  N: NUTECH_ORDER_WORKFLOW,
  D: DESIGN_WORKFLOW,
}
