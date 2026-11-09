/**
 * Browser-only loaders for the Capacitor plugins the app shell uses.
 *
 * Every plugin call in the app goes through these instead of a bare
 * `import("@capacitor/...")`. Why: Next also compiles client components for
 * server rendering, and each page's server build got its own async copy of
 * every plugin it could reach, each with `@capacitor/core` inlined (~37
 * copies in the Worker bundle). Next replaces `typeof window` with
 * "undefined" when building for the server, so the `import()` below sits in a
 * branch the server build drops entirely. In the browser nothing changes.
 *
 * Plugins only work inside the native app; callers already check
 * `isNative()` (src/lib/native/platform.ts) or catch failures.
 */

function serverRender(): Promise<never> {
  return Promise.reject(new Error("Capacitor plugins load only in the browser."))
}

export const loadAppPlugin = () =>
  typeof window === "undefined" ? serverRender() : import("@capacitor/app")

export const loadAppLauncherPlugin = () =>
  typeof window === "undefined" ? serverRender() : import("@capacitor/app-launcher")

export const loadKeyboardPlugin = () =>
  typeof window === "undefined" ? serverRender() : import("@capacitor/keyboard")

export const loadNetworkPlugin = () =>
  typeof window === "undefined" ? serverRender() : import("@capacitor/network")

export const loadPreferencesPlugin = () =>
  typeof window === "undefined" ? serverRender() : import("@capacitor/preferences")

export const loadPushNotificationsPlugin = () =>
  typeof window === "undefined" ? serverRender() : import("@capacitor/push-notifications")

export const loadStatusBarPlugin = () =>
  typeof window === "undefined" ? serverRender() : import("@capacitor/status-bar")

export const loadNativeBiometricPlugin = () =>
  typeof window === "undefined"
    ? serverRender()
    : import("@capgo/capacitor-native-biometric")
