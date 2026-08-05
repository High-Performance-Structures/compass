const DEFAULT_HPS_PROJECT_MANAGER_WEB_APP_URL =
  "https://script.google.com/a/macros/hps-colorado.com/s/AKfycbyeCqsdObrPp91LRmpEHSLZ8xdGerw7ExF2mFSSzYkxGnTrliv9OvHsYOFXicnVC5nQ/exec"

const PROJECT_MANAGER_WINDOW_FEATURES =
  "popup=yes,width=1180,height=860,menubar=no,toolbar=yes,location=yes,status=no,scrollbars=yes,resizable=yes"

type ProjectManagerPopup = {
  focus(): void
}

type ProjectManagerBrowser = {
  readonly location: {
    assign(url: string): void
  }
  open(
    url: string,
    target: string,
    features: string
  ): ProjectManagerPopup | null
}

export function resolveHpsProjectManagerWebAppUrl(
  configuredUrl: string | null | undefined
): string {
  const trimmed = configuredUrl?.trim() ?? ""
  return trimmed.length > 0 ? trimmed : DEFAULT_HPS_PROJECT_MANAGER_WEB_APP_URL
}

export const CONFIGURED_HPS_PROJECT_MANAGER_WEB_APP_URL =
  process.env.NEXT_PUBLIC_HPS_PROJECT_MANAGER_WEB_APP_URL?.trim() ?? ""

export const HPS_PROJECT_MANAGER_WEB_APP_URL =
  resolveHpsProjectManagerWebAppUrl(CONFIGURED_HPS_PROJECT_MANAGER_WEB_APP_URL)

export function openHpsProjectManagerWorkWindow(
  browser: ProjectManagerBrowser = window,
  appUrl: string = HPS_PROJECT_MANAGER_WEB_APP_URL
): void {
  const projectManagerWindow = browser.open(
    appUrl,
    "hps-project-manager",
    PROJECT_MANAGER_WINDOW_FEATURES
  )

  if (projectManagerWindow) {
    projectManagerWindow.focus()
    return
  }

  // A direct navigation keeps project creation available when a browser blocks popups.
  browser.location.assign(appUrl)
}
