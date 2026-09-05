export type EcardTemplateId =
  | "appreciation"
  | "celebration"
  | "birthday"
  | "welcome"
  | "thinking-of-you"

export type EcardTemplate = {
  readonly id: EcardTemplateId
  readonly name: string
  readonly headline: string
  readonly description: string
}

export const ECARD_TEMPLATES: readonly EcardTemplate[] = [
  {
    id: "appreciation",
    name: "With Appreciation",
    headline: "Thank you",
    description: "A warm, professional note of thanks.",
  },
  {
    id: "celebration",
    name: "Celebrate",
    headline: "Congratulations!",
    description: "For milestones, achievements, and great news.",
  },
  {
    id: "birthday",
    name: "Happy Birthday",
    headline: "Happy Birthday!",
    description: "A bright birthday greeting from the HPS team.",
  },
  {
    id: "welcome",
    name: "Welcome",
    headline: "Welcome to the team",
    description: "For new employees and new working relationships.",
  },
  {
    id: "thinking-of-you",
    name: "Thinking of You",
    headline: "Thinking of you",
    description: "A considerate note for support and encouragement.",
  },
]

export function getEcardTemplate(value: string): EcardTemplate | null {
  return ECARD_TEMPLATES.find((template) => template.id === value) ?? null
}
