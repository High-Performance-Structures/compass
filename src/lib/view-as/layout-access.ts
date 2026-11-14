/*
 * What the dashboard shell offers a person for developer mode and View as:
 * the developer mode switch, and the View as entry points (developer menu
 * search, Contacts and People rows). Server only; the actions recheck all of
 * it, this only decides what to show.
 */
import { getDb } from "@/db"
import type { AuthUser } from "@/lib/auth"
import { getCloudflareContext } from "@/lib/db"
import { readFeatureSettings } from "@/lib/feature-settings/server"
import { FEATURE_SETTINGS } from "@/lib/feature-settings/registry"
import { canUseDeveloperModeWith, isViewAsEligible } from "@/lib/view-as/policy"
import { isInternalStaffRole } from "@/lib/user-roles"

export async function developerShellAccess(
  user: AuthUser | null,
  viewing: boolean,
): Promise<{ readonly canUseDeveloperMode: boolean; readonly canViewAs: boolean }> {
  // Outside staff never read the company's settings.
  const settings =
    user?.organizationId && isInternalStaffRole(user.role)
      ? await readFeatureSettings(getDb((await getCloudflareContext()).env.DB), user.organizationId, "view-as")
      : FEATURE_SETTINGS["view-as"].defaults
  return {
    canUseDeveloperMode: canUseDeveloperModeWith(user, settings),
    // Nobody starts another View as from inside one.
    canViewAs: !viewing && isViewAsEligible(user, settings),
  }
}
