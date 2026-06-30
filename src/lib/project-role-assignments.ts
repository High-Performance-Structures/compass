export type ProjectAssignmentScopeId =
  | "all"
  | "preconstruction"
  | "construction"
  | "closeout"

export type ProjectAssignmentScopeOption = {
  readonly id: ProjectAssignmentScopeId
  readonly label: string
}

export const PROJECT_ASSIGNMENT_SCOPES: readonly ProjectAssignmentScopeOption[] =
  [
    { id: "all", label: "All phases" },
    { id: "preconstruction", label: "Pre-construction" },
    { id: "construction", label: "Construction" },
    { id: "closeout", label: "Closeout / warranty" },
  ]

export function isProjectAssignmentScopeId(
  value: string | null,
): value is ProjectAssignmentScopeId {
  return PROJECT_ASSIGNMENT_SCOPES.some((scope) => scope.id === value)
}

export function projectAssignmentScopeLabel(value: string): string {
  return (
    PROJECT_ASSIGNMENT_SCOPES.find((scope) => scope.id === value)?.label ??
    "All phases"
  )
}
