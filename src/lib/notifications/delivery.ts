import {
  isDirectConversationChannel,
  type DirectConversationChannel,
} from "@/lib/conversations/direct-channel"

export type NotificationDelivery = {
  readonly inApp: boolean
  readonly email: boolean
  readonly push: boolean
}

export function channelMessageNotificationDelivery(
  channel: DirectConversationChannel
): NotificationDelivery {
  return {
    inApp: true,
    email: false,
    push: isDirectConversationChannel(channel),
  }
}

type NotificationDeliveryPreferences = {
  readonly inAppEnabled: boolean
  readonly emailEnabled: boolean
  readonly pushEnabled: boolean
}

export function resolveNotificationDelivery(
  preferences: NotificationDeliveryPreferences,
  requested: NotificationDelivery
): NotificationDelivery {
  return {
    inApp: requested.inApp && preferences.inAppEnabled,
    email: requested.email && preferences.emailEnabled,
    push: requested.push && preferences.pushEnabled,
  }
}
