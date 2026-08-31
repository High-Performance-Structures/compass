"use client"

import * as React from "react"
import { IconLockCog, IconUsersGroup } from "@tabler/icons-react"

import {
  getPermissionOverrideContext,
  updateRolePermissionOverride,
  updateTeamPermissionOverride,
  type PermissionOverrideChoice,
  type PermissionTeamOption,
  type TeamPermissionOverrideChoice,
} from "@/app/actions/permission-overrides"
import {
  accessLevelToFeatureActions,
  getPermissionFeatureAccessLevel,
  PERMISSION_ACCESS_LEVELS,
  PERMISSION_FEATURES,
  type PermissionAccessLevel,
  type PermissionFeature,
} from "@/lib/permissions"
import { USER_ROLE_OPTIONS, userRoleLabel } from "@/lib/user-roles"
import { Badge } from "@/components/ui/badge"
import { useDeveloperMode } from "@/components/developer-mode-provider"
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

const ROLE_BASELINE = "baseline"
const TEAM_INHERIT = "inherit"

const ROLE_CHOICE_OPTIONS: readonly {
  readonly value: typeof ROLE_BASELINE | PermissionAccessLevel
  readonly label: string
}[] = [
  { value: ROLE_BASELINE, label: "Use baseline" },
  ...PERMISSION_ACCESS_LEVELS.map((level) => ({
    value: level.value,
    label: level.label,
  })),
]

const TEAM_OVERRIDE_CHOICES: readonly {
  readonly value: typeof TEAM_INHERIT | PermissionAccessLevel
  readonly label: string
}[] = [
  { value: TEAM_INHERIT, label: "Inherit role" },
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
  onChange,
}: {
  readonly value: typeof ROLE_BASELINE | PermissionAccessLevel
  readonly disabled: boolean
  readonly onChange: (
    value: typeof ROLE_BASELINE | PermissionAccessLevel
  ) => void
}): React.ReactElement {
  return (
    <Select value={value} disabled={disabled} onValueChange={onChange}>
      <SelectTrigger className="h-8 w-[150px]">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {ROLE_CHOICE_OPTIONS.map((option) => (
          <SelectItem key={option.value} value={option.value}>
            {option.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}

function TeamOverrideSelect({
  value,
  disabled,
  onChange,
}: {
  readonly value: typeof TEAM_INHERIT | PermissionAccessLevel
  readonly disabled: boolean
  readonly onChange: (
    value: typeof TEAM_INHERIT | PermissionAccessLevel
  ) => void
}): React.ReactElement {
  return (
    <Select value={value} disabled={disabled} onValueChange={onChange}>
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
  featureId,
  accessLevel,
}: {
  readonly featureId: string
  readonly accessLevel: PermissionAccessLevel
}): React.ReactElement {
  const actions = accessLevelToFeatureActions(featureId, accessLevel)

  if (actions.length === 0) {
    return <span className="text-xs text-muted-foreground">none</span>
  }

  return (
    <div className="flex flex-wrap gap-1">
      {actions.map((action) => (
        <Badge
          key={action}
          variant="outline"
          className="rounded-[4px] text-[11px]"
        >
          {action}
        </Badge>
      ))}
    </div>
  )
}

function FeatureRow({
  feature,
  selectedRole,
  roleOverride,
  teamOverride,
  selectedTeamId,
  canManage,
  onRoleChange,
  onTeamChange,
  showInternalDetails,
}: {
  readonly feature: PermissionFeature
  readonly selectedRole: string
  readonly roleOverride: PermissionOverrideChoice | null
  readonly teamOverride: TeamPermissionOverrideChoice | null
  readonly selectedTeamId: string
  readonly canManage: boolean
  readonly onRoleChange: (
    feature: PermissionFeature,
    value: typeof ROLE_BASELINE | PermissionAccessLevel
  ) => void
  readonly onTeamChange: (
    feature: PermissionFeature,
    value: typeof TEAM_INHERIT | PermissionAccessLevel
  ) => void
  readonly showInternalDetails: boolean
}): React.ReactElement {
  const baselineLevel = getPermissionFeatureAccessLevel(selectedRole, feature.id)
  const accessLevel = roleOverride?.accessLevel ?? baselineLevel
  const roleChoice = roleOverride?.accessLevel ?? ROLE_BASELINE
  const teamChoice = teamOverride?.accessLevel ?? TEAM_INHERIT
  const hasRoleOverride = roleOverride !== null
  const hasTeamOverride = teamOverride !== null

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
      {showInternalDetails && (
        <TableCell className="text-xs text-muted-foreground">
          {feature.resource}
        </TableCell>
      )}
      <TableCell>
        <Badge
          variant="outline"
          className={cn("rounded-[4px]", accessLevelClassName(accessLevel))}
        >
          {accessLevelLabel(accessLevel)}
        </Badge>
        {hasRoleOverride && (
          <p className="mt-1 text-[11px] text-muted-foreground">
            role override
          </p>
        )}
      </TableCell>
      <TableCell>
        <PermissionChoiceSelect
          value={roleChoice}
          disabled={!canManage}
          onChange={(value) => onRoleChange(feature, value)}
        />
      </TableCell>
      {showInternalDetails && (
        <TableCell>
          <ActionsList featureId={feature.id} accessLevel={accessLevel} />
        </TableCell>
      )}
      <TableCell>
        <TeamOverrideSelect
          value={teamChoice}
          disabled={!canManage || selectedTeamId.length === 0}
          onChange={(value) => onTeamChange(feature, value)}
        />
        {hasTeamOverride && (
          <p className="mt-1 text-[11px] text-muted-foreground">
            team override
          </p>
        )}
      </TableCell>
    </TableRow>
  )
}

export function PermissionsTab(): React.ReactElement {
  const { developerModeEnabled } = useDeveloperMode()
  const [selectedRole, setSelectedRole] = React.useState("admin")
  const [demoMode, setDemoMode] = React.useState(false)
  const [canManagePermissions, setCanManagePermissions] = React.useState(false)
  const [roleOverrides, setRoleOverrides] = React.useState<
    readonly PermissionOverrideChoice[]
  >([])
  const [teamOverrides, setTeamOverrides] = React.useState<
    readonly TeamPermissionOverrideChoice[]
  >([])
  const [teams, setTeams] = React.useState<readonly PermissionTeamOption[]>([])
  const [selectedTeamId, setSelectedTeamId] = React.useState("")
  const [pendingKey, setPendingKey] = React.useState<string | null>(null)
  const [statusMessage, setStatusMessage] = React.useState<string | null>(null)
  const featureGroups = React.useMemo(() => groupedFeatures(), [])
  const canEditMatrix = canManagePermissions && !demoMode

  const refreshOverrides = React.useCallback(() => {
    getPermissionOverrideContext()
      .then((context) => {
        setDemoMode(context.demoMode)
        setCanManagePermissions(context.canManagePermissions)
        setRoleOverrides(context.roleOverrides)
        setTeamOverrides(context.teamOverrides)
        setTeams(context.teams)
        setSelectedTeamId((currentTeamId) => {
          if (
            currentTeamId.length > 0 &&
            context.teams.some((team) => team.id === currentTeamId)
          ) {
            return currentTeamId
          }

          return context.teams[0]?.id ?? ""
        })
      })
      .catch(() => {
        setStatusMessage("Unable to load saved permission overrides.")
      })
  }, [])

  React.useEffect(() => {
    refreshOverrides()
  }, [refreshOverrides])

  const roleOverrideMap = React.useMemo(() => {
    const map = new Map<string, PermissionOverrideChoice>()
    for (const override of roleOverrides) {
      if (override.role === selectedRole) {
        map.set(override.featureId, override)
      }
    }
    return map
  }, [roleOverrides, selectedRole])

  const teamOverrideMap = React.useMemo(() => {
    const map = new Map<string, TeamPermissionOverrideChoice>()
    for (const override of teamOverrides) {
      if (override.teamId === selectedTeamId) {
        map.set(override.featureId, override)
      }
    }
    return map
  }, [selectedTeamId, teamOverrides])

  async function handleRoleChange(
    feature: PermissionFeature,
    value: typeof ROLE_BASELINE | PermissionAccessLevel
  ): Promise<void> {
    if (!canEditMatrix) return

    const key = `role:${selectedRole}:${feature.id}`
    setPendingKey(key)
    setStatusMessage(null)

    const result = await updateRolePermissionOverride({
      role: selectedRole,
      featureId: feature.id,
      accessLevel: value,
    })

    if (result.success) {
      setStatusMessage(`${feature.label} role permission saved.`)
      refreshOverrides()
    } else {
      setStatusMessage(result.error)
    }

    setPendingKey(null)
  }

  async function handleTeamChange(
    feature: PermissionFeature,
    value: typeof TEAM_INHERIT | PermissionAccessLevel
  ): Promise<void> {
    if (!canEditMatrix || selectedTeamId.length === 0) return

    const key = `team:${selectedTeamId}:${feature.id}`
    setPendingKey(key)
    setStatusMessage(null)

    const result = await updateTeamPermissionOverride({
      teamId: selectedTeamId,
      featureId: feature.id,
      accessLevel: value,
    })

    if (result.success) {
      setStatusMessage(`${feature.label} team permission saved.`)
      refreshOverrides()
    } else {
      setStatusMessage(result.error)
    }

    setPendingKey(null)
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 border-b pb-4 lg:flex-row lg:items-end lg:justify-between">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <IconLockCog className="size-5 text-primary" stroke={1.5} />
            <h2 className="text-lg font-semibold">Permission Matrix</h2>
            {demoMode && (
              <Badge variant="outline" className="rounded-[4px]">
                Demo review only
              </Badge>
            )}
          </div>
          <p className="max-w-3xl text-sm text-muted-foreground">
            Baseline Compass feature access by role, with saved role and team
            overrides layered on top. New features appear here when they are
            added to Compass&apos;s permission registry.
          </p>
          {demoMode && (
            <p className="max-w-3xl text-sm font-medium text-amber-800 dark:text-amber-200">
              Demo mode cannot save permission changes or modify role/team
              access. This matrix is only a preview of the permission model.
            </p>
          )}
          {statusMessage && (
            <p className="rounded-md border bg-muted/35 px-3 py-2 text-sm text-muted-foreground">
              {statusMessage}
            </p>
          )}
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
              {canEditMatrix
                ? "Choose a saved override or reset a feature to its baseline."
                : "Choices are read-only for this workspace or account."}
            </p>
          </div>
          <div className="max-h-[68vh] overflow-auto">
            <Table>
              <TableHeader className="sticky top-0 z-10 bg-background">
                <TableRow>
                  <TableHead>Feature</TableHead>
                  {developerModeEnabled && <TableHead>Resource</TableHead>}
                  <TableHead>Level</TableHead>
                  <TableHead>Role choice</TableHead>
                  {developerModeEnabled && <TableHead>Current actions</TableHead>}
                  <TableHead>Team override</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {featureGroups.map((group) => (
                  <React.Fragment key={group.group}>
                    <TableRow className="bg-muted/45 hover:bg-muted/45">
                      <TableCell
                        colSpan={developerModeEnabled ? 6 : 4}
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
                        roleOverride={roleOverrideMap.get(feature.id) ?? null}
                        teamOverride={teamOverrideMap.get(feature.id) ?? null}
                        selectedTeamId={selectedTeamId}
                        canManage={
                          canEditMatrix &&
                          pendingKey !== `role:${selectedRole}:${feature.id}` &&
                          pendingKey !== `team:${selectedTeamId}:${feature.id}`
                        }
                        onRoleChange={handleRoleChange}
                        onTeamChange={handleTeamChange}
                        showInternalDetails={developerModeEnabled}
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
            Team-based permissions sit on top of role access. The safest
            default is “inherit role,” then explicit overrides for a team where
            the work requires it.
          </p>
          <div className="space-y-1.5">
            <span className="text-xs font-medium text-muted-foreground">
              Review team
            </span>
            <Select
              value={selectedTeamId}
              onValueChange={setSelectedTeamId}
              disabled={teams.length === 0}
            >
              <SelectTrigger className="w-full">
                <SelectValue placeholder="No teams yet" />
              </SelectTrigger>
              <SelectContent className="max-h-[320px]">
                {teams.map((team) => (
                  <SelectItem key={team.id} value={team.id}>
                    {team.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
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
            {demoMode
              ? "Demo mode keeps this page read-only. Saved role and team overrides are only editable outside the demo workspace."
              : "Role overrides apply to everyone with that role. Team overrides can narrow or expand access for people in a specific team."}
          </p>
        </aside>
      </div>
    </div>
  )
}
