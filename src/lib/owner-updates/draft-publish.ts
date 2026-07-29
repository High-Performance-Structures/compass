export type OwnerUpdateMutationResult =
  | { readonly success: true }
  | { readonly success: false; readonly error: string }

export async function persistOwnerUpdateDraft(input: {
  readonly intent: "save" | "publish"
  readonly save: () => Promise<OwnerUpdateMutationResult>
  readonly publish: () => Promise<OwnerUpdateMutationResult>
}): Promise<OwnerUpdateMutationResult> {
  const saved = await input.save()
  if (!saved.success || input.intent === "save") return saved

  return input.publish()
}
