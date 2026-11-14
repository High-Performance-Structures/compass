/*
 * The View as database guard for code that reads the D1 binding without
 * going through src/lib/db.ts (the platform provider's getD1FromContext).
 * Kept free of db.ts and static next/headers imports so the provider module,
 * which client components also import, still bundles.
 */
import { isViewAsRequest, viewAsGuardMode } from "@/lib/view-as/request"
import { readOnlyD1 } from "@/lib/view-as/write-guard"

export async function viewAsGuardedD1(d1: D1Database): Promise<D1Database> {
  if (!(await isViewAsRequest())) return d1
  return readOnlyD1(d1, await viewAsGuardMode())
}
