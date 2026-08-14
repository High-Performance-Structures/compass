import { describe, expect, it } from "vitest"
import {
  closeConversationPanel,
  openConversationPanel,
  openDirectMessagePanel,
  toggleConversationPanel,
  type ConversationPanelState,
} from "../conversation-panel-state"

const closed: ConversationPanelState = {
  isOpen: false,
  channelId: null,
}

describe("conversation panel state", () => {
  it("opens the direct-message picker without navigating away from the workspace", () => {
    expect(openDirectMessagePanel(closed)).toEqual({
      isOpen: true,
      channelId: null,
      view: "direct-message-picker",
    })
  })

  it("opens directly into the channel chosen from any workspace", () => {
    expect(openConversationPanel(closed, "channel-42")).toEqual({
      isOpen: true,
      channelId: "channel-42",
    })
  })

  it("keeps the active channel when reopening the conversation drawer", () => {
    const open: ConversationPanelState = {
      isOpen: false,
      channelId: "channel-42",
    }

    expect(openConversationPanel(open)).toEqual({
      isOpen: true,
      channelId: "channel-42",
    })
  })

  it("closes without discarding the active channel so the next open can resume it", () => {
    const open: ConversationPanelState = {
      isOpen: true,
      channelId: "channel-42",
    }

    expect(closeConversationPanel(open)).toEqual({
      isOpen: false,
      channelId: "channel-42",
    })
  })

  it("toggles the drawer while preserving its selected channel", () => {
    const open: ConversationPanelState = {
      isOpen: true,
      channelId: "channel-42",
    }

    expect(toggleConversationPanel(open)).toEqual({
      isOpen: false,
      channelId: "channel-42",
    })
    expect(toggleConversationPanel(closeConversationPanel(open))).toEqual({
      isOpen: true,
      channelId: "channel-42",
    })
  })
})
