"use client"

import * as React from "react"
import { getNuTechEmailDraft, sendNuTechEmail } from "@/app/actions/nutech-emails"
import { TemplateEmailMenu, type TemplateEmailDraft } from "@/components/email/template-email-menu"
import { nuTechTemplatesFor } from "@/lib/nutech/email-templates"
import type { NuTechStepId } from "@/lib/nutech/order-steps"

type Result<T> = { readonly success: true; readonly data: T } | { readonly success: false; readonly error: string }

const AUDIENCE_LABEL = {
  customer: "customer",
  manufacturer: "manufacturer",
  warehouse: "warehouse",
  carrier: "carrier",
} as const

async function loadNuTechDraft(projectId: string, templateId: string): Promise<Result<TemplateEmailDraft>> {
  const result = await getNuTechEmailDraft(projectId, templateId)
  if (!result.success) return result
  const draft = result.data
  const from = draft.senderAddress || "the Nu-Tech mailbox (not set yet: Settings → Company → Departments)"
  return {
    success: true,
    data: {
      ...draft,
      description: `To the ${AUDIENCE_LABEL[draft.audience]}, from ${from}.${draft.audience === "customer" ? " Sending logs it as a client contact." : ""}`,
    },
  }
}

/**
 * The emails for a Nu-Tech job, sent from the company's Nu-Tech mailbox.
 */
export function NuTechEmailMenu({
  projectId,
  step,
  fulfillment,
}: {
  readonly projectId: string
  readonly step: NuTechStepId | null
  readonly fulfillment: "delivery" | "pickup" | null
}): React.ReactElement {
  const { suggested, other } = nuTechTemplatesFor(step, fulfillment)
  return (
    <TemplateEmailMenu
      projectId={projectId}
      suggested={suggested}
      other={other}
      loadDraft={loadNuTechDraft}
      send={sendNuTechEmail}
      attachmentHint="Estimate PDF, order form, trailer photo, price sheets."
    />
  )
}
