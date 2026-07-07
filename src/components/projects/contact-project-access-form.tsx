"use client"

import * as React from "react"
import { toast } from "sonner"

import {
  getDirectoryContactProjectAccess,
  updateDirectoryContactProjectAccess,
  type DirectoryContactKind,
  type DirectoryContactProjectAccessItem,
} from "@/app/actions/project-contacts"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"

export function ContactProjectAccessForm({
  sourceEntityType,
  sourceEntityId,
  enabled,
}: {
  readonly sourceEntityType: DirectoryContactKind
  readonly sourceEntityId: string | null
  readonly enabled: boolean
}): React.ReactElement | null {
  const [items, setItems] = React.useState<
    readonly DirectoryContactProjectAccessItem[]
  >([])
  const [selected, setSelected] = React.useState<ReadonlySet<string>>(new Set())
  const [query, setQuery] = React.useState("")
  const [loading, setLoading] = React.useState(false)
  const [saving, setSaving] = React.useState(false)

  React.useEffect(() => {
    if (!enabled || !sourceEntityId) return

    let cancelled = false
    const activeSourceEntityId = sourceEntityId
    async function loadAccess(): Promise<void> {
      setLoading(true)
      const result = await getDirectoryContactProjectAccess(
        sourceEntityType,
        activeSourceEntityId
      )

      if (cancelled) return
      if (result.success) {
        setItems(result.items)
        setSelected(
          new Set(
            result.items
              .filter((item) => item.assigned)
              .map((item) => item.projectId)
          )
        )
      } else {
        toast.error(result.error)
      }
      setLoading(false)
    }

    loadAccess()
    return () => {
      cancelled = true
    }
  }, [enabled, sourceEntityId, sourceEntityType])

  if (!sourceEntityId) return null

  const normalizedQuery = query.trim().toLowerCase()
  const visibleItems = items.filter((item) => {
    if (!normalizedQuery) return true
    return [item.projectNumber, item.projectName]
      .filter(Boolean)
      .some((value) => value?.toLowerCase().includes(normalizedQuery))
  })

  const toggleProject = (projectId: string, checked: boolean): void => {
    const next = new Set(selected)
    if (checked) {
      next.add(projectId)
    } else {
      next.delete(projectId)
    }
    setSelected(next)
  }

  const handleSave = async (): Promise<void> => {
    setSaving(true)

    const formData = new FormData()
    formData.set("sourceEntityType", sourceEntityType)
    formData.set("sourceEntityId", sourceEntityId)
    for (const projectId of selected) {
      formData.append("projectId", projectId)
    }

    const result = await updateDirectoryContactProjectAccess(formData)
    setSaving(false)
    if (result.success) {
      toast.success("Project access updated")
    } else {
      toast.error(result.error)
    }
  }

  return (
    <div className="space-y-3 border-t pt-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <Label className="text-xs font-medium">Project Access</Label>
          <p className="mt-1 text-xs text-muted-foreground">
            Select the projects this contact should be assigned to.
          </p>
        </div>
        <Button
          type="button"
          size="sm"
          disabled={loading || saving}
          onClick={handleSave}
        >
          {saving ? "Saving..." : "Save Access"}
        </Button>
      </div>

      <Input
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        placeholder="Search projects..."
        className="h-8"
      />

      <div className="max-h-56 overflow-y-auto rounded-md border">
        {loading ? (
          <p className="p-3 text-sm text-muted-foreground">
            Loading project access...
          </p>
        ) : visibleItems.length > 0 ? (
          <div className="divide-y">
            {visibleItems.map((item) => (
              <label
                key={item.projectId}
                className="flex cursor-pointer items-start gap-3 px-3 py-2.5 hover:bg-muted/50"
              >
                <Checkbox
                  checked={selected.has(item.projectId)}
                  onCheckedChange={(checked) =>
                    toggleProject(item.projectId, checked === true)
                  }
                  aria-label={`Assign ${item.projectName}`}
                  className="mt-0.5"
                />
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-medium">
                    {item.projectNumber ?? "No number"}
                  </span>
                  <span className="block truncate text-xs text-muted-foreground">
                    {item.projectName}
                  </span>
                </span>
              </label>
            ))}
          </div>
        ) : (
          <p className="p-3 text-sm text-muted-foreground">
            No projects match that search.
          </p>
        )}
      </div>
    </div>
  )
}
