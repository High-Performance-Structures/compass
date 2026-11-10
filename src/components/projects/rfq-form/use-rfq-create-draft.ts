"use client"

import * as React from "react"
import { useRouter } from "next/navigation"

import { createRfqRequest } from "@/app/actions/project-operations"
import type { ProjectRfqCostCodeOption } from "@/lib/domain/operations/types"
import { directoryVendorPick } from "@/lib/domain/contacts/rules"
import type { ProjectTaskAssigneeOption } from "@/lib/domain/contacts/types"
import type {
  ProjectSelectionOptions,
  ProjectSelectionsSummary,
} from "@/lib/domain/selections/types"
import { cleanText } from "@/lib/shared/guards"

import {
  contactTypeLabel,
  normalizeChoice,
  optionMatches,
  toDocumentInput,
  toScopeInput,
  type RfqStatus,
} from "./rfq-draft"
import { EMPTY_RFQ_SCOPE_DRAFT, useRfqScopeDraft } from "./use-rfq-scope-draft"

/** Recipient ("Requested from") picker state and actions. */
function useRfqRecipient(recipientOptions: readonly ProjectTaskAssigneeOption[]) {
  const [recipientPickerOpen, setRecipientPickerOpen] = React.useState(false)
  const [recipientQuery, setRecipientQuery] = React.useState("")
  const [selectedRecipientId, setSelectedRecipientId] = React.useState<
    string | null
  >(null)
  const [requestedFrom, setRequestedFrom] = React.useState("")
  const [recipientEmail, setRecipientEmail] = React.useState("")
  const normalizedRecipientQuery = normalizeChoice(recipientQuery)
  const projectRecipientOptions = recipientOptions.filter(
    (option) =>
      option.source === "project" &&
      optionMatches(option, normalizedRecipientQuery)
  )
  const directoryRecipientOptions = recipientOptions.filter(
    (option) =>
      option.source === "directory" &&
      optionMatches(option, normalizedRecipientQuery)
  )
  const selectedRecipient = selectedRecipientId
    ? (recipientOptions.find((option) => option.id === selectedRecipientId) ??
      null)
    : null

  function useTypedRecipient(): void {
    const typedName = recipientQuery.trim()
    if (!typedName) return

    setSelectedRecipientId(null)
    setRequestedFrom(typedName)
    setRecipientQuery("")
    setRecipientPickerOpen(false)
  }

  function clearRecipient(): void {
    setSelectedRecipientId(null)
    setRequestedFrom("")
    setRecipientEmail("")
    setRecipientQuery("")
  }

  return {
    recipientPickerOpen,
    setRecipientPickerOpen,
    recipientQuery,
    setRecipientQuery,
    selectedRecipientId,
    setSelectedRecipientId,
    requestedFrom,
    setRequestedFrom,
    recipientEmail,
    setRecipientEmail,
    normalizedRecipientQuery,
    projectRecipientOptions,
    directoryRecipientOptions,
    selectedRecipient,
    useTypedRecipient,
    clearRecipient,
  }
}

export type RfqRecipientState = ReturnType<typeof useRfqRecipient> & {
  readonly selectRecipient: (option: ProjectTaskAssigneeOption) => void
}

/** Every piece of "New RFQ" draft state, its actions and the submit. */
export function useRfqCreateDraft({
  projectId,
  recipientOptions,
  selectionOptions,
  selectionsSummary,
  costCodeOptions,
}: {
  readonly projectId: string
  readonly recipientOptions: readonly ProjectTaskAssigneeOption[]
  readonly selectionOptions: ProjectSelectionOptions
  readonly selectionsSummary: ProjectSelectionsSummary
  readonly costCodeOptions: readonly ProjectRfqCostCodeOption[]
}) {
  const router = useRouter()
  const formRef = React.useRef<HTMLFormElement>(null)
  const [open, setOpen] = React.useState(false)
  const baseRecipient = useRfqRecipient(recipientOptions)
  const [priority, setPriority] = React.useState("normal")
  const { category, selections, rows, reset } = useRfqScopeDraft({
    selectionOptions,
    selectionsSummary,
    costCodeOptions,
    initial: EMPTY_RFQ_SCOPE_DRAFT,
  })
  const [status, setStatus] = React.useState<RfqStatus>({ kind: "idle" })
  const lineCount = rows.lines.filter(
    (line) => cleanText(line.description) !== null
  ).length
  const documentCount = rows.documentLinks.filter(
    (link) => cleanText(link.url) !== null
  ).length

  function selectRecipient(option: ProjectTaskAssigneeOption): void {
    baseRecipient.setSelectedRecipientId(option.id)
    baseRecipient.setRequestedFrom(option.companyName ?? option.name)
    baseRecipient.setRecipientEmail(option.email ?? "")
    category.setVendorCategory(contactTypeLabel(option.contactType))
    baseRecipient.setRecipientQuery("")
    baseRecipient.setRecipientPickerOpen(false)
  }

  async function handleSubmit(
    event: React.FormEvent<HTMLFormElement>
  ): Promise<void> {
    event.preventDefault()
    const form = formRef.current
    if (!form) return

    setStatus({ kind: "saving" })
    const formData = new FormData(form)
    const result = await createRfqRequest(projectId, {
      title: String(formData.get("title") ?? ""),
      vendorCategory: cleanText(category.vendorCategory),
      requestedFrom: cleanText(baseRecipient.requestedFrom),
      recipientEmail: cleanText(baseRecipient.recipientEmail),
      responseDueDate: cleanText(
        String(formData.get("responseDueDate") ?? "")
      ),
      vendorPick: directoryVendorPick(baseRecipient.selectedRecipient),
      priority,
      scope: cleanText(String(formData.get("scope") ?? "")),
      scopeItems: rows.lines.map(toScopeInput),
      documentLinks: rows.documentLinks.map(toDocumentInput),
    })

    if (!result.success) {
      setStatus({ kind: "error", message: result.error })
      return
    }

    form.reset()
    baseRecipient.setSelectedRecipientId(null)
    baseRecipient.setRequestedFrom("")
    baseRecipient.setRecipientEmail("")
    setPriority("normal")
    reset()
    setStatus({ kind: "saved", message: "RFQ draft created." })
    setOpen(false)
    router.push(
      `/dashboard/projects/${projectId}/rfqs?created=${encodeURIComponent(
        result.id
      )}`
    )
    router.refresh()
  }

  const recipient: RfqRecipientState = { ...baseRecipient, selectRecipient }

  return {
    formRef,
    open,
    setOpen,
    recipient,
    category,
    priority,
    setPriority,
    selections,
    rows,
    status,
    lineCount,
    documentCount,
    handleSubmit,
  }
}
