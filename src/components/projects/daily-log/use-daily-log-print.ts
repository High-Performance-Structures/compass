"use client"

import * as React from "react"

import type { ProjectDailyLogItem } from "@/lib/domain/field/daily-log-workspace"
import {
  ALL_DAILY_LOG_AUTHORS,
  matchesDailyLogPrintFilters,
} from "@/lib/daily-logs/print-selection"
import { printPreviewHref } from "@/lib/print/print-documents"

export type DailyLogPrint = {
  readonly printStartDate: string
  readonly setPrintStartDate: (value: string) => void
  readonly printEndDate: string
  readonly setPrintEndDate: (value: string) => void
  readonly printAuthor: string
  readonly setPrintAuthor: (value: string) => void
  readonly printAuthorOptions: readonly string[]
  readonly hasUnknownPrintAuthor: boolean
  readonly dateAuthorPrintLogs: readonly ProjectDailyLogItem[]
  readonly printDailyLogs: (
    targetLogs: readonly ProjectDailyLogItem[],
    params: Readonly<Record<string, string>>
  ) => void
}

/** Print Daily Logs filters, kept while the print panel is closed. */
export function useDailyLogPrint({
  logs,
  projectId,
  projectLabel,
  setMessage,
}: {
  readonly logs: readonly ProjectDailyLogItem[]
  readonly projectId: string
  readonly projectLabel: string
  readonly setMessage: (message: string | null) => void
}): DailyLogPrint {
  const [printStartDate, setPrintStartDate] = React.useState("")
  const [printEndDate, setPrintEndDate] = React.useState("")
  const [printAuthor, setPrintAuthor] = React.useState(ALL_DAILY_LOG_AUTHORS)
  const printAuthorOptions = React.useMemo(
    () =>
      [...new Set(logs.map((log) => log.authorName).filter(
        (author): author is string => author !== null
      ))].sort((left, right) => left.localeCompare(right)),
    [logs]
  )
  const hasUnknownPrintAuthor = logs.some((log) => log.authorName === null)
  const dateAuthorPrintLogs = React.useMemo(
    () =>
      logs.filter((log) =>
        matchesDailyLogPrintFilters(
          log,
          printStartDate,
          printEndDate,
          printAuthor
        )
      ),
    [logs, printAuthor, printEndDate, printStartDate]
  )

  /** Opens Print Preview for the chosen logs, or for the date and author filters. */
  function printDailyLogs(
    targetLogs: readonly ProjectDailyLogItem[],
    params: Readonly<Record<string, string>>
  ): void {
    if (targetLogs.length === 0) {
      setMessage("Choose at least one daily log to print.")
      return
    }
    setMessage(null)
    window.open(
      printPreviewHref({ projectId, document: "daily-logs", params, number: `${projectLabel} daily logs` }),
      "_blank",
      "noopener"
    )
  }

  return {
    printStartDate,
    setPrintStartDate,
    printEndDate,
    setPrintEndDate,
    printAuthor,
    setPrintAuthor,
    printAuthorOptions,
    hasUnknownPrintAuthor,
    dateAuthorPrintLogs,
    printDailyLogs,
  }
}
