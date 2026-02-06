"use client"

import * as React from "react"
import {
  Download,
  Trash2,
  ChevronDown,
  ChevronRight,
  Loader2,
} from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import { Badge } from "@/components/ui/badge"
import { Separator } from "@/components/ui/separator"
import {
  installSkill,
  uninstallSkill,
  toggleSkill,
  getInstalledSkills,
} from "@/app/actions/plugins"

interface InstalledSkill {
  readonly id: string
  readonly name: string
  readonly description: string | null
  readonly source: string
  readonly status: string
  readonly installedAt: string
  readonly contentPreview: string | null
}

function SkillCard({
  skill,
  onToggle,
  onDelete,
}: {
  readonly skill: InstalledSkill
  readonly onToggle: (id: string, enabled: boolean) => void
  readonly onDelete: (id: string) => void
}) {
  const [expanded, setExpanded] = React.useState(false)
  const enabled = skill.status === "enabled"

  return (
    <div className="rounded-md border p-3 space-y-2">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium">
              {skill.name}
            </span>
            <Badge
              variant={enabled ? "default" : "secondary"}
              className="text-[10px] px-1.5 py-0"
            >
              {enabled ? "enabled" : "disabled"}
            </Badge>
          </div>
          {skill.description && (
            <p className="text-muted-foreground text-xs mt-0.5">
              {skill.description}
            </p>
          )}
          <p className="text-muted-foreground text-[10px] mt-1">
            {skill.source}
          </p>
        </div>
        <div className="flex items-center gap-1 shrink-0">
          <Switch
            checked={enabled}
            onCheckedChange={(checked) =>
              onToggle(skill.id, checked)
            }
            className="scale-90"
          />
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7 text-destructive hover:text-destructive"
            onClick={() => onDelete(skill.id)}
            title="Uninstall"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>

      {skill.contentPreview && (
        <button
          type="button"
          className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
          onClick={() => setExpanded((v) => !v)}
        >
          {expanded ? (
            <ChevronDown className="h-3 w-3" />
          ) : (
            <ChevronRight className="h-3 w-3" />
          )}
          {expanded ? "Hide content" : "Show content"}
        </button>
      )}

      {expanded && skill.contentPreview && (
        <pre className="text-[11px] bg-muted rounded p-2 overflow-x-auto max-h-48 whitespace-pre-wrap">
          {skill.contentPreview}
        </pre>
      )}
    </div>
  )
}

export function SkillsTab() {
  const [skills, setSkills] = React.useState<
    ReadonlyArray<InstalledSkill>
  >([])
  const [loading, setLoading] = React.useState(true)
  const [source, setSource] = React.useState("")
  const [installing, setInstalling] = React.useState(false)

  const loadSkills = React.useCallback(async () => {
    const result = await getInstalledSkills()
    if (result.success) {
      setSkills(result.skills)
    }
    setLoading(false)
  }, [])

  React.useEffect(() => {
    loadSkills()
  }, [loadSkills])

  const handleInstall = async () => {
    const trimmed = source.trim()
    if (!trimmed) return

    setInstalling(true)
    const result = await installSkill(trimmed)
    setInstalling(false)

    if (result.success) {
      toast.success(`Installed "${result.plugin.name}"`)
      setSource("")
      loadSkills()
    } else {
      toast.error(result.error)
    }
  }

  const handleToggle = async (
    id: string,
    enabled: boolean,
  ) => {
    setSkills((prev) =>
      prev.map((s) =>
        s.id === id
          ? { ...s, status: enabled ? "enabled" : "disabled" }
          : s,
      ),
    )

    const result = await toggleSkill(id, enabled)
    if (!result.success) {
      setSkills((prev) =>
        prev.map((s) =>
          s.id === id
            ? {
                ...s,
                status: enabled ? "disabled" : "enabled",
              }
            : s,
        ),
      )
      toast.error(result.error)
    }
  }

  const handleDelete = async (id: string) => {
    const prev = skills
    setSkills((s) => s.filter((item) => item.id !== id))

    const result = await uninstallSkill(id)
    if (result.success) {
      toast.success("Skill uninstalled")
    } else {
      setSkills(prev)
      toast.error(result.error)
    }
  }

  return (
    <div className="space-y-3">
      <div className="space-y-1.5">
        <Label className="text-xs">Install from GitHub</Label>
        <p className="text-muted-foreground text-xs">
          Enter a GitHub path like{" "}
          <code className="text-[10px]">owner/repo/skill-name</code>{" "}
          or <code className="text-[10px]">owner/repo</code>
        </p>
        <div className="flex gap-2">
          <Input
            value={source}
            onChange={(e) => setSource(e.target.value)}
            placeholder="owner/repo/skill-name"
            className="h-9 text-sm"
            onKeyDown={(e) => {
              if (e.key === "Enter") handleInstall()
            }}
            disabled={installing}
          />
          <Button
            size="sm"
            className="h-9 shrink-0"
            onClick={handleInstall}
            disabled={installing || !source.trim()}
          >
            {installing ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Download className="h-3.5 w-3.5" />
            )}
            <span className="ml-1.5">Install</span>
          </Button>
        </div>
      </div>

      <Separator />

      <div className="space-y-1.5">
        <Label className="text-xs">Installed Skills</Label>
        {loading ? (
          <div className="space-y-3 pt-1">
            <div className="bg-muted h-4 w-48 animate-pulse rounded" />
            <div className="bg-muted h-4 w-64 animate-pulse rounded" />
          </div>
        ) : skills.length === 0 ? (
          <p className="text-muted-foreground text-xs py-2">
            No skills installed yet. Skills augment Slab with
            specialized knowledge from the skills.sh ecosystem.
          </p>
        ) : (
          <div className="space-y-2">
            {skills.map((skill) => (
              <SkillCard
                key={skill.id}
                skill={skill}
                onToggle={handleToggle}
                onDelete={handleDelete}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
