export type ConversationPanelView = "direct-message-picker"

export type ConversationPanelState = {
  readonly isOpen: boolean
  readonly channelId: string | null
  /** Omitted for the channel list or an active conversation. */
  readonly view?: ConversationPanelView
}

export function openConversationPanel(
  state: ConversationPanelState,
  channelId: string | null = state.channelId
): ConversationPanelState {
  return {
    isOpen: true,
    channelId,
  }
}

export function openDirectMessagePanel(
  state: ConversationPanelState
): ConversationPanelState {
  return {
    ...state,
    isOpen: true,
    channelId: null,
    view: "direct-message-picker",
  }
}

export function closeConversationPanel(
  state: ConversationPanelState
): ConversationPanelState {
  return {
    ...state,
    isOpen: false,
  }
}

export function toggleConversationPanel(
  state: ConversationPanelState
): ConversationPanelState {
  return state.isOpen ? closeConversationPanel(state) : openConversationPanel(state)
}
