import { describe, expect, it, vi } from "vitest"

import {
  dispatchCorrespondenceEmail,
  isCorrespondenceEmailEnabled,
  queueCorrespondenceEmail,
  receiveCorrespondenceEmail,
} from "@/lib/correspondence/email-adapter"

function candidate(overrides: Record<string, unknown> = {}) {
  return {
    gmailMessageId: "gmail-1",
    gmailThreadId: "thread-1",
    messageIdHeader: "<gmail-1@example.com>",
    inReplyToHeader: "<cmp-token@example.com>",
    referencesHeader: "<cmp-token@example.com>",
    token: "cmp-token",
    fromAddress: "owner@example.com",
    fromName: "Owner",
    toAddress: "compass@example.com",
    subject: "Re: Project update",
    textBody: "Reply body",
    htmlBody: null,
    snippet: "Reply body",
    receivedAt: "2026-09-05T12:00:00.000Z",
    attachments: [],
    ...overrides,
  }
}

function selectChain(value: unknown) {
  return {
    from() { return this },
    innerJoin() { return this },
    leftJoin() { return this },
    where() { return this },
    get() { return Promise.resolve(value) },
    then(resolve: (rows: unknown) => unknown) { return Promise.resolve(resolve(value)) },
  }
}

describe("correspondence email adapter", () => {
  it("is separately disabled unless the project is explicitly enabled for email", () => {
    expect(isCorrespondenceEmailEnabled("project-1", {})).toBe(false)
    expect(
      isCorrespondenceEmailEnabled("project-1", {
        COMPASS_CORRESPONDENCE_EMAIL_PROJECT_IDS: "project-2, project-1",
      })
    ).toBe(true)
  })

  it("records an unproven inbound token as held without creating a message", async () => {
    const inserted: unknown[] = []
    const db = {
      select: vi.fn().mockReturnValue(selectChain(null)),
      insert: vi.fn().mockReturnValue({
        values(value: unknown) {
          inserted.push(value)
          return {
            onConflictDoNothing: () => ({
              returning: () => Promise.resolve([{ id: "event-1" }]),
            }),
          }
        },
      }),
    }

    const result = await receiveCorrespondenceEmail({
      // @ts-expect-error Lightweight test double exercises only the receive queries.
      db,
      environment: { COMPASS_CORRESPONDENCE_EMAIL_PROJECT_IDS: "project-1" },
      organizationId: "org-1",
      candidate: candidate(),
      providerAuthenticated: true,
      senderEvidence: "header_only",
      isAutomatedResponse: false,
      isDeliveryLoop: false,
      attachments: "ready",
    })

    expect(result).toEqual({ kind: "held" })
    expect(inserted).toHaveLength(1)
  })

  it("preserves a Gmail thread anchor and marks only a successful sender result accepted", async () => {
    const updateSets: unknown[] = []
    const delivery = {
      id: "delivery-1",
      organizationId: "org-1",
      projectId: "project-1",
      conversationId: "conversation-1",
      messageId: "message-1",
      recipientUserId: "user-1",
      recipientEmail: "owner@example.com",
      status: "queued",
      attemptCount: 0,
      subject: "Project update",
      body: "Hello",
    }
    const thread = {
      id: "thread-1",
      organizationId: "org-1",
      projectId: "project-1",
      conversationId: "conversation-1",
      replyToken: "cmp-token",
      replyToAddress: "Compass <compass+cmp-token@example.com>",
      anchorMessageId: "<cmp-token@example.com>",
      createdAt: "2026-09-05T12:00:00.000Z",
    }
    const people = [
      {
        userId: "user-1",
        name: "Owner",
        email: "owner@example.com",
        role: "owner",
        active: true,
        organizationRole: "member",
        projectRole: "owner",
      },
    ]
    const selectResults = [
      delivery,
      { id: "message-1" },
      people,
      { id: "message-1" },
      people,
      thread,
    ]
    const db = {
      select() {
        const value = selectResults.shift()
        return selectChain(value)
      },
      update: vi.fn().mockReturnValue({
        set(value: unknown) {
          updateSets.push(value)
          return {
            where() {
              return { returning: () => Promise.resolve([{ id: "delivery-1" }]) }
            },
          }
        },
      }),
    }
    const sender = vi.fn().mockResolvedValue({
      kind: "accepted",
      providerMessageId: "gmail-outbound-1",
    })

    const result = await dispatchCorrespondenceEmail({
      // @ts-expect-error Lightweight test double exercises only the dispatch queries.
      db,
      environment: {
        COMPASS_CORRESPONDENCE_EMAIL_PROJECT_IDS: "project-1",
        COMPASS_REPLY_MAILBOX: "compass@example.com",
      },
      deliveryId: "delivery-1",
      sender,
    })

    expect(result).toEqual({ kind: "accepted", deliveryId: "delivery-1" })
    expect(sender).toHaveBeenCalledWith(
      expect.objectContaining({
        replyTo: "Compass <compass+cmp-token@example.com>",
        headers: expect.arrayContaining([
          { name: "In-Reply-To", value: "<cmp-token@example.com>" },
          { name: "References", value: "<cmp-token@example.com>" },
          { name: "X-Compass-Reply-Token", value: "cmp-token" },
        ]),
      })
    )
    expect(updateSets).toContainEqual(expect.objectContaining({ status: "dispatching" }))
    expect(updateSets).toContainEqual(expect.objectContaining({ status: "accepted" }))
  })

  it("never queues a historical message for a current participant without its recipient grant", async () => {
    const insert = vi.fn()
    const selectResults = [{ id: "conversation-1" }, null]
    const db = {
      select() {
        return selectChain(selectResults.shift())
      },
      insert,
    }

    await expect(
      queueCorrespondenceEmail({
        // @ts-expect-error The message-grant query is the only path under test.
        db,
        environment: { COMPASS_CORRESPONDENCE_EMAIL_PROJECT_IDS: "project-1" },
        organizationId: "org-1",
        projectId: "project-1",
        conversationId: "conversation-1",
        messageId: "historic-message",
        recipientUserId: "new-participant",
      })
    ).rejects.toThrow("Correspondence message is unavailable.")
    expect(insert).not.toHaveBeenCalled()
  })

  it("fails a queued delivery for a retracted message before the sender runs", async () => {
    const delivery = {
      id: "delivery-1",
      organizationId: "org-1",
      projectId: "project-1",
      conversationId: "conversation-1",
      messageId: "message-1",
      recipientUserId: "user-1",
      recipientEmail: "owner@example.com",
      status: "queued",
      attemptCount: 0,
      subject: "Project update",
      body: "Hello",
    }
    const updates: unknown[] = []
    const db = {
      select: vi.fn().mockReturnValueOnce(selectChain(delivery)).mockReturnValueOnce(selectChain(null)),
      update: vi.fn().mockReturnValue({
        set(value: unknown) {
          updates.push(value)
          return { where: () => Promise.resolve() }
        },
      }),
    }
    const sender = vi.fn()

    const result = await dispatchCorrespondenceEmail({
      // @ts-expect-error The eligibility query is intentionally a retraction miss.
      db,
      environment: { COMPASS_CORRESPONDENCE_EMAIL_PROJECT_IDS: "project-1" },
      deliveryId: "delivery-1",
      sender,
    })

    expect(result).toMatchObject({ kind: "failed", deliveryId: "delivery-1" })
    expect(sender).not.toHaveBeenCalled()
    expect(updates).toContainEqual(expect.objectContaining({ status: "failed" }))
  })

  it("leaves an active concurrent dispatch untouched", async () => {
    const delivery = {
      id: "delivery-1",
      organizationId: "org-1",
      projectId: "project-1",
      conversationId: "conversation-1",
      messageId: "message-1",
      recipientUserId: "user-1",
      recipientEmail: "owner@example.com",
      status: "dispatching",
      attemptCount: 1,
      subject: "Project update",
      body: "Hello",
    }
    const update = vi.fn()
    const sender = vi.fn()
    const db = { select: vi.fn().mockReturnValue(selectChain(delivery)), update }

    const result = await dispatchCorrespondenceEmail({
      // @ts-expect-error This exercises the in-flight fast path.
      db,
      environment: { COMPASS_CORRESPONDENCE_EMAIL_PROJECT_IDS: "project-1" },
      deliveryId: "delivery-1",
      sender,
    })

    expect(result).toEqual({ kind: "already_handled", deliveryId: "delivery-1" })
    expect(update).not.toHaveBeenCalled()
    expect(sender).not.toHaveBeenCalled()
  })

})
