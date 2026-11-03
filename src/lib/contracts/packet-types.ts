import type { ContractPacketSigner } from "@/lib/contracts/packet"

/** Contract packet shapes shared by the packet actions and the packet PDF. */
export type ProjectContractPacketEstimateOption = {
  readonly id: string
  readonly estimateNumber: string
  readonly versionNumber: number
  readonly title: string
  readonly status: string
  readonly estimateDate: string | null
  readonly clientName: string | null
  readonly clientMailingAddress: string | null
  readonly builderFeeCents: number
  readonly builderFeeRateBasisPoints: number
  readonly estimateTotalCents: number
}

export type ProjectContractPacketDocumentItem = {
  readonly id: string
  readonly templateId: string | null
  readonly templateVersionId: string | null
  readonly code: string
  readonly title: string
  readonly contentMarkdown: string
  readonly inclusionMode: string
  readonly signingStage: string
  readonly signaturePolicy: string
  readonly documentDate: string | null
  readonly revision: string | null
  readonly sourceUrl: string | null
  readonly sortOrder: number
}

export type ProjectContractPacketSummary = {
  readonly id: string
  readonly estimateId: string
  readonly packetNumber: string
  readonly versionNumber: number
  readonly title: string
  readonly status: string
  readonly legalEntityName: string
  readonly contractDraftDate: string | null
  readonly approximateCommencementDate: string | null
  readonly approximateCompletionDate: string | null
  readonly depositRateBasisPoints: number
  readonly depositCents: number
  readonly latePaymentRateBasisPoints: number
  readonly details: Readonly<Record<string, string>>
  readonly clientSigners: readonly ContractPacketSigner[]
  readonly companySignerName: string | null
  readonly companySignerTitle: string | null
  readonly companySignerEmail: string | null
  readonly companySignerInitials: string | null
  readonly foxitStatus: string
  readonly foxitEnvelopeId: string | null
  readonly foxitEmbeddedSessionUrl: string | null
  readonly signaturePackageUrl: string | null
  readonly signedAt: string | null
  readonly acceptanceMethod: string | null
  readonly acceptanceEvidenceLabel: string | null
  readonly acceptanceRecordedByName: string | null
  readonly acceptedAt: string | null
  readonly createdAt: string
  readonly updatedAt: string
}
