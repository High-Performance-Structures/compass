import type {
  FieldCherishRecognition,
  FieldCherishResponseType,
  FieldCherishValue,
} from "@/lib/field/types"

type CherishRecognitionSource = {
  readonly id: string
  readonly cherishValue: FieldCherishValue
  readonly responseType: FieldCherishResponseType
  readonly message: string
  readonly submittedByName: string | null
  readonly createdAt: string
}

/**
 * Keep the crew-facing payload deliberately smaller than the review record.
 * Private concerns are excluded even if a caller accidentally supplies one.
 */
export function toFieldCherishRecognitions(
  items: readonly CherishRecognitionSource[],
): readonly FieldCherishRecognition[] {
  return items.flatMap((item) =>
    item.responseType === "concern"
      ? []
      : [
          {
            id: item.id,
            cherishValue: item.cherishValue,
            responseType: item.responseType,
            message: item.message,
            submittedByName: item.submittedByName,
            createdAt: item.createdAt,
          },
        ],
  )
}
