export type PurchaseOrderVendorIdentity = {
  readonly companyName: string | null
  readonly sageVendorId: string | null
  readonly sageVendorName: string | null
}

export type PurchaseOrderVendorContactCandidate = {
  readonly address: string | null
  readonly companyName: string | null
  readonly displayName: string
  readonly email: string | null
}

export type PurchaseOrderVendorDirectoryCandidate = {
  readonly address: string | null
  readonly email: string | null
  readonly name: string
  readonly netsuiteId: string | null
  readonly sourceRecordId: string | null
  readonly sourceRecordNumber: string | null
}

export type PurchaseOrderVendorDetails = {
  readonly address: string | null
  readonly email: string | null
}

function normalizedKey(value: string | null): string {
  return (value ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
}

function firstNonEmpty(
  values: readonly (string | null)[]
): string | null {
  for (const value of values) {
    const trimmed = value?.trim() ?? ""
    if (trimmed.length > 0) return trimmed
  }
  return null
}

export function purchaseOrderVendorDetails({
  contacts,
  order,
  vendors,
}: {
  readonly contacts: readonly PurchaseOrderVendorContactCandidate[]
  readonly order: PurchaseOrderVendorIdentity
  readonly vendors: readonly PurchaseOrderVendorDirectoryCandidate[]
}): PurchaseOrderVendorDetails {
  const orderKeys = [
    order.companyName,
    order.sageVendorName,
    order.sageVendorId,
  ]
    .map(normalizedKey)
    .filter((key) => key.length > 0)

  const matchingContacts = contacts.filter((contact) =>
    [contact.companyName, contact.displayName]
      .map(normalizedKey)
      .some((key) => key.length > 0 && orderKeys.includes(key))
  )
  const matchingVendors = vendors.filter((vendor) => {
    const identityKeys = [
      vendor.name,
      vendor.netsuiteId,
      vendor.sourceRecordId,
      vendor.sourceRecordNumber,
    ].map(normalizedKey)
    return identityKeys.some(
      (key) => key.length > 0 && orderKeys.includes(key)
    )
  })

  return {
    address: firstNonEmpty([
      ...matchingContacts.map((contact) => contact.address),
      ...matchingVendors.map((vendor) => vendor.address),
    ]),
    email: firstNonEmpty([
      ...matchingContacts.map((contact) => contact.email),
      ...matchingVendors.map((vendor) => vendor.email),
    ]),
  }
}
