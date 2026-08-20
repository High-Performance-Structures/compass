import { isDirectChannelId } from "@/lib/conversations/direct-channel"

export type NotificationDelivery = {
  readonly inApp: boolean
  readonly email: boolean
  readonly push: boolean
}

export function channelMessageNotificationDelivery(
  channelId: string
): NotificationDelivery {
  return {
    inApp: true,
    email: false,
    push: isDirectChannelId(channelId),
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
