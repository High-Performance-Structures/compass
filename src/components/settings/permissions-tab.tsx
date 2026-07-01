"use client"

import * as React from "react"
import { IconLockCog, IconUsersGroup } from "@tabler/icons-react"

import {
  getPermissionAccessLevel,
  getPermissions,
  PERMISSION_ACCESS_LEVELS,
  PERMISSION_FEATURES,
  type PermissionAccessLevel,
  type PermissionFeature,
} from "@/lib/permissions"
import { USER_ROLE_OPTIONS, userRoleLabel } from "@/lib/user-roles"
import { Badge } from "@/components/ui/badge"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { cn } from "@/lib/utils"

const TEAM_OVERRIDE_CHOICES: readonly {
  readonly value: "inherit" | PermissionAccessLevel
  readonly label: string
}[] = [
  { value: "inherit", label: "Inherit role" },
  ...PERMISSION_ACCESS_LEVELS.map((level) => ({
    value: level.value,
    label: level.label,
  })),
]

function accessLevelLabel(value: PermissionAccessLevel): string {
  return (
    PERMISSION_ACCESS_LEVELS.find((level) => level.value === value)?.label ??
    "No access"
  )
}

function accessLevelClassName(value: PermissionAccessLevel): string {
  switch (value) {
    case "approve":
      return "border-emerald-700/30 bg-emerald-700/10 text-emerald-900 dark:text-emerald-200"
    case "delete":
      return "border-red-700/30 bg-red-700/10 text-red-900 dark:text-red-200"
    case "edit":
      return "border-blue-700/30 bg-blue-700/10 text-blue-900 dark:text-blue-200"
    case "view":
      return "border-stone-500/30 bg-stone-500/10 text-stone-800 dark:text-stone-200"
    case "none":
      return "border-muted bg-muted/40 text-muted-foreground"
  }
}

function groupedFeatures(): readonly {
  readonly group: string
  readonly features: readonly PermissionFeature[]
}[] {
  const groups = new Map<string, PermissionFeature[]>()

  for (const feature of PERMISSION_FEATURES) {
    const existing = groups.get(feature.group)
    if (existing) {
      existing.push(feature)
    } else {
      groups.set(feature.group, [feature])
    }
  }

  return Array.from(groups.entries()).map(([group, features]) => ({
    group,
    features,
  }))
}

function PermissionChoiceSelect({
  value,
  disabled,
}: {
  readonly value: PermissionAccessLevel
  readonly disabled?: boolean
}): React.ReactElement {
  return (
    <Select value={value} disabled={disabled}>
      <SelectTrigger className="h-8 w-[150px]">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {PERMISSION_ACCESS_LEVELS.map((level) => (
          <SelectItem key={level.value} value={level.value}>
            {level.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}

function TeamOverrideSelect(): React.ReactElement {
  return (
    <Select value="inherit" disabled>
      <SelectTrigger className="h-8 w-[150px]">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {TEAM_OVERRIDE_CHOICES.map((choice) => (
          <SelectItem key={choice.value} value={choice.value}>
            {choice.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}

function ActionsList({
  role,
  feature,
}: {
  readonly role: string
  readonly feature: PermissionFeature
}): React.ReactElement {
  const actions = getPermissions(role, feature.resource)

  if (actions.length === 0) {
    return <span className="text-xs text-muted-foreground">none</span>
  }

  return (
    <div className="flex flex-wrap gap-1">
      {actions.map((action) => (
        <Badge key={action} variant="outline" className="rounded-[4px] text-[11px]">
          {action}
        </Badge>
      ))}
    </div>
  )
}

function FeatureRow({
  feature,
  selectedRole,
}: {
  readonly feature: PermissionFeature
  readonly selectedRole: string
}): React.ReactElement {
  const accessLevel = getPermissionAccessLevel(selectedRole, feature.resource)

  return (
    <TableRow>
      <TableCell className="min-w-[230px] whitespace-normal">
        <div className="space-y-1">
          <p className="font-medium leading-tight">{feature.label}</p>
          <p className="text-xs leading-snug text-muted-foreground">
            {feature.description}
          </p>
        </div>
      </TableCell>
      <TableCell className="text-xs text-muted-foreground">
        {feature.resource}
      </TableCell>
      <TableCell>
        <Badge
          variant="outline"
          className={cn("rounded-[4px]", accessLevelClassName(accessLevel))}
        >
          {accessLevelLabel(accessLevel)}
        </Badge>
      </TableCell>
      <TableCell>
        <PermissionChoiceSelect value={accessLevel} disabled />
      </TableCell>
      <TableCell>
        <ActionsList role={selectedRole} feature={feature} />
      </TableCell>
      <TableCell>
        <TeamOverrideSelect />
      </TableCell>
    </TableRow>
  )
}

export function PermissionsTab(): React.ReactElement {
  const [selectedRole, setSelectedRole] = React.useState("admin")
  const featureGroups = React.useMemo(() => groupedFeatures(), [])

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 border-b pb-4 lg:flex-row lg:items-end lg:justify-between">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <IconLockCog className="size-5 text-primary" stroke={1.5} />
            <h2 className="text-lg font-semibold">Permission Matrix</h2>
          </div>
          <p className="max-w-3xl text-sm text-muted-foreground">
            Baseline Compass feature access by role. Team overrides are shown as
            the next configuration layer and currently inherit role access.
          </p>
        </div>

        <div className="flex flex-col gap-1.5">
          <span className="text-xs font-medium text-muted-foreground">
            Review role
          </span>
          <Select value={selectedRole} onValueChange={setSelectedRole}>
            <SelectTrigger className="w-[260px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent className="max-h-[360px]">
              {USER_ROLE_OPTIONS.map((role) => (
                <SelectItem key={role.value} value={role.value}>
                  {role.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="grid gap-3 lg:grid-cols-[1fr_300px]">
        <div className="rounded-md border bg-background">
          <div className="border-b px-3 py-2">
            <p className="text-sm font-medium">
              {userRoleLabel(selectedRole)} baseline
            </p>
            <p className="text-xs text-muted-foreground">
              Choices are read-only until permission overrides are persisted.
            </p>
          </div>
          <div className="max-h-[68vh] overflow-auto">
            <Table>
              <TableHeader className="sticky top-0 z-10 bg-background">
                <TableRow>
                  <TableHead>Feature</TableHead>
                  <TableHead>Resource</TableHead>
                  <TableHead>Level</TableHead>
                  <TableHead>Role choice</TableHead>
                  <TableHead>Current actions</TableHead>
                  <TableHead>Team override</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {featureGroups.map((group) => (
                  <React.Fragment key={group.group}>
                    <TableRow className="bg-muted/45 hover:bg-muted/45">
                      <TableCell
                        colSpan={6}
                        className="py-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground"
                      >
                        {group.group}
                      </TableCell>
                    </TableRow>
                    {group.features.map((feature) => (
                      <FeatureRow
                        key={feature.id}
                        feature={feature}
                        selectedRole={selectedRole}
                      />
                    ))}
                  </React.Fragment>
                ))}
              </TableBody>
            </Table>
          </div>
        </div>

        <aside className="space-y-3 rounded-md border p-4">
          <div className="flex items-center gap-2">
            <IconUsersGroup className="size-4 text-primary" stroke={1.5} />
            <h3 className="text-sm font-semibold">Team Overrides</h3>
          </div>
          <p className="text-sm text-muted-foreground">
            Team-based permissions should sit on top of role access. The safest
            default is “inherit role,” then explicit overrides for a team where
            the work requires it.
          </p>
          <div className="space-y-2 text-sm">
            {TEAM_OVERRIDE_CHOICES.map((choice) => (
              <div
                key={choice.value}
                className="flex items-center justify-between gap-2 border-b py-1.5 last:border-b-0"
              >
                <span>{choice.label}</span>
                <Badge variant="outline" className="rounded-[4px]">
                  {choice.value}
                </Badge>
              </div>
            ))}
          </div>
          <p className="text-xs text-muted-foreground">
            Next build step: add saved role and team override records so these
            selectors become editable admin controls.
          </p>
        </aside>
      </div>
    </div>
  )
}
