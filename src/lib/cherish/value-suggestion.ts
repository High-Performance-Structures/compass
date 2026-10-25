import type { CherishValue } from "@/app/actions/cherish-pulse"

// Words and phrases that point to each CHERISH value. Matching is
// deterministic and runs in the browser, so it works offline in Field Desk.
// Naming a value outright counts more than a related word.
const VALUE_SIGNALS: ReadonlyArray<
  Readonly<{ value: CherishValue; phrases: readonly string[] }>
> = [
  {
    value: "Camaraderie",
    phrases: [
      "team", "teamwork", "together", "each other", "morale", "crew",
      "pitched in", "pitch in", "encouraged", "encouraging", "welcomed",
      "welcoming", "celebrate", "celebrated", "fun", "friendly", "jumped in",
      "had my back", "had our back",
    ],
  },
  {
    value: "Honor",
    phrases: [
      "respect", "respected", "respectful", "kept his word", "kept her word",
      "kept their word", "kept a promise", "kept the promise", "dignity",
      "courteous", "professional", "professionalism", "stood up for",
    ],
  },
  {
    value: "Excellence",
    phrases: [
      "quality", "excellent", "craftsmanship", "attention to detail", "detail",
      "precise", "perfect", "flawless", "clean work", "beautiful", "top notch",
      "top-notch", "above and beyond", "high standard", "great work",
      "outstanding",
    ],
  },
  {
    value: "Reliability",
    phrases: [
      "on time", "ahead of schedule", "reliable", "dependable", "deadline",
      "showed up", "shows up", "early", "consistent", "consistently",
      "count on", "counted on", "followed through", "follow through",
      "every day", "never missed",
    ],
  },
  {
    value: "Integrity",
    phrases: [
      "honest", "honesty", "truth", "truthful", "admitted", "owned up",
      "owned the mistake", "transparent", "right thing", "ethical",
      "accountable", "accountability",
    ],
  },
  {
    value: "Servitude",
    phrases: [
      "serve", "served", "serving", "service", "client", "customer",
      "homeowner", "owner was", "volunteer", "volunteered", "community",
      "extra mile", "went out of his way", "went out of her way",
      "went out of their way", "helped the",
    ],
  },
  {
    value: "Humility",
    phrases: [
      "humble", "humility", "gave credit", "gives credit", "asked for help",
      "listened", "learned from", "open to feedback", "took feedback",
      "no ego", "without complaint",
    ],
  },
]

function escapeForPattern(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

function phraseCount(text: string, phrase: string): number {
  const pattern = new RegExp(`\\b${escapeForPattern(phrase)}\\b`, "g")
  return text.match(pattern)?.length ?? 0
}

/**
 * The CHERISH value that best fits a message, or null when nothing in the
 * message points to one. Ties go to the value listed first in CHERISH order.
 */
export function suggestCherishValue(message: string): CherishValue | null {
  const text = message.toLowerCase().replace(/[’']/g, "'").replace(/\s+/g, " ")
  if (text.trim().length < 3) return null
  let best: Readonly<{ value: CherishValue; score: number }> | null = null
  for (const signal of VALUE_SIGNALS) {
    let score = phraseCount(text, signal.value.toLowerCase()) * 3
    for (const phrase of signal.phrases) score += phraseCount(text, phrase)
    if (score > 0 && (best === null || score > best.score)) {
      best = { value: signal.value, score }
    }
  }
  return best?.value ?? null
}
