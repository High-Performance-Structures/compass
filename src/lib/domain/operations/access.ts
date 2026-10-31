/**
 * Who may read or change a project's to-dos, purchase orders, RFQs, and Sage
 * queue: staff of the project's own organization with the feature
 * permission ("organization" scope). Writes are refused for the read-only
 * demo. Failures throw the shared context message, which the actions return
 * or rethrow as before.
 */
import { projectContext, type ProjectContext } from "@/lib/server/action-context"

export type OperationsFeature = "project-hub" | "tasks" | "purchase-orders" | "rfqs" | "sage-sync"

export async function operationsContext(
  projectId: string,
  feature: OperationsFeature,
  mutation: boolean,
): Promise<ProjectContext & { readonly organizationId: string }> {
  const context = await projectContext(projectId, { scope: "organization", feature, mutation })
  if (!context.success) throw new Error(context.error)
  const { organizationId } = context.data
  // "organization" scope always resolves the user's active organization.
  if (!organizationId) throw new Error("No active organization")
  return { ...context.data, organizationId }
}
