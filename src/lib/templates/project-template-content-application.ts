import {
  formatTemplateChecklist,
  groupTemplateChecklistItems,
} from "@/lib/templates/template-checklist-hierarchy"
import { normalizeTemplateBidPackage } from "@/lib/templates/template-bid-package"
import { buildTemplateSelectionHierarchy } from "@/lib/templates/template-selection-hierarchy"

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
  readonly choiceOptionsJson: string | null
  readonly parentSelectionId: string | null
  readonly parentChoiceValue: string | null
  readonly selectionLevel: number
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
  const attachments = objectArray(payload.attachments).flatMap((attachment) => {
    const fileName = text(attachment.fileName)
    return fileName ? [`- ${fileName}`] : []
  })
  return attachments.length
    ? `Template attachment references:\n${attachments.join("\n")}`
    : null
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
  const taskGroups = groupTemplateChecklistItems(
    input.items.filter((item) => item.moduleType === "tasks")
  )
  const taskGroupById = new Map(
    taskGroups.map((group) => [group.task.id, group])
  )
  const selectionHierarchy = buildTemplateSelectionHierarchy(
    input.items
      .filter((item) => item.moduleType === "selections")
      .map((item) => ({
        id: item.id,
        title: item.title,
        payloadJson: item.payloadJson,
        sortOrder: item.sortOrder,
      }))
  )
  const hierarchyByItemId = new Map(
    selectionHierarchy.map((item) => [item.itemId, item])
  )
  const todos: InstantiatedTemplateTodo[] = []
  const selections: (InstantiatedTemplateSelection & {
    readonly parentTemplateContentItemId: string | null
  })[] = []
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
    if (item.moduleType === "tasks") {
      if (item.parentSourceItemId) continue
      const checklistItems = taskGroupById.get(item.id)?.checklistItems ?? []
      const checklistProvenance = checklistItems.map((checklistItem) => ({
        templateContentItemId: checklistItem.id,
        sourceItemId: checklistItem.sourceItemId,
        title: checklistItem.title,
        description: checklistItem.description,
        sortOrder: checklistItem.sortOrder,
        payload: parsePayload(checklistItem.payloadJson),
      }))
      todos.push({
        id: input.nextId(),
        templateContentItemId: item.id,
        title,
        description: joinSections([
          item.description,
          formatTemplateChecklist(checklistItems),
        ]),
        sourceRecordId: sourceRecordId(input.applicationId, item.id),
        sourcePayloadJson: JSON.stringify({
          source: "project_template",
          applicationId: input.applicationId,
          templateContentItemId: item.id,
          sourceItemId: item.sourceItemId,
          parentSourceItemId: null,
          payload,
          checklistItems: checklistProvenance,
        }),
      })
      continue
    }
    const provenance = JSON.stringify({
      source: "project_template",
      applicationId: input.applicationId,
      templateContentItemId: item.id,
      sourceItemId: item.sourceItemId,
      parentSourceItemId: item.parentSourceItemId,
      payload,
    })
    if (item.moduleType === "selections") {
      const category = item.category?.trim() || "Uncategorized"
      const hierarchy = hierarchyByItemId.get(item.id)
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
        choiceOptionsJson:
          hierarchy && hierarchy.choiceOptions.length > 0
            ? JSON.stringify(hierarchy.choiceOptions)
            : null,
        parentSelectionId: null,
        parentTemplateContentItemId: hierarchy?.parentItemId ?? null,
        parentChoiceValue: hierarchy?.parentChoiceValue ?? null,
        selectionLevel: hierarchy?.level ?? 0,
        sortOrder: item.sortOrder,
      })
      continue
    }
    if (item.moduleType === "bid_packages") {
      const normalized = normalizeTemplateBidPackage({
        title,
        description: item.description,
        payloadJson: item.payloadJson,
      })
      bidPackages.push({
        id: input.nextId(),
        templateContentItemId: item.id,
        sourceRecordId: sourceRecordId(input.applicationId, item.id),
        title,
        description: normalized.overallScope,
        costCode: normalized.primaryCostCode,
        sourcePayloadJson: JSON.stringify({
          source: "compass_template_rfq",
          vendorCategory: normalized.vendorCategory,
          scope: normalized.overallScope,
          scopeItems: normalized.scopeItems,
          documentLinks: normalized.documentLinks,
          templateReview: normalized.templateReview,
          templateProvenance: JSON.parse(provenance),
        }),
      })
    }
  }

  const selectionIdByTemplateItemId = new Map(
    selections.map((selection) => [selection.templateContentItemId, selection.id])
  )
  const resolvedSelections = selections.map((selection) => ({
    id: selection.id,
    templateContentItemId: selection.templateContentItemId,
    sourceRecordId: selection.sourceRecordId,
    roomName: selection.roomName,
    category: selection.category,
    name: selection.name,
    description: selection.description,
    costCode: selection.costCode,
    status: selection.status,
    notes: selection.notes,
    choiceOptionsJson: selection.choiceOptionsJson,
    parentSelectionId: selection.parentTemplateContentItemId
      ? selectionIdByTemplateItemId.get(selection.parentTemplateContentItemId) ?? null
      : null,
    parentChoiceValue: selection.parentChoiceValue,
    selectionLevel: selection.selectionLevel,
    sortOrder: selection.sortOrder,
  }))

  return { todos, selections: resolvedSelections, bidPackages }
}
