"use client"

import { useEffect, useRef, useState } from "react"

import type {
  ProjectEstimateSigner,
  ProjectEstimateSummary,
} from "@/app/actions/project-estimates"
import type { ProjectEstimateSignerValue } from "@/components/projects/project-estimate-signer-picker"

export type EstimateHeaderState = {
  readonly defaultTaxEntityId: string
  readonly setDefaultTaxEntityId: (value: string) => void
  readonly termsTemplateId: string
  readonly setTermsTemplateId: (value: string) => void
  readonly contractTerms: string
  readonly setContractTerms: (value: string) => void
  readonly introductionTemplateId: string
  readonly setIntroductionTemplateId: (value: string) => void
  readonly introductionText: string
  readonly setIntroductionText: (value: string) => void
  readonly closingTemplateId: string
  readonly setClosingTemplateId: (value: string) => void
  readonly closingText: string
  readonly setClosingText: (value: string) => void
  readonly clientSigners: readonly ProjectEstimateSigner[]
  readonly setClientSigners: (value: readonly ProjectEstimateSigner[]) => void
  readonly companySigner: ProjectEstimateSignerValue
  readonly setCompanySigner: (value: ProjectEstimateSignerValue) => void
  readonly companySignerInitials: string
  readonly setCompanySignerInitials: (value: string) => void
}

/**
 * The controlled estimate header fields, reloaded only when the saved header
 * actually changes.
 */
export function useEstimateHeaderState(
  estimate: ProjectEstimateSummary | null
): EstimateHeaderState {
  const [defaultTaxEntityId, setDefaultTaxEntityId] = useState(
    estimate?.defaultTaxEntityId ?? ""
  )
  const [termsTemplateId, setTermsTemplateId] = useState(
    estimate?.termsTemplateId ?? ""
  )
  const [contractTerms, setContractTerms] = useState(
    estimate?.contractTerms ?? ""
  )
  const [introductionTemplateId, setIntroductionTemplateId] = useState(
    estimate?.introductionTemplateId ?? ""
  )
  const [introductionText, setIntroductionText] = useState(
    estimate?.introductionText ?? ""
  )
  const [closingTemplateId, setClosingTemplateId] = useState(
    estimate?.closingTemplateId ?? ""
  )
  const [closingText, setClosingText] = useState(estimate?.closingText ?? "")
  const [clientSigners, setClientSigners] = useState<readonly ProjectEstimateSigner[]>(
    estimate?.clientSigners ?? []
  )
  const [companySigner, setCompanySigner] =
    useState<ProjectEstimateSignerValue>({
      contactId: estimate?.companySignerContactId ?? null,
      name: estimate?.companySignerName ?? "",
      title: estimate?.companySignerTitle ?? "",
      email: estimate?.companySignerEmail ?? "",
    })
  const [companySignerInitials, setCompanySignerInitials] = useState(
    estimate?.companySignerInitials ?? ""
  )

  const lastLoadedHeader = useRef<string | null>(null)
  const persistedHeader = JSON.stringify([
    estimate?.id, estimate?.defaultTaxEntityId, estimate?.termsTemplateId,
    estimate?.contractTerms, estimate?.introductionTemplateId, estimate?.introductionText,
    estimate?.closingTemplateId, estimate?.closingText, estimate?.clientSigners,
    estimate?.companySignerContactId, estimate?.companySignerName, estimate?.companySignerTitle,
    estimate?.companySignerEmail, estimate?.companySignerInitials,
  ])
  useEffect(() => {
    // Line-order saves refresh the workspace. Equivalent signer arrays from the
    // server must not reset unfinished header fields in another input area.
    if (lastLoadedHeader.current === persistedHeader) return
    lastLoadedHeader.current = persistedHeader
    setDefaultTaxEntityId(estimate?.defaultTaxEntityId ?? "")
    setTermsTemplateId(estimate?.termsTemplateId ?? "")
    setContractTerms(estimate?.contractTerms ?? "")
    setIntroductionTemplateId(estimate?.introductionTemplateId ?? "")
    setIntroductionText(estimate?.introductionText ?? "")
    setClosingTemplateId(estimate?.closingTemplateId ?? "")
    setClosingText(estimate?.closingText ?? "")
    setClientSigners(estimate?.clientSigners ?? [])
    setCompanySigner({
      contactId: estimate?.companySignerContactId ?? null,
      name: estimate?.companySignerName ?? "",
      title: estimate?.companySignerTitle ?? "",
      email: estimate?.companySignerEmail ?? "",
    })
    setCompanySignerInitials(estimate?.companySignerInitials ?? "")
  }, [
    persistedHeader,
    estimate?.id,
    estimate?.defaultTaxEntityId,
    estimate?.termsTemplateId,
    estimate?.contractTerms,
    estimate?.introductionTemplateId,
    estimate?.introductionText,
    estimate?.closingTemplateId,
    estimate?.closingText,
    estimate?.clientSigners,
    estimate?.companySignerContactId,
    estimate?.companySignerName,
    estimate?.companySignerTitle,
    estimate?.companySignerEmail,
    estimate?.companySignerInitials,
  ])

  return {
    defaultTaxEntityId,
    setDefaultTaxEntityId,
    termsTemplateId,
    setTermsTemplateId,
    contractTerms,
    setContractTerms,
    introductionTemplateId,
    setIntroductionTemplateId,
    introductionText,
    setIntroductionText,
    closingTemplateId,
    setClosingTemplateId,
    closingText,
    setClosingText,
    clientSigners,
    setClientSigners,
    companySigner,
    setCompanySigner,
    companySignerInitials,
    setCompanySignerInitials,
  }
}
