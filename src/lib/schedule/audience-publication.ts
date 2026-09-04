export function selectAudienceScheduleSourceRows<TPublished, TDraft>(input: {
  readonly publishedRows: readonly TPublished[] | null
  readonly draftRows: readonly TDraft[]
  readonly viewerIsInternal: boolean
}): readonly (TPublished | TDraft)[] {
  if (input.publishedRows !== null) return input.publishedRows
  return input.viewerIsInternal ? input.draftRows : []
}
