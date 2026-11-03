"use client"

import * as React from "react"
import { IconCheck } from "@tabler/icons-react"

import type { ProjectDailyLogItem } from "@/lib/domain/field/daily-log-workspace"
import type { ProjectTaskAssigneeOption } from "@/lib/domain/contacts/types"
import type { DailyLogFollowUpSetup } from "@/lib/daily-logs/log-followups-server"
import { followUpLines, madeTodoTitles, todoTitleKey } from "@/lib/daily-logs/log-followups"
import { ProjectTaskCreateButton } from "@/components/projects/project-task-create-button"
import { formatDate } from "@/lib/format"

/**
 * Issues or Notes / next steps on a saved log, with Make to-do beside each
 * line for staff. Lines that are already to-dos on this log say so instead.
 */
export function SavedLogLines({
  log,
  source,
  text,
  projectId,
  rules,
  assigneeOptions,
}: {
  readonly log: ProjectDailyLogItem
  readonly source: "issues" | "notes"
  readonly text: string
  readonly projectId: string
  readonly rules: DailyLogFollowUpSetup["rules"] | null
  readonly assigneeOptions: readonly ProjectTaskAssigneeOption[]
}): React.ReactElement {
  const [firstType] = rules?.todoMode === "off" ? [] : rules?.todoTypes ?? []
  if (!firstType) {
    return <dd className="mt-1 whitespace-pre-wrap break-words leading-6">{text}</dd>
  }
  const made = madeTodoTitles(log.todos)
  const sourceName = source === "issues" ? "issues" : "next steps"
  return (
    <dd className="mt-1 grid leading-6">
      {text.split(/\r?\n/).map((raw, index) => {
        const key = `${source}-${index}`
        if (!raw.trim()) return <span key={key} className="h-3" aria-hidden="true" />
        const [title] = followUpLines(raw)
        return (
          <div key={key} className="flex items-start justify-between gap-2">
            <span className="min-w-0 whitespace-pre-wrap break-words">{raw}</span>
            {!title ? null : made.has(todoTitleKey(title)) ? (
              <span className="inline-flex h-7 shrink-0 items-center gap-1 px-2 text-xs text-muted-foreground">
                <IconCheck className="size-3.5 text-success" aria-hidden="true" />
                To-do made
              </span>
            ) : (
              <ProjectTaskCreateButton
                projectId={projectId}
                sourceLabel="Daily log"
                sourceRecordId={log.id}
                sourceRecordNumber={log.sourceExternalId ?? formatDate(log.logDate)}
                sourceHref={`/dashboard/projects/${projectId}/daily-logs#daily-log-${log.id}`}
                defaultTitle={title}
                defaultDescription={`From the ${formatDate(log.logDate)} daily log (${sourceName}): ${title}`}
                defaultAssigneeName={null}
                defaultCompanyName={null}
                defaultDueDate={null}
                defaultPriority={source === "issues" ? "high" : "normal"}
                defaultTaskType={firstType}
                assigneeOptions={assigneeOptions}
                triggerLabel="Make to-do"
                triggerAriaLabel={`Make a to-do from "${title}"`}
              />
            )}
          </div>
        )
      })}
    </dd>
  )
}
