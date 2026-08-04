export type TemplateSelectionHierarchyInput = {
  readonly id: string
  readonly title: string
  readonly payloadJson: string | null
  readonly sortOrder: number
}

export type TemplateSelectionHierarchyItem = {
  readonly itemId: string
  readonly choiceOptions: readonly string[]
  readonly parentItemId: string | null
  readonly parentChoiceValue: string | null
  readonly level: number
}

type JsonObject = Readonly<Record<string, unknown>>

function jsonObject(value: unknown): JsonObject | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return null
  }
  return Object.fromEntries(Object.entries(value))
}

function text(value: unknown): string | null {
  if (typeof value !== "string") return null
  const trimmed = value.trim()
  return trimmed ? trimmed : null
}

function choices(payloadJson: string | null): readonly string[] {
  if (!payloadJson) return []
  try {
    const payload = jsonObject(JSON.parse(payloadJson))
    if (!payload || !Array.isArray(payload.choices)) return []
    return payload.choices.flatMap((choice) => {
      const value = jsonObject(choice)
      const title = value ? text(value.title) : null
      return title ? [title] : []
    })
  } catch {
    throw new Error("Template selection has an invalid captured payload.")
  }
}

function normalizedProductName(value: string): string {
  return value
    .toLowerCase()
    .replace(/^metal sales\s+/, "")
    .replace(/\([^)]*\)/g, " ")
    .replace(/\b(?:24|26|29)\s+gauge\s+colors?\b/g, " ")
    .replace(/\bmetal\s+gauge\b/g, " ")
    .replace(/\bgauage\b/g, " ")
    .replace(/\bcoverage\b/g, " ")
    .replace(/\balternate(?:s| options?| option)?\b/g, " ")
    .replace(/\baluminum\b/g, " ")
    .replace(/\bcurved\b/g, " ")
    .replace(/\bpanel\b/g, " ")
    .replace(/\broof\b/g, " ")
    .replace(/[^a-z0-9]+/g, "")
    .replace(/^5vcrimp$/, "5vrib")
    .replace(/^ic72$/, "ic72")
    .replace(/^maxbatten$/, "maxibatten")
}

function productMatchScore(childTitle: string, choice: string): number {
  const child = normalizedProductName(childTitle)
  const candidate = normalizedProductName(choice)
  if (!child || !candidate) return 0
  if (child === candidate) return 1000 + candidate.length
  if (child.startsWith(candidate) || candidate.startsWith(child)) {
    return 500 + Math.min(child.length, candidate.length)
  }

  let prefix = 0
  while (
    prefix < child.length &&
    prefix < candidate.length &&
    child[prefix] === candidate[prefix]
  ) {
    prefix += 1
  }
  return prefix >= 4 ? prefix : 0
}

function bestPanelChoice(
  title: string,
  panelChoices: readonly string[]
): string | null {
  const ranked = panelChoices
    .map((choice) => ({ choice, score: productMatchScore(title, choice) }))
    .sort((left, right) => right.score - left.score)
  return ranked[0] && ranked[0].score >= 4 ? ranked[0].choice : null
}

function gaugeFromTitle(title: string): string | null {
  const match = title.match(/\b(24|26|29)\s+Gauge\b/i)
  return match?.[1] ? `${match[1]} Gauge` : null
}

export function buildTemplateSelectionHierarchy(
  input: readonly TemplateSelectionHierarchyInput[]
): readonly TemplateSelectionHierarchyItem[] {
  const ordered = [...input].sort((left, right) => left.sortOrder - right.sortOrder)
  const byTitle = new Map(ordered.map((item) => [item.title.toLowerCase(), item]))
  const roofMaterial = byTitle.get("roof material") ?? null
  const roofPanelProfile = byTitle.get("roof panel profile") ?? null
  const impactRating = byTitle.get("impact rating") ?? null
  const shingleColor = byTitle.get("shingle color") ?? null
  const shingleColors = byTitle.get("shingle colors") ?? null
  const panelChoices = roofPanelProfile ? choices(roofPanelProfile.payloadJson) : []

  const relationById = new Map<
    string,
    { readonly parentItemId: string; readonly parentChoiceValue: string }
  >()

  if (roofMaterial && roofPanelProfile) {
    relationById.set(roofPanelProfile.id, {
      parentItemId: roofMaterial.id,
      parentChoiceValue: "Metal Roofing",
    })
  }
  if (roofMaterial && impactRating) {
    relationById.set(impactRating.id, {
      parentItemId: roofMaterial.id,
      parentChoiceValue: "Asphalt Shingles",
    })
  }
  if (impactRating && shingleColors) {
    relationById.set(shingleColors.id, {
      parentItemId: impactRating.id,
      parentChoiceValue: "Owens Corning Duration",
    })
  }
  if (impactRating && shingleColor) {
    relationById.set(shingleColor.id, {
      parentItemId: impactRating.id,
      parentChoiceValue: "Owens Corning Duration Storm",
    })
  }

  if (roofPanelProfile) {
    for (const item of ordered) {
      if (
        item.id === roofPanelProfile.id ||
        item.id === roofMaterial?.id ||
        item.id === impactRating?.id ||
        item.id === shingleColor?.id ||
        item.id === shingleColors?.id
      ) {
        continue
      }
      const panelChoice = bestPanelChoice(item.title, panelChoices)
      if (!panelChoice) continue
      relationById.set(item.id, {
        parentItemId: roofPanelProfile.id,
        parentChoiceValue: panelChoice,
      })
    }

    const gaugeItems = ordered.filter((item) => /\b(?:Metal Gauge|Gauage)\b/i.test(item.title))
    for (const item of ordered) {
      const gauge = gaugeFromTitle(item.title)
      if (!gauge || !/\bColors?\b/i.test(item.title)) continue
      const panelChoice = bestPanelChoice(item.title, panelChoices)
      if (!panelChoice) continue
      const gaugeParent = gaugeItems.find(
        (candidate) => bestPanelChoice(candidate.title, [panelChoice]) === panelChoice
      )
      if (!gaugeParent || !choices(gaugeParent.payloadJson).includes(gauge)) continue
      relationById.set(item.id, {
        parentItemId: gaugeParent.id,
        parentChoiceValue: gauge,
      })
    }
  }

  function levelFor(itemId: string, seen: ReadonlySet<string> = new Set()): number {
    const relation = relationById.get(itemId)
    if (!relation || seen.has(itemId)) return 0
    const nextSeen = new Set(seen)
    nextSeen.add(itemId)
    return levelFor(relation.parentItemId, nextSeen) + 1
  }

  return ordered.map((item) => {
    const relation = relationById.get(item.id)
    return {
      itemId: item.id,
      choiceOptions: choices(item.payloadJson),
      parentItemId: relation?.parentItemId ?? null,
      parentChoiceValue: relation?.parentChoiceValue ?? null,
      level: levelFor(item.id),
    }
  })
}
