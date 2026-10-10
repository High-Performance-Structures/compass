"use client"

import * as React from "react"
import { DEFAULT_DEPARTMENT_PROFILES, type DepartmentProfiles } from "@/lib/department-profiles"

const DepartmentProfilesContext = React.createContext<DepartmentProfiles>(DEFAULT_DEPARTMENT_PROFILES)

/** Shares the company's department profiles with client components (logos, names, contact lines). */
export function DepartmentProfilesProvider({
  profiles,
  children,
}: {
  readonly profiles: DepartmentProfiles
  readonly children: React.ReactNode
}): React.ReactElement {
  return <DepartmentProfilesContext.Provider value={profiles}>{children}</DepartmentProfilesContext.Provider>
}

/** The company's department profiles; the built-in defaults outside a provider. */
export function useDepartmentProfiles(): DepartmentProfiles {
  return React.useContext(DepartmentProfilesContext)
}
