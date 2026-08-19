import type { CapacitorConfig } from "@capacitor/cli"
import { KeyboardResize, KeyboardStyle } from "@capacitor/keyboard"

const usesLiveWrapper = process.env.COMPASS_MOBILE_MODE === "live"

const config: CapacitorConfig = {
  appId: "com.hpscolorado.compass",
  appName: "Compass",
  webDir: usesLiveWrapper ? "public" : "mobile-shell",
  server: {
    ...(usesLiveWrapper
      ? { url: "https://compass.openrangeconstruction.ltd" }
      : {}),
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
    CapacitorHttp: {
      enabled: true,
    },
    SplashScreen: {
      backgroundColor: "#ffffff",
      launchShowDuration: 2000,
      launchAutoHide: true,
      androidScaleType: "CENTER_CROP",
      showSpinner: false,
    },
    Keyboard: {
      resize: usesLiveWrapper ? KeyboardResize.Body : KeyboardResize.Native,
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
