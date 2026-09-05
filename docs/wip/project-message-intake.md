# Project message intake

The overview shows a compact Email/Text bar. Addresses, copy controls, and routing instructions expand on demand in staff, owner, and supplier workspaces.

`[MESSAGE]` (also `[MESSAGES]`, case insensitive) routes incoming email or SMS to Project Messages. For email, start the subject with the tag. For SMS, start the first line with the project number, then the tag. The existing sender and project checks still apply.

Examples:

- Email subject: `[MESSAGE] @Alex Please confirm the finish`
- Text: `O-197-5565 [MESSAGE] @"Alex Stone" Please confirm the finish`

Mentions match active internal users in the project's organization by unique first name, quoted full name, dotted full name, or email local part. Ordinary email addresses are not mentions. Repeated mentions notify once. Unknown, malformed, or ambiguous mentions go to the existing inbound review queue. Without mentions, the message goes to assigned internal project members and linked active internal project contacts.

Each incoming item starts a new internal correspondence conversation. Only its resolved internal recipients receive message access and an in-app notification, respecting their in-app preference. The external sender's name and address remain source attribution; email/SMS headers do not impersonate a Compass account, publish content to other owners/suppliers, or grant portal access. Replies in this conversation remain internal Compass correspondence.

The message, recipient grants, and notifications commit atomically. A deterministic ID prevents repeat polling or webhook delivery from duplicating the message or notification. The write batch rechecks the project organization and active internal membership.

Messages with attachments, no assigned recipients, or unavailable project messaging remain in the review queue. Attachment ingestion and outbound email/SMS replies are separate existing transport workflows; this tag does not bypass their requirements. This route creates in-app notifications, not outbound email/SMS or push alerts.

Validation: shared email/SMS route integration tests cover verified and unknown senders, isolation from external/inactive/other-organization users, matching, default routing, retries, transaction rollback, access changes, and preferences. The existing browser verification covers compact height, keyboard expansion, retained copy controls, mail/SMS links, mobile layout, Quick Add, project switching, logout, and themes.
