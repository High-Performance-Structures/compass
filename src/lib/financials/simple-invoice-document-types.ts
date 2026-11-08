/** A simple invoice as its Print Preview and emailed PDF show it. */
export type InvoiceDocumentData = {
  readonly invoiceNumber: string | null
  readonly status: string
  readonly title: string | null
  readonly memo: string | null
  readonly issueDate: string
  readonly dueDate: string | null
  readonly billTo: { readonly name: string | null; readonly address: string | null }
  readonly project: { readonly name: string; readonly projectNumber: string | null; readonly address: string | null }
  readonly lines: readonly {
    readonly id: string
    readonly description: string
    readonly quantity: number
    readonly unit: string
    readonly unitPriceCents: number
    readonly amountCents: number
    readonly taxable: boolean
  }[]
  readonly subtotalCents: number
  readonly taxCents: number
  readonly taxDistrictName: string | null
  readonly totalCents: number
  readonly amountPaidCents: number
  readonly squarePublicUrl: string | null
}
