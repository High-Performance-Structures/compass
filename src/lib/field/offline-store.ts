"use client"

import {
  fieldOutboxSchema,
  fieldProjectPacketSchema,
  type FieldOutboxItem,
  type FieldProjectPacket,
} from "@/lib/field/types"

const CACHE_PREFIX = "compass.field.packet.v1"
const OUTBOX_KEY = "compass.field.outbox.v1"
const DOCUMENT_CACHE = "compass-field-documents-v1"

function storageAvailable(): boolean {
  return typeof window !== "undefined" && window.localStorage !== undefined
}

export function cacheFieldPacket(
  userId: string,
  packet: FieldProjectPacket
): void {
  if (!storageAvailable()) return
  window.localStorage.setItem(
    `${CACHE_PREFIX}.${userId}.${packet.project.id}`,
    JSON.stringify(packet)
  )
}

export function readCachedFieldPacket(
  userId: string,
  projectId: string
): FieldProjectPacket | null {
  if (!storageAvailable()) return null

  const stored = window.localStorage.getItem(
    `${CACHE_PREFIX}.${userId}.${projectId}`
  )
  if (!stored) return null

  try {
    const parsed: unknown = JSON.parse(stored)
    const result = fieldProjectPacketSchema.safeParse(parsed)
    return result.success ? result.data : null
  } catch {
    return null
  }
}

export function readFieldOutbox(): readonly FieldOutboxItem[] {
  if (!storageAvailable()) return []
  const stored = window.localStorage.getItem(OUTBOX_KEY)
  if (!stored) return []

  try {
    const parsed: unknown = JSON.parse(stored)
    const result = fieldOutboxSchema.safeParse(parsed)
    return result.success ? result.data : []
  } catch {
    return []
  }
}

function writeFieldOutbox(items: readonly FieldOutboxItem[]): void {
  if (!storageAvailable()) return
  window.localStorage.setItem(OUTBOX_KEY, JSON.stringify(items))
}

export function addFieldOutboxItem(item: FieldOutboxItem): void {
  writeFieldOutbox([...readFieldOutbox(), item])
}

export function replaceFieldOutboxItem(item: FieldOutboxItem): void {
  writeFieldOutbox([
    ...readFieldOutbox().filter((queued) => queued.id !== item.id),
    item,
  ])
}

export function removeFieldOutboxItem(itemId: string): void {
  writeFieldOutbox(readFieldOutbox().filter((item) => item.id !== itemId))
}

function fieldDocumentUrl(projectId: string, fileId: string): string {
  return `/api/google/download/${encodeURIComponent(fileId)}?projectId=${encodeURIComponent(projectId)}`
}

export async function saveFieldDocumentOffline(
  projectId: string,
  fileId: string
): Promise<void> {
  if (!("caches" in window)) {
    throw new Error("Offline documents are not supported by this browser.")
  }

  const url = fieldDocumentUrl(projectId, fileId)
  const response = await fetch(url)
  if (!response.ok) throw new Error("The document could not be downloaded.")

  const cache = await window.caches.open(DOCUMENT_CACHE)
  await cache.put(url, response)
}

export async function isFieldDocumentOffline(
  projectId: string,
  fileId: string
): Promise<boolean> {
  if (typeof window === "undefined" || !("caches" in window)) return false
  const cache = await window.caches.open(DOCUMENT_CACHE)
  const response = await cache.match(
    fieldDocumentUrl(projectId, fileId)
  )
  return response !== undefined
}

export async function openFieldDocument(
  projectId: string,
  fileId: string,
  onlineUrl: string | null
): Promise<void> {
  if ("caches" in window) {
    const cache = await window.caches.open(DOCUMENT_CACHE)
    const response = await cache.match(
      fieldDocumentUrl(projectId, fileId)
    )
    if (response) {
      const blob = await response.blob()
      window.open(URL.createObjectURL(blob), "_blank", "noopener,noreferrer")
      return
    }
  }

  if (!onlineUrl) throw new Error("This document is not available offline.")
  window.open(onlineUrl, "_blank", "noopener,noreferrer")
}
