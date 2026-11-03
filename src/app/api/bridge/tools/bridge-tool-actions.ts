import type { BridgeToolActions } from "@/lib/mcp/tool-adapter"
import {
  getInstalledSkills,
  installSkill,
  toggleSkill,
  uninstallSkill,
} from "@/app/actions/plugins"
import {
  getCustomThemes,
  setUserThemePreference,
} from "@/app/actions/themes"
import { getCustomDashboards } from "@/app/actions/dashboards"

/**
 * The real server actions behind the bridge tools, so each tool call keeps
 * the action's own auth and permission checks.
 */
export const BRIDGE_TOOL_ACTIONS: BridgeToolActions = {
  getCustomThemes,
  getCustomDashboards,
  getInstalledSkills,
  setUserThemePreference,
  installSkill,
  uninstallSkill,
  toggleSkill,
}
