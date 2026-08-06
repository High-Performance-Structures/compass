"use client"

import {
  getScheduleTemplateImportOptions,
  type ScheduleTemplateImportGroup
} from "@/app/actions/template-import-options"

let scheduleTemplateOptionsPromise:
  | Promise<readonly ScheduleTemplateImportGroup[]>
  | null = null
let scheduleTemplateOptionsLoadedAt: number | null = null

const SCHEDULE_TEMPLATE_OPTIONS_CACHE_MS = 30_000

/**
 * Share one options request between the single-item and bulk import dialogs.
 * The single-item dialog often starts loading immediately before the user opens
 * the bulk importer, so issuing a second Server Action request here is both
 * wasteful and vulnerable to a deployment changing the action manifest.
 */
export function loadScheduleTemplateImportOptions(): Promise<
  readonly ScheduleTemplateImportGroup[]
> {
  const cacheIsFresh =
    scheduleTemplateOptionsLoadedAt !== null &&
    Date.now() - scheduleTemplateOptionsLoadedAt <
      SCHEDULE_TEMPLATE_OPTIONS_CACHE_MS
  const requestIsInFlight =
    scheduleTemplateOptionsPromise !== null &&
    scheduleTemplateOptionsLoadedAt === null
  if (
    !requestIsInFlight &&
    (scheduleTemplateOptionsPromise === null || !cacheIsFresh)
  ) {
    const request = getScheduleTemplateImportOptions()
    scheduleTemplateOptionsLoadedAt = null
    scheduleTemplateOptionsPromise = request
      .then((groups) => {
        scheduleTemplateOptionsLoadedAt = Date.now()
        return groups
      })
      .catch((error: unknown) => {
        scheduleTemplateOptionsPromise = null
        scheduleTemplateOptionsLoadedAt = null
        throw error
      })
  }
  const optionsPromise = scheduleTemplateOptionsPromise
  if (optionsPromise === null) {
    return Promise.reject(new Error("Schedule template options request was not initialized."))
  }
  return optionsPromise
}

export function clearScheduleTemplateImportOptions(): void {
  scheduleTemplateOptionsPromise = null
  scheduleTemplateOptionsLoadedAt = null
}
