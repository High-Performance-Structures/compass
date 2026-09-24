export type SageClientLinkCandidate = {
  readonly id: string
  readonly name: string
  readonly sageClientId: string | null
  readonly sageClientNumber: string | null
}

function present(value: string | null): boolean {
  return Boolean(value?.trim())
}

function nameKey(name: string): string {
  return name.trim().toLocaleLowerCase("en-US")
}

/** A same-name Sage record is evidence to review, never proof of identity. */
export function sageClientLinkReviewIds(
  customers: readonly SageClientLinkCandidate[]
): ReadonlySet<string> {
  const namesWithSageEvidence = new Set(
    customers
      .filter((customer) => present(customer.sageClientId) || present(customer.sageClientNumber))
      .map((customer) => nameKey(customer.name))
      .filter(Boolean)
  )
  return new Set(customers.flatMap((customer) => {
    const hasId = present(customer.sageClientId)
    const hasNumber = present(customer.sageClientNumber)
    if (hasId !== hasNumber) return [customer.id]
    if (!hasId && namesWithSageEvidence.has(nameKey(customer.name))) {
      return [customer.id]
    }
    return []
  }))
}
