"use client"

import { Avatar, AvatarFallback, AvatarGroup, AvatarGroupCount } from "@/components/ui/avatar"
import { compactAssigneeLabel } from "@/lib/schedule/assignees"

/** Avatars shown before the rest collapse into "+N". */
const VISIBLE_AVATARS = 3

function initials(name: string): string {
  return name
    .split(" ")
    .map((word) => word[0] ?? "")
    .join("")
    .slice(0, 2)
    .toUpperCase()
}

/**
 * Everyone assigned to a schedule item, compactly: up to three initials
 * avatars, "+N" for the rest, and the first name with "+N" beside them. The
 * full list is the accessible name and the hover title.
 */
export function ScheduleAssigneeStack({ names }: { readonly names: readonly string[] }) {
  if (names.length === 0) return <span className="text-xs text-muted-foreground">-</span>
  const hidden = names.length - VISIBLE_AVATARS
  const everyone = names.join(", ")
  return (
    <div className="flex items-center gap-1.5" title={everyone} aria-label={`Responsible: ${everyone}`}>
      <AvatarGroup aria-hidden="true">
        {names.slice(0, VISIBLE_AVATARS).map((name) => (
          <Avatar key={name} size="sm">
            <AvatarFallback className="bg-primary/10 text-primary font-medium">{initials(name)}</AvatarFallback>
          </Avatar>
        ))}
        {hidden > 0 && <AvatarGroupCount className="text-xs">+{hidden}</AvatarGroupCount>}
      </AvatarGroup>
      <span className="text-xs text-muted-foreground truncate max-w-[110px]" aria-hidden="true">
        {compactAssigneeLabel(names)}
      </span>
    </div>
  )
}
