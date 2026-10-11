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

/** The built-in workflow for each department that has one. */
export const DEPARTMENT_WORKFLOWS: Readonly<Partial<Record<ProjectDepartment, WorkflowDefinition>>> = {
  N: NUTECH_ORDER_WORKFLOW,
  H: SCOPE_OF_WORK_WORKFLOW,
}
