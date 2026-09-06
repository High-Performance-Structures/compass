export type OwnerArSourceSystem = "buildertrend" | "compass" | "manual" | "sage"

export type OwnerArSourceIdentity = {
  readonly organizationId: string
  readonly projectId: string
  readonly sourceSystem: OwnerArSourceSystem
  readonly sourceExternalId: string
}

export type OwnerArCashSettlementCents = {
  readonly cashReceipt: true
  readonly grossAmountCents: number
  readonly processingFeeCents: number
  readonly netAmountCents: number
}

export type OwnerArNonCashCreditSettlement = {
  readonly cashReceipt: false
  readonly appliedAmountCents: number
}

export type OwnerArSettlement =
  | OwnerArCashSettlementCents
  | OwnerArNonCashCreditSettlement

export type OwnerArValidationResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: string }

type OwnerArActionFields = {
  readonly organizationId?: unknown
  readonly sourceSystem?: unknown
  readonly sourceExternalId?: unknown
}

export const omitOwnerArSourceFields = <T extends OwnerArActionFields>(
  input: T,
): Omit<T, "organizationId" | "sourceSystem" | "sourceExternalId"> => {
  const {
    organizationId: _organizationId,
    sourceSystem: _sourceSystem,
    sourceExternalId: _sourceExternalId,
    ...safeData
  } = input
  return safeData
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value)

const isNonEmptyString = (value: unknown): value is string =>
  typeof value === "string" && value.trim().length > 0

const isSafeNonnegativeInteger = (value: unknown): value is number =>
  typeof value === "number" && Number.isSafeInteger(value) && value >= 0

export const validateOwnerArSourceIdentity = (
  input: unknown,
): OwnerArValidationResult<OwnerArSourceIdentity> => {
  if (!isRecord(input)) {
    return { ok: false, error: "source identity must be an object" }
  }
  const organizationId = input.organizationId
  const projectId = input.projectId
  const sourceSystem = input.sourceSystem
  const sourceExternalId = input.sourceExternalId
  if (!isNonEmptyString(organizationId)) {
    return { ok: false, error: "organizationId is required" }
  }
  if (!isNonEmptyString(projectId)) {
    return { ok: false, error: "projectId is required" }
  }
  if (
    sourceSystem !== "buildertrend" &&
    sourceSystem !== "compass" &&
    sourceSystem !== "manual" &&
    sourceSystem !== "sage"
  ) {
    return { ok: false, error: "sourceSystem is unsupported" }
  }
  if (!isNonEmptyString(sourceExternalId)) {
    return { ok: false, error: "sourceExternalId is required" }
  }
  return {
    ok: true,
    value: {
      organizationId,
      projectId,
      sourceSystem,
      sourceExternalId,
    },
  }
}

export const validateCashSettlementCents = (
  input: unknown,
): OwnerArValidationResult<OwnerArCashSettlementCents> => {
  if (!isRecord(input) || input.cashReceipt !== true) {
    return { ok: false, error: "cash settlement must have cashReceipt=true" }
  }
  const grossAmountCents = input.grossAmountCents
  const processingFeeCents = input.processingFeeCents
  const netAmountCents = input.netAmountCents
  if (!isSafeNonnegativeInteger(grossAmountCents)) {
    return { ok: false, error: "grossAmountCents must be a safe nonnegative integer" }
  }
  if (!isSafeNonnegativeInteger(processingFeeCents)) {
    return { ok: false, error: "processingFeeCents must be a safe nonnegative integer" }
  }
  if (!isSafeNonnegativeInteger(netAmountCents)) {
    return { ok: false, error: "netAmountCents must be a safe nonnegative integer" }
  }
  if (grossAmountCents !== processingFeeCents + netAmountCents) {
    return { ok: false, error: "grossAmountCents must equal fee plus net" }
  }
  return {
    ok: true,
    value: { cashReceipt: true, grossAmountCents, processingFeeCents, netAmountCents },
  }
}

export const validateNonCashCreditSettlement = (
  input: unknown,
): OwnerArValidationResult<OwnerArNonCashCreditSettlement> => {
  if (!isRecord(input) || input.cashReceipt !== false) {
    return { ok: false, error: "credit settlement must have cashReceipt=false" }
  }
  const appliedAmountCents = input.appliedAmountCents
  if (!isSafeNonnegativeInteger(appliedAmountCents) || appliedAmountCents <= 0) {
    return { ok: false, error: "appliedAmountCents must be a positive safe integer" }
  }
  return { ok: true, value: { cashReceipt: false, appliedAmountCents } }
}

export const validateOwnerArAllocationCents = (
  value: unknown,
): OwnerArValidationResult<number> => {
  if (!isSafeNonnegativeInteger(value) || value <= 0) {
    return { ok: false, error: "allocation cents must be a positive safe integer" }
  }
  return { ok: true, value }
}
