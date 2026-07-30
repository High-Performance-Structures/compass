"use client"

import * as React from "react"
import {
  IconExternalLink,
  IconLink,
  IconPlus,
  IconTrash,
} from "@tabler/icons-react"
import { toast } from "sonner"

import {
  createScheduleTaskLink,
  deleteScheduleTaskLink,
  getScheduleTaskLinks,
  type ScheduleTaskLink,
} from "@/app/actions/schedule-links"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import type { ScheduleLinkType } from "@/lib/schedule/links"

const LINK_TYPES: readonly {
  readonly value: ScheduleLinkType
  readonly label: string
}[] = [
  { value: "file", label: "File" },
  { value: "rfi", label: "RFI" },
  { value: "conversation", label: "Conversation" },
  { value: "todo", label: "To-do" },
]

function typeLabel(value: ScheduleLinkType): string {
  return LINK_TYPES.find((option) => option.value === value)?.label ?? value
}

export function ScheduleItemLinks({
  taskId,
}: {
  readonly taskId: string
}): React.ReactElement {
  const [links, setLinks] = React.useState<readonly ScheduleTaskLink[]>([])
  const [resourceType, setResourceType] =
    React.useState<ScheduleLinkType>("file")
  const [label, setLabel] = React.useState("")
  const [href, setHref] = React.useState("")
  const [loading, setLoading] = React.useState(true)
  const [saving, setSaving] = React.useState(false)

  const loadLinks = React.useCallback(async (): Promise<void> => {
    setLoading(true)
    try {
      setLinks(await getScheduleTaskLinks(taskId))
    } catch {
      toast.error("Unable to load linked records.")
    } finally {
      setLoading(false)
    }
  }, [taskId])

  React.useEffect(() => {
    void loadLinks()
  }, [loadLinks])

  async function addLink(): Promise<void> {
    setSaving(true)
    const result = await createScheduleTaskLink({
      taskId,
      resourceType,
      label,
      href,
    })
    setSaving(false)
    if (!result.success) {
      toast.error(result.error)
      return
    }
    setLabel("")
    setHref("")
    toast.success("Operational link added.")
    await loadLinks()
  }

  async function removeLink(linkId: string): Promise<void> {
    const result = await deleteScheduleTaskLink(linkId)
    if (!result.success) {
      toast.error(result.error)
      return
    }
    setLinks((current) => current.filter((link) => link.id !== linkId))
    toast.success("Link removed.")
  }

  return (
    <div className="border-t pt-4">
      <div className="flex items-center gap-2">
        <IconLink className="size-4 text-muted-foreground" />
        <p className="text-xs font-medium">Operational links</p>
      </div>
      <p className="mt-1 text-[11px] text-muted-foreground">
        Keep the file, RFI, conversation, or to-do used to complete this work
        beside the schedule item.
      </p>

      <div className="mt-3 space-y-2">
        {loading ? (
          <p className="text-xs text-muted-foreground">Loading links…</p>
        ) : links.length === 0 ? (
          <p className="text-xs text-muted-foreground">
            No operational records linked yet.
          </p>
        ) : (
          links.map((link) => (
            <div
              key={link.id}
              className="grid grid-cols-[5rem_minmax(0,1fr)_auto_auto] items-center gap-2 border-b py-2 last:border-b-0"
            >
              <span className="text-[11px] font-medium uppercase text-muted-foreground">
                {typeLabel(link.resourceType)}
              </span>
              <span className="truncate text-xs">{link.label}</span>
              <Button variant="ghost" size="icon" asChild>
                <a
                  href={link.href}
                  target={link.href.startsWith("https://") ? "_blank" : undefined}
                  rel={link.href.startsWith("https://") ? "noreferrer" : undefined}
                  aria-label={`Open ${link.label}`}
                >
                  <IconExternalLink className="size-4" />
                </a>
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                aria-label={`Remove ${link.label}`}
                onClick={() => void removeLink(link.id)}
              >
                <IconTrash className="size-4" />
              </Button>
            </div>
          ))
        )}
      </div>

      <div className="mt-3 grid gap-2 sm:grid-cols-[8rem_minmax(0,1fr)]">
        <Select
          value={resourceType}
          onValueChange={(value) => {
            if (
              value === "file" ||
              value === "rfi" ||
              value === "conversation" ||
              value === "todo"
            ) {
              setResourceType(value)
            }
          }}
        >
          <SelectTrigger className="h-9">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {LINK_TYPES.map((option) => (
              <SelectItem key={option.value} value={option.value}>
                {option.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Input
          className="h-9"
          value={label}
          onChange={(event) => setLabel(event.target.value)}
          placeholder="Link label"
        />
        <Input
          className="h-9 sm:col-span-2"
          value={href}
          onChange={(event) => setHref(event.target.value)}
          placeholder="Paste a Compass dashboard or secure https:// link"
        />
      </div>
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="mt-2"
        disabled={saving || !label.trim() || !href.trim()}
        onClick={() => void addLink()}
      >
        <IconPlus className="size-4" />
        {saving ? "Adding…" : "Add link"}
      </Button>
    </div>
  )
}
