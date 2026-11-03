import {
  channelMessageIdsUpTo,
  clearReminderNotifications,
  markSourceNotificationsRead,
  threadMessageIds,
} from "@/lib/domain/notifications/store"
import type { Db } from "@/lib/server/action-context"

/*
 * Marks the viewer's own bell notifications read for records they have just
 * seen, so a message is handled once (in the conversation) instead of again
 * in the bell. Only the viewer's notification rows are touched. The writes
 * live in the notifications domain store.
 */

/**
 * A channel was read up to `cutoff` (the newest message on screen): clear
 * notifications for its top-level messages up to then. Thread replies clear
 * when the thread itself is opened.
 */
export async function markChannelNotificationsRead(
  db: Db,
  userId: string,
  channelId: string,
  cutoff: string,
): Promise<void> {
  await markSourceNotificationsRead(db, userId, "message", channelMessageIdsUpTo(channelId, cutoff))
}

/** A thread was opened: clear notifications for its parent and replies. */
export async function markThreadNotificationsRead(
  db: Db,
  userId: string,
  parentMessageId: string,
): Promise<void> {
  await markSourceNotificationsRead(db, userId, "message", threadMessageIds(parentMessageId))
}

/** Project messages the viewer has opened. */
export async function markCorrespondenceNotificationsRead(
  db: Db,
  userId: string,
  messageIds: readonly string[],
): Promise<void> {
  await markSourceNotificationsRead(db, userId, "project_correspondence", messageIds)
}

/**
 * Someone followed up on these Message Desk records, so they are no longer
 * stale: clear the stale reminders for everyone who received them (which also
 * turns the bell back from red).
 */
export async function clearStaleMessageReminders(
  db: Db,
  messageIds: readonly string[],
): Promise<void> {
  await clearReminderNotifications(db, {
    sourceType: "staff_message_record",
    eventType: "staff_message.stale",
    sourceIds: messageIds,
  })
}

/**
 * A client contact was logged on these jobs, so their follow-up is no longer
 * overdue: clear the overdue reminders for everyone who received them.
 */
export async function clearOverdueFollowUpReminders(
  db: Db,
  projectIds: readonly string[],
): Promise<void> {
  await clearReminderNotifications(db, {
    sourceType: "project",
    eventType: "project.follow_up_overdue",
    sourceIds: projectIds,
  })
}
