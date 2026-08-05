"use client"

import * as React from "react"
import { useRouter } from "next/navigation"
import {
  IconBrandTelegram,
  IconCalendar,
  IconCloud,
  IconDatabase,
  IconExternalLink,
  IconFolder,
  IconLock,
  IconPencil,
  IconRefresh,
} from "@tabler/icons-react"

import {
  updateProjectRegistry,
  type ProjectRegistry,
} from "@/app/actions/project-registry"
import { provisionProjectDriveFolder } from "@/app/actions/projects"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"

type ProjectStatusOption = {
  readonly value: string
  readonly label: string
  readonly description: string
}

type RegistryField = {
  readonly key: keyof ProjectRegistry["project"]
  readonly name: string
  readonly label: string
  readonly placeholder: string
}

const ID_FIELDS: readonly RegistryField[] = [
  {
    key: "projectNumber",
    name: "projectNumber",
    label: "Compass project #",
    placeholder: "O-202-595",
  },
  {
    key: "sageJobNumber",
    name: "sageJobNumber",
    label: "Sage job ID",
    placeholder: "722",
  },
  {
    key: "sageJobId",
    name: "sageJobId",
    label: "Sage source internal ID",
    placeholder: "Source internal ID",
  },
  {
    key: "buildertrendProjectId",
    name: "buildertrendProjectId",
    label: "Buildertrend ID",
    placeholder: "Legacy project ID",
  },
  {
    key: "googleDriveFolderId",
    name: "googleDriveFolderId",
    label: "Drive folder ID",
    placeholder: "Google Drive folder ID",
  },
  {
    key: "googleScheduleSheetId",
    name: "googleScheduleSheetId",
    label: "Schedule sheet ID",
    placeholder: "Google Sheet ID",
  },
  {
    key: "googleDailyLogSheetId",
    name: "googleDailyLogSheetId",
    label: "Daily log sheet ID",
    placeholder: "Google Sheet ID",
  },
  {
    key: "googleCalendarId",
    name: "googleCalendarId",
    label: "Milestone calendar ID",
    placeholder: "Calendar ID",
  },
]

const PROJECT_STATUS_OPTIONS: readonly ProjectStatusOption[] = [
  {
    value: "OPEN",
    label: "Active",
    description: "Current jobs and work that should stay visible day to day.",
  },
  {
    value: "WARRANTY",
    label: "Warranty",
    description: "Completed jobs still carrying warranty or service attention.",
  },
  {
    value: "COMPLETE",
    label: "Complete",
    description: "Completed projects that are still useful in regular records.",
  },
  {
    value: "INACTIVE",
    label: "Inactive",
    description: "Paused work that should not appear in day-to-day active views.",
  },
  {
    value: "ARCHIVE",
    label: "Archive",
    description: "Historical projects kept for reference.",
  },
  {
    value: "OTHER",
    label: "Other / needs cleanup",
    description: "Imported statuses that need review before final mapping.",
  },
]

function externalValue(
  registry: ProjectRegistry,
  key: keyof ProjectRegistry["project"]
): string {
  const value = registry.project[key]
  return typeof value === "string" ? value : ""
}

function telegramChatId(registry: ProjectRegistry): string {
  const link = registry.links.find(
    (item) => item.system === "telegram_owner_updates"
  )
  return link?.externalId ?? ""
}

function connectionCount(registry: ProjectRegistry): number {
  return ID_FIELDS.filter((field) => externalValue(registry, field.key)).length
}

function mappedLinks(
  registry: ProjectRegistry
): readonly ProjectRegistry["links"][number][] {
  return registry.links.filter((link) => link.externalUrl)
}

export function ProjectRegistryPanel({
  projectId,
  registry,
}: {
  readonly projectId: string
  readonly registry: ProjectRegistry | null
}): React.ReactElement {
  const router = useRouter()
  const [message, setMessage] = React.useState<string | null>(null)
  const [isSaving, setIsSaving] = React.useState(false)
  const [isProvisioningDrive, setIsProvisioningDrive] = React.useState(false)
  const [isEditing, setIsEditing] = React.useState(false)

  if (!registry) {
    return (
      <section className="rounded-lg border p-3 sm:p-4">
        <div className="flex items-center gap-2">
          <IconDatabase className="size-4 text-muted-foreground" />
          <h2 className="text-sm font-medium">Project Registry</h2>
        </div>
        <p className="mt-2 text-sm text-muted-foreground">
          Registry details are unavailable for this project.
        </p>
      </section>
    )
  }

  async function saveRegistry(formData: FormData): Promise<void> {
    setIsSaving(true)
    setMessage(null)
    const result = await updateProjectRegistry(projectId, formData)
    setIsSaving(false)
    setMessage(
      result.success
        ? "Project mapping saved."
        : `Could not save mapping: ${result.error}`
    )
  }

  async function retryDriveSetup(): Promise<void> {
    setIsProvisioningDrive(true)
    setMessage(null)
    const result = await provisionProjectDriveFolder(projectId)
    setIsProvisioningDrive(false)
    if (!result.success) {
      setMessage(`Could not provision Drive: ${result.error}`)
      return
    }
    setMessage(
      result.createdRoot
        ? "Project Drive folder created and linked."
        : "Existing project Drive folder found and linked."
    )
    router.refresh()
  }

  const mappedCount = connectionCount(registry)
  const telegramId = telegramChatId(registry)
  const links = mappedLinks(registry)

  if (!isEditing) {
    return (
      <section className="rounded-lg border p-3 sm:p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-start gap-2">
            <IconLock className="mt-0.5 size-4 text-muted-foreground" />
            <div>
              <h2 className="text-sm font-medium">Project Registry</h2>
              <p className="mt-1 text-xs text-muted-foreground">
                Admin-only mapping is hidden until registry edit mode is
                opened.
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Badge variant={mappedCount > 0 ? "secondary" : "outline"}>
              {mappedCount} mapped
            </Badge>
            {!registry.project.googleDriveFolderId && (
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={retryDriveSetup}
                disabled={isProvisioningDrive}
              >
                {isProvisioningDrive ? (
                  <IconRefresh className="size-4 animate-spin" />
                ) : (
                  <IconFolder className="size-4" />
                )}
                Retry Drive setup
              </Button>
            )}
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => setIsEditing(true)}
            >
              <IconPencil className="size-4" />
              Edit registry
            </Button>
          </div>
        </div>
        {message && (
          <p className="mt-3 rounded-md bg-muted px-3 py-2 text-xs text-muted-foreground">
            {message}
          </p>
        )}
      </section>
    )
  }

  return (
    <section className="rounded-lg border p-3 sm:p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <IconDatabase className="size-4 text-muted-foreground" />
            <h2 className="text-sm font-medium">Project Registry</h2>
          </div>
          <p className="mt-1 text-xs text-muted-foreground">
            Canonical links for Sage, Google Workspace, Buildertrend,
            owner updates, and photo intake.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Badge variant={mappedCount > 0 ? "secondary" : "outline"}>
            {mappedCount} mapped
          </Badge>
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => setIsEditing(false)}
          >
            <IconLock className="size-4" />
            Lock
          </Button>
        </div>
      </div>

      <form action={saveRegistry} className="mt-4 space-y-4">
        <div className="grid grid-cols-1 gap-3 rounded-md border bg-muted/25 p-3 sm:grid-cols-[minmax(0,16rem)_1fr]">
          <div className="space-y-1.5">
            <Label htmlFor={`${projectId}-status`}>Project status</Label>
            <select
              id={`${projectId}-status`}
              name="status"
              defaultValue={registry.project.status}
              className="border-input bg-background h-8 w-full rounded-md border px-2 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
            >
              {PROJECT_STATUS_OPTIONS.map((option) => (
                <option
                  key={option.value}
                  value={option.value}
                  title={option.description}
                >
                  {option.label}
                </option>
              ))}
            </select>
          </div>
          <div className="self-end text-xs leading-5 text-muted-foreground">
            Status changes are admin-only and move the project between the
            Project Hub views.
          </div>
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {ID_FIELDS.map((field) => (
            <div key={field.name} className="space-y-1.5">
              <Label htmlFor={`${projectId}-${field.name}`}>
                {field.label}
              </Label>
              <Input
                id={`${projectId}-${field.name}`}
                name={field.name}
                defaultValue={externalValue(registry, field.key)}
                placeholder={field.placeholder}
                className="h-8 text-sm"
              />
            </div>
          ))}
        </div>

        <div className="grid grid-cols-1 gap-3 border-t pt-4 sm:grid-cols-3">
          <div className="space-y-1.5">
            <Label htmlFor={`${projectId}-ownerUpdateChannel`}>
              Owner update channel
            </Label>
            <select
              id={`${projectId}-ownerUpdateChannel`}
              name="ownerUpdateChannel"
              defaultValue={registry.project.ownerUpdateChannel}
              className="border-input bg-background h-8 w-full rounded-md border px-2 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
            >
              <option value="compass">Compass portal</option>
              <option value="telegram">Compass + Telegram intake</option>
              <option value="email">Compass + email digest</option>
            </select>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor={`${projectId}-ownerUpdateCadence`}>
              Owner cadence
            </Label>
            <select
              id={`${projectId}-ownerUpdateCadence`}
              name="ownerUpdateCadence"
              defaultValue={registry.project.ownerUpdateCadence}
              className="border-input bg-background h-8 w-full rounded-md border px-2 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
            >
              <option value="daily">Daily</option>
              <option value="weekly">Weekly</option>
              <option value="milestone">Milestone only</option>
            </select>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor={`${projectId}-telegramChatId`}>
              Telegram chat/channel ID
            </Label>
            <Input
              id={`${projectId}-telegramChatId`}
              name="telegramChatId"
              defaultValue={telegramId}
              placeholder="@crew-channel or chat ID"
              className="h-8 text-sm"
            />
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3 border-t pt-4">
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              name="ownerUpdatesEnabled"
              defaultChecked={registry.project.ownerUpdatesEnabled}
              className="size-4 rounded border-input"
            />
            Owner updates enabled
          </label>

          <div className="flex items-center gap-2">
            {message && (
              <span className="text-xs text-muted-foreground">
                {message}
              </span>
            )}
            <Button type="submit" size="sm" disabled={isSaving}>
              {isSaving ? (
                <IconRefresh className="size-4 animate-spin" />
              ) : (
                <IconCloud className="size-4" />
              )}
              Save mapping
            </Button>
          </div>
        </div>
      </form>

      {links.length > 0 && (
        <div className="mt-4 border-t pt-4">
          <p className="text-xs font-medium uppercase text-muted-foreground">
            Connected sources
          </p>
          <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2">
            {links.map((link) => (
              <a
                key={link.id}
                href={link.externalUrl ?? undefined}
                target="_blank"
                rel="noreferrer"
                className="flex min-w-0 items-center justify-between gap-3 rounded-md border bg-background px-3 py-2 text-sm transition-colors hover:bg-accent"
              >
                <span className="truncate">
                  {link.label}
                  {link.externalNumber && (
                    <span className="text-muted-foreground">
                      {" "}
                      #{link.externalNumber}
                    </span>
                  )}
                </span>
                <IconExternalLink className="size-4 shrink-0 text-muted-foreground" />
              </a>
            ))}
          </div>
        </div>
      )}

      <div className="mt-4 grid grid-cols-1 gap-2 border-t pt-4 text-xs text-muted-foreground sm:grid-cols-3">
        <div className="flex items-center gap-2">
          <IconFolder className="size-3.5" />
          Google Drive is document truth.
        </div>
        <div className="flex items-center gap-2">
          <IconCalendar className="size-3.5" />
          Schedule IDs feed Compass views.
        </div>
        <div className="flex items-center gap-2">
          <IconBrandTelegram className="size-3.5" />
          Telegram can become photo intake.
        </div>
      </div>
    </section>
  )
}
