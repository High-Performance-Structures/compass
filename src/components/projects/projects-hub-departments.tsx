"use client"

// Department visuals for the Projects page: the department tiles built from
// the company's department profiles, the logo/icon mark, and the large
// department buttons at the top of the page.

import * as React from "react"
import {
  IconBuildingCommunity,
  IconFolder,
  IconHome,
  IconPaint,
  IconTool,
} from "@tabler/icons-react"
import { cn } from "@/lib/utils"
import type { ProjectDepartment } from "@/lib/project-branding"
import { DEPARTMENT_CODES, departmentLogoSrc, type DepartmentProfiles } from "@/lib/department-profiles"
import {
  type DepartmentConfig,
  type DepartmentGroup,
  departmentRingClassName,
  departmentSurfaceClassName,
  countByStatusBucket,
} from "./projects-hub-model"

const DEPARTMENT_LOOK: Readonly<Record<ProjectDepartment, { readonly accentClassName: string; readonly icon: React.ReactNode }>> = {
  O: { accentClassName: "border-brand-orc-brown bg-brand-orc-brown text-white", icon: <IconHome className="size-4" /> },
  H: { accentClassName: "border-brand-hps-primary bg-brand-hps-primary text-white", icon: <IconBuildingCommunity className="size-4" /> },
  N: { accentClassName: "border-brand-nutech-gold bg-brand-nutech-gold text-white", icon: <IconTool className="size-4" /> },
  D: { accentClassName: "border-brand-orc-brown bg-brand-orc-brown text-white", icon: <IconPaint className="size-4" /> },
}

/** Department tiles from the company's department profiles (names, descriptions, logos). */
export function departmentConfigs(profiles: DepartmentProfiles): readonly DepartmentConfig[] {
  return [
    ...DEPARTMENT_CODES.map((code): DepartmentConfig => ({
      id: code,
      label: `${profiles[code].shortName} Projects`,
      shortLabel: profiles[code].shortName,
      description: profiles[code].description,
      logoSrc: departmentLogoSrc(code, profiles[code]),
      ...DEPARTMENT_LOOK[code],
    })),
    {
      id: "UNASSIGNED",
      label: "Unassigned",
      shortLabel: "Other",
      description: "Projects that still need a department project number.",
      accentClassName: "border-muted-foreground/25 bg-muted text-muted-foreground",
      logoSrc: null,
      icon: <IconFolder className="size-4" />,
    },
  ]
}

export function DepartmentMark({
  department,
  size = "md",
}: {
  readonly department: DepartmentConfig
  readonly size?: "sm" | "md"
}): React.ReactElement {
  const sizeClassName = size === "sm" ? "size-7" : "size-8"

  if (department.logoSrc) {
    return (
      <span
        className={cn(
          "inline-flex items-center justify-center overflow-hidden rounded-[4px] border bg-background shadow-sm",
          sizeClassName
        )}
      >
        <img
          src={department.logoSrc}
          alt={`${department.shortLabel} logo`}
          className="size-full object-contain p-0.5"
        />
      </span>
    )
  }

  return (
    <span
      className={cn(
        "inline-flex items-center justify-center rounded-[4px] border shadow-sm",
        sizeClassName,
        department.accentClassName
      )}
    >
      {department.icon}
    </span>
  )
}

export function DepartmentButton({
  group,
  active,
  onClick,
}: {
  readonly group: DepartmentGroup
  readonly active: boolean
  readonly onClick: () => void
}): React.ReactElement {
  const activeCount = countByStatusBucket(group.allProjects, "active")
  const warrantyCount = countByStatusBucket(group.allProjects, "warranty")
  const completeCount = countByStatusBucket(group.allProjects, "complete")

  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "group flex min-h-[11rem] flex-col rounded-lg border p-4 text-left shadow-sm transition-colors hover:border-foreground/20 hover:shadow-md",
        departmentSurfaceClassName(group.id),
        active
          ? cn(
              "ring-2 ring-offset-2 ring-offset-background",
              departmentRingClassName(group.id)
            )
          : "text-foreground"
      )}
    >
      <span className="flex items-start justify-between gap-3">
        <span className="flex min-w-0 items-center gap-3">
          <DepartmentMark department={group} />
          <span>
            <span className="block text-base font-semibold">
              {group.shortLabel}
            </span>
            <span className="text-xs text-muted-foreground">
              {group.label}
            </span>
          </span>
        </span>
        <span className="rounded-md border bg-background/80 px-2 py-1 text-sm font-semibold tabular-nums">
          {activeCount}
          <span className="ml-1 text-xs font-medium text-muted-foreground">
            active
          </span>
        </span>
      </span>
      <span className="mt-4 block text-sm leading-6 text-muted-foreground">
        {group.description}
      </span>
      <span className="mt-auto grid grid-cols-3 gap-2 pt-4 text-center text-xs">
        <span className="rounded-md border bg-background/70 px-2 py-1.5">
          <span className="block font-semibold tabular-nums">
            {group.allProjects.length}
          </span>
          <span className="text-muted-foreground">Total</span>
        </span>
        <span className="rounded-md border bg-background/70 px-2 py-1.5">
          <span className="block font-semibold tabular-nums">
            {warrantyCount}
          </span>
          <span className="text-muted-foreground">Warranty</span>
        </span>
        <span className="rounded-md border bg-background/70 px-2 py-1.5">
          <span className="block font-semibold tabular-nums">
            {completeCount}
          </span>
          <span className="text-muted-foreground">Complete</span>
        </span>
      </span>
    </button>
  )
}
