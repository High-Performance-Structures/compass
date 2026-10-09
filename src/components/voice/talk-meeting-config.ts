import { createDefaultConfig } from "@cloudflare/realtimekit-react-ui"
import type { UIConfig } from "@cloudflare/realtimekit-react-ui"

export function createCompassMeetingConfig(): UIConfig {
  const base = createDefaultConfig()
  return {
    ...base,
    designTokens: {
      ...base.designTokens,
      theme: "dark",
      borderRadius: "rounded",
      colors: {
        ...base.designTokens?.colors,
        brand: {
          ...base.designTokens?.colors?.brand,
          300: "#9bd3a8",
          400: "#63b878",
          500: "#3f7d4d",
          600: "#32663e",
          700: "#244d2d"
        },
        background: {
          ...base.designTokens?.colors?.background,
          1000: "#08110b",
          900: "#0e1a12",
          800: "#142419",
          700: "#203626",
          600: "#2d4a34"
        },
        text: "#f8fafc",
        "text-on-brand": "#ffffff",
        danger: "#ef4444",
        success: "#22c55e",
        warning: "#f59e0b",
        "video-bg": "#050805"
      }
    },
    config: {
      ...base.config,
      videoFit: "contain",
      notification_sounds: {
        ...base.config?.notification_sounds,
        participant_joined: false,
        participant_left: false
      }
    },
    root: {
      ...base.root,
      // Keep narrow Chat/Participants panels inside the stage, above the toolbar.
      "rtk-meeting[meeting=joined].activeSidebar.sm": {},
      "rtk-meeting[meeting=joined].activeSidebar.md": {},
      "rtk-stage.activeSidebar.sm": {},
      // Project application-owned media controls into the SDK's single joined-call toolbar.
      "rtk-controlbar": [["slot", { name: "compass-controls" }]],
      "rtk-controlbar.sm": [["slot", { name: "compass-controls" }]],
      "rtk-controlbar.md": [["slot", { name: "compass-controls" }]]
    },
    styles: {
      ...base.styles,
      "rtk-stage": {
        ...base.styles?.["rtk-stage"],
        minHeight: "0",
        minWidth: "0",
        overflow: "hidden"
      },
      "rtk-stage.activeSidebar.sm": { display: "block" },
      "rtk-sidebar.sm": {
        position: "absolute",
        inset: "0",
        maxWidth: "100%",
        margin: "0",
        borderRadius: "0"
      },
      "rtk-controlbar": {
        display: "block",
        height: "auto",
        padding: "0",
        boxShadow: "none",
        borderTop: "1px solid var(--border)"
      },
      "rtk-controlbar.sm": { display: "block", padding: "0" },
      "rtk-controlbar.md": { display: "block", padding: "0" },
      "rtk-controlbar-button": {
        ...base.styles?.["rtk-controlbar-button"],
        color: "#f8fafc"
      },
      "rtk-more-toggle": {
        ...base.styles?.["rtk-more-toggle"],
        color: "#f8fafc"
      },
      "rtk-settings-toggle": {
        ...base.styles?.["rtk-settings-toggle"],
        color: "#f8fafc"
      },
      "rtk-chat-toggle": {
        ...base.styles?.["rtk-chat-toggle"],
        color: "#f8fafc"
      },
      "rtk-participants-toggle": {
        ...base.styles?.["rtk-participants-toggle"],
        color: "#f8fafc"
      }
    }
  }
}
