# Project messages and email

Staff can use **New email** in a project's messages to address project contacts,
directory contacts, or manually entered email addresses. Recipients
whose email matches an active Compass user already assigned to the project can
also see the conversation in their Compass workspace. Email does not create an
account or project membership. Bcc users get a private Compass view. Their identities are hidden from other
external recipients in participant lists, headers, and read receipts. The full
Bcc list is available only to the original sender. Replies from Bcc recipients
are granted only to the replying user and non-blind project staff. This applies to newly sent emails; earlier messages
are not automatically shared retroactively.

Incoming replies are attached to the original conversation through its tracked
Reply-To address. Each reply is granted only to currently active conversation
participants. Removing project access removes portal access to the conversation
and its attachments. Replying in Compass creates a Compass message for the
conversation's current participants (or only staff for a Bcc user's reply); it
does not send another email to external
addresses. Use New email when an additional email delivery is needed.

## Attach files

New messages, replies, and emails offer **Upload files** and **Project files**.
Staff browse their mapped project Drive folder with their document read access.
Owners and vendors can select only published, downloadable project documents.
Google documents and presentations are exported as PDFs; spreadsheets are
exported as Excel files. Selecting a project file stores a protected snapshot;
it does not change the original file's permissions or location.

Messages allow up to 10 attachments, 25 MB per file, and 50 MB total. Email allows
up to 10 attachments totaling 18 MB to leave room for MIME encoding. Wait until
all files are ready before sending. Remove an unsent attachment with its remove
button; failed email deliveries retry the same saved content and files. An
unknown delivery outcome must be reviewed instead of resent. Sent attachments
are subject to message access and retraction checks. Ready attachments are saved with private drafts and restored when reopened.

Storage uses the existing private correspondence Drive folder configured through
`COMPASS_CORRESPONDENCE_DRIVE_USER` and the per-organization
`COMPASS_CORRESPONDENCE_STAGING_FOLDERS` mapping. Shared project folders and shared
Drive membership are not suitable for private staging. Configuration must point
to a regular Drive folder with only the dedicated user's ACL. If that requirement
is not met, attachment staging fails with an actionable error.

Email replies containing new inbound files continue to require manual review;
this change covers attachments composed and sent from Compass.


## Drafts and Sent

**Drafts** lists your private new messages, emails, and replies for this project.
New messages and emails support multiple saved drafts. Changes autosave after a
short pause; **Save draft** saves immediately. Ready uploaded files and project
file snapshots stay with the draft across reloads. Wait for files to finish
uploading before leaving. Drafts never grant recipients access or send emails.
Concurrent edits from another tab or device are rejected instead of overwriting
newer content. Discard a new composition from its composer and use **Undo discard**
to restore it before leaving. Existing reply drafts retain their discard confirmation.

**Sent** shows conversations containing your Compass messages or outgoing project
emails, including archived conversations. The list shows your latest outgoing
text and timestamp; opening it focuses that message. Failed deliveries stay in
project history with their delivery status and retry control. Unknown email
outcomes are shown for review and must not be resent as a new email. A draft is
removed atomically when its message is recorded, so losing a send response cannot
leave a sendable duplicate draft. Pending requests retain their original send
identity and content until resolved.

Bell links open their target independently of read-status updates. Project email
reply links select and focus the matching reply even when the project messages
page is already open.
