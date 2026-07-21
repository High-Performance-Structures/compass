import type { CapacitorConfig } from "@capacitor/cli"
import { KeyboardResize, KeyboardStyle } from "@capacitor/keyboard"

const usesFieldShell = process.env.COMPASS_MOBILE_SHELL === "field"

const config: CapacitorConfig = {
  appId: "com.hpscolorado.compass",
  appName: "Compass",
  webDir: usesFieldShell ? "mobile-shell" : "public",
  server: {
    ...(usesFieldShell
      ? {}
      : { url: "https://compass.openrangeconstruction.ltd" }),
    cleartext: false,
    allowNavigation: [
      "compass.openrangeconstruction.ltd",
      "api.workos.com",
      "authkit.workos.com",
      "accounts.google.com",
      "login.microsoftonline.com",
    ],
  },
  plugins: {
    SplashScreen: {
      backgroundColor: "#ffffff",
      launchShowDuration: 2000,
      launchAutoHide: true,
      androidScaleType: "CENTER_CROP",
      showSpinner: false,
    },
    Keyboard: {
      resize: usesFieldShell ? KeyboardResize.Native : KeyboardResize.Body,
      style: KeyboardStyle.Dark,
    },
    PushNotifications: {
      presentationOptions: ["badge", "sound", "alert"],
    },
  },
  ios: {
    contentInset: "automatic",
    allowsLinkPreview: false,
    scheme: "compass",
  },
  android: {
    allowMixedContent: false,
    captureInput: true,
  },
}

export default config
