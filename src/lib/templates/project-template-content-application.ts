export type ProjectTemplateContentDefinition = {
  readonly id: string
  readonly moduleType: string
  readonly sourceItemId: string | null
  readonly parentSourceItemId: string | null
  readonly title: string
  readonly category: string | null
  readonly description: string | null
  readonly sortOrder: number
  readonly payloadJson: string | null
}

export type InstantiatedTemplateTodo = {
  readonly id: string
  readonly templateContentItemId: string
  readonly title: string
  readonly description: string | null
  readonly sourceRecordId: string
  readonly sourcePayloadJson: string
}

export type InstantiatedTemplateSelection = {
  readonly id: string
  readonly templateContentItemId: string
  readonly sourceRecordId: string
  readonly roomName: string
  readonly category: string
  readonly name: string
  readonly description: string | null
  readonly costCode: string | null
  readonly status: string
  readonly notes: string | null
  readonly sortOrder: number
}

export type InstantiatedTemplateBidPackage = {
  readonly id: string
  readonly templateContentItemId: string
  readonly sourceRecordId: string
  readonly title: string
  readonly description: string | null
  readonly costCode: string | null
  readonly sourcePayloadJson: string
}

export type ProjectTemplateContentApplication = {
  readonly todos: readonly InstantiatedTemplateTodo[]
  readonly selections: readonly InstantiatedTemplateSelection[]
  readonly bidPackages: readonly InstantiatedTemplateBidPackage[]
}

type JsonObject = Readonly<Record<string, unknown>>

function jsonObject(value: unknown): JsonObject | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return null
  }
  return Object.fromEntries(Object.entries(value))
}

function parsePayload(value: string | null): JsonObject {
  if (!value) return {}
  try {
    const parsed = jsonObject(JSON.parse(value))
    if (!parsed) throw new Error("Template content payload must be an object.")
    return parsed
  } catch {
    throw new Error("Template content has an invalid captured payload.")
  }
}

function text(value: unknown): string | null {
  if (typeof value !== "string") return null
  const trimmed = value.trim()
  return trimmed ? trimmed : null
}

function objectArray(value: unknown): readonly JsonObject[] {
  if (!Array.isArray(value)) return []
  return value.flatMap((item) => {
    const object = jsonObject(item)
    return object ? [object] : []
  })
}

function joinSections(parts: readonly (string | null)[]): string | null {
  const content = parts.filter((part): part is string => Boolean(part?.trim()))
  return content.length ? content.join("\n\n") : null
}

function costCode(category: string | null): string | null {
  if (!category) return null
  const match = category.match(/^([0-9]{2}(?:\s+[0-9]{2}){1,2})\b/)
  return match?.[1] ?? null
}

function choiceNotes(payload: JsonObject): string | null {
  const choices = objectArray(payload.choices).flatMap((choice) => {
    const title = text(choice.title)
    if (!title) return []
    const description = text(choice.description)
    return [`- ${title}${description ? `: ${description}` : ""}`]
  })
  const attachments = objectArray(payload.attachments).flatMap((attachment) => {
    const fileName = text(attachment.fileName)
    return fileName ? [`- ${fileName}`] : []
  })
  return joinSections([
    choices.length ? `Template choices:\n${choices.join("\n")}` : null,
    attachments.length
      ? `Template attachment references:\n${attachments.join("\n")}`
      : null,
  ])
}

function selectionStatus(value: unknown): string {
  const normalized = text(value)?.toLowerCase()
  if (normalized === "approved") return "approved"
  if (normalized === "selected") return "selected"
  return "needed"
}

function sourceRecordId(applicationId: string, contentItemId: string): string {
  return `${applicationId}:${contentItemId}`
}

export function buildProjectTemplateContentApplication(input: {
  readonly applicationId: string
  readonly items: readonly ProjectTemplateContentDefinition[]
  readonly nextId: () => string
}): ProjectTemplateContentApplication {
  const sourceTitles: [string, string][] = []
  for (const item of input.items) {
    if (item.sourceItemId) sourceTitles.push([item.sourceItemId, item.title])
  }
  const sourceTitle = new Map(sourceTitles)
  const todos: InstantiatedTemplateTodo[] = []
  const selections: InstantiatedTemplateSelection[] = []
  const bidPackages: InstantiatedTemplateBidPackage[] = []

  for (const item of input.items) {
    const title = item.title.trim()
    const materializedModule =
      item.moduleType === "tasks" ||
      item.moduleType === "selections" ||
      item.moduleType === "bid_packages"
    if (!materializedModule) continue
    if (!title) {
      throw new Error("Every reusable template item needs a title.")
    }
    const payload = parsePayload(item.payloadJson)
    const provenance = JSON.stringify({
      source: "project_template",
      applicationId: input.applicationId,
      templateContentItemId: item.id,
      sourceItemId: item.sourceItemId,
      parentSourceItemId: item.parentSourceItemId,
      payload,
    })
    if (item.moduleType === "tasks") {
      const parentTitle = item.parentSourceItemId
        ? sourceTitle.get(item.parentSourceItemId) ?? null
        : null
      todos.push({
        id: input.nextId(),
        templateContentItemId: item.id,
        title,
        description: joinSections([
          item.description,
          parentTitle ? `Template checklist: ${parentTitle}` : null,
        ]),
        sourceRecordId: sourceRecordId(input.applicationId, item.id),
        sourcePayloadJson: provenance,
      })
      continue
    }
    if (item.moduleType === "selections") {
      const category = item.category?.trim() || "Uncategorized"
      selections.push({
        id: input.nextId(),
        templateContentItemId: item.id,
        sourceRecordId: sourceRecordId(input.applicationId, item.id),
        roomName: text(payload.location) ?? "Whole Project",
        category,
        name: title,
        description: item.description,
        costCode: costCode(category),
        status: selectionStatus(payload.status),
        notes: choiceNotes(payload),
        sortOrder: item.sortOrder,
      })
      continue
    }
    if (item.moduleType === "bid_packages") {
      const primaryLine = objectArray(payload.lineItems)[0] ?? null
      const primaryCostCode = text(primaryLine?.costCode)
      bidPackages.push({
        id: input.nextId(),
        templateContentItemId: item.id,
        sourceRecordId: sourceRecordId(input.applicationId, item.id),
        title,
        description: item.description,
        costCode: costCode(primaryCostCode),
        sourcePayloadJson: provenance,
      })
    }
  }

  return { todos, selections, bidPackages }
}
