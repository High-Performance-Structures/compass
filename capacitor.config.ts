import type { CapacitorConfig } from "@capacitor/cli"
import { KeyboardResize, KeyboardStyle } from "@capacitor/keyboard"

const config: CapacitorConfig = {
  appId: "ltd.openrangeconstruction.compass",
  appName: "Compass",
  webDir: "public",
  server: {
    url: "https://compass.openrangeconstruction.ltd",
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
      resize: KeyboardResize.Body,
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
