---
{
  "id": "contacts.access",
  "featureId": "project-contacts",
  "slug": "contacts-project-access-invitations",
  "title": "Contacts, Project Access, and Invitations",
  "summary": "Manage directory contacts, project assignments, invitations, and access verification.",
  "contextSummary": "A contact record, a project assignment, and a Compass login are separate. Search first, assign the correct project, then invite and verify access.",
  "category": "Start Here",
  "tags": ["contacts", "access", "permissions", "invitations", "users"],
  "audiences": ["staff"],
  "permissions": ["help:read", "vendor:read"],
  "routes": ["/dashboard/contacts", "/dashboard/projects/[id]/contacts"],
  "owner": "Compass product team",
  "lastReviewed": "2026-11-04"
}
---

## Directory, Project, and Login Are Separate {#directory-vs-access}

Compass keeps the company directory, project assignments, and user access separate. A directory contact is an address-book record. Assigning that contact to a project records a business relationship. Neither action creates a login or sends an invitation.

The safe sequence is **search the directory, assign the project, invite the person, then verify their view**. This separation prevents a contact from receiving project information merely because their name appears in the directory.

## Search Before Creating {#search-before-creating}

Open **Contacts**, choose the relevant customer, vendor, or internal directory, and search by person, company, and email. Check spelling variations before adding a record.

Use one directory record when the same company works on several projects. Use separate person records when individuals need separate accounts. Do not create placeholder users for “TBD,” and do not recreate employees as customers or vendors.

Clients, vendors, and internal people are separate Contacts views. A client or vendor company can contain several named people. Open the company action menu to view those people. Staff can have separate permissions to edit each directory under **Settings > Permissions**. An external user sees only a person explicitly linked to their own Compass account, not the full directory. Staff with edit access can change a person's name, phone, address, title, and company, including for someone who has accepted a Compass invitation. The one exception is that person's sign-in email: it shows as locked with the note "This is their Compass sign-in email; they change it themselves." Until an invitation is accepted, the email stays editable; changing it while an invitation is pending warns that the invitation went to the old address.

The **Internal** directory has separate **Email** and **Phone** columns. The Phone column shows stored employee phone and mobile numbers, including Sage-synced values; select a number to call it. A dash means neither number is available.

For a Sage-linked client or vendor, edit the fields in place and choose **Save**. Every change shows in Compass as soon as you save, everywhere the record appears. Fields shared with Sage (name, owner, email, phone and addresses, and the details of people who are in Sage) also become one Sage change request; each shows a small **Sage update pending** marker until Sage has the value, and Sage syncs leave those fields alone in the meantime. Editing again before approval updates the same request. A reviewer other than the requester approves it in **Sage review** after a fresh Sage read, and the marker clears once the Sage writer reads the value back. If the request is rejected, Compass puts the Sage value back and records it in Activity. If the Sage write fails or reads back differently, Compass keeps your value and shows **Sage update failed** with **Retry** and **Reject**. If Compass has never read the record from Sage, it asks for a read; save again a minute later. A vendor's category follows its Sage vendor type when the company maps one, so change the type in Sage. A client's primary email is changed in Sage. For Sage-linked staff, choose **Propose Sage edit**. Approval is unavailable while Sage writes are paused, and if Sage changed in the meantime, the request is held as a conflict. Employee home addresses are never shown in project contact lists and require a separate confidential-contact permission for staff review.

For an unlinked contact, **Verify Sage link** looks up the exact Sage number without changing the directory record. Only one lookup can be active for a contact: selecting the same number again reuses a pending lookup, while a different number requires rejecting the existing candidate in **Sage review** first. If a read-back is older than 15 minutes or an employee name was not returned, use **Refresh Sage read-back** in the review. This requests a new read of the same number and retains the review history; it does not link the contact or write to Sage. Compare the fresh Sage evidence before linking. An employee may review their own matching-name link only when individually granted **Self-review Sage employee identity** under **Settings > Permissions**; other identity links require a separate reviewer.

## Add and Invite a Contact {#add-and-invite}

1. Create or correct the directory record, paying special attention to the email address.
2. From the project **Contacts** page, add the existing contact to that project. An account administrator can also use **Manage Compass access** within Contacts to select multiple accounts and grant specific projects together.
3. Review the project, contact type, email, intended role, and audience visibility.
4. Select **Invite to Compass**, or **Grant project access** if the person already has a Compass login, and review the project and welcome message before sending. While an invitation is pending, the button reads **Resend invitation**.

For a new user, Compass creates a secure account invitation. For an existing user, Compass adds the explicit project assignment. Neither path grants unrelated projects.

Linking a person to a Compass account is a separate, deliberate administrator action. Use **Compass account** beside the named person and choose the exact login. Never decide a match by email alone; the account link does not grant project access by itself.

## Verify Access {#verify-access}

After inviting, confirm Compass reports success, the person appears on the correct project, and the role and feature permissions fit their work. Open **Owner preview** or **Vendor preview**, then choose the exact assigned person in **Preview as**. The preview follows that person's project records, emails, and files. With no person selected, private records stay hidden. People who haven't accepted their invitation yet are listed as **(invited)**; previewing one shows the workspace they will have once they accept, matched to their project contact by email.

Internal staff can use this read-only preview by default; administrators can narrow **External person preview** in **Settings > Permissions**. Preview visits do not send messages, save drafts, confirm work, mark messages read, or change the person's notification settings. Return to the staff workspace to make changes.

If the person does not appear in the invitation list, check that the contact is active, assigned to the current project, has a valid email, and that you have invitation permission.

## Correct Mistakes Safely {#correct-mistakes}

Stop before inviting either record when you find a likely duplicate. Ask an administrator to reconcile identity and assignments. If access was granted to the wrong person or project, treat it as a potential data-exposure issue and contact an administrator immediately.

## Compare the Directory with Sage {#compare-sage}

Use **Compare clients with Sage** to search Compass clients and the read-only Sage directory side by side. Request a fresh Sage list when needed and compare the names and exact Sage identifiers. Selecting a pair does not link or merge it. Imported links can use their verification workflow; other identity links still require the review appropriate to that record. Proposed Sage edits and new Sage people require independent approval and confirmed read-back.

Project-phase contacts remain project assignments, separate from the underlying Sage client. Reuse an existing named person when assigning the same client to another phase instead of creating a duplicate.

## Merge Duplicate Companies or People {#merge-contacts}

Authorized directory managers can select duplicate company records or use **Merge 2 people** within a company. Choose the record to keep and review linked identities, project relationships, and any conflicts before confirming. Imported directory identities can be eligible for merging, but a conflicting Sage identity must be resolved through the proper review. A merge reconciles directory records; it does not authorize an unrelated Sage write or an invitation. Use the permission-appropriate delete action only for an unnecessary record and review the displayed dependencies first.

## Resend a Pending Invitation {#resend-invitation}

If an invited person has not joined, use the pending invitation's resend action rather than creating another person or assignment. Verify the email, project, and role first. Pending invitee links can exist before a Compass account ID is available. After acceptance, verify the actual workspace and feature access.

## Welcome Email Delivery {#welcome-email-delivery}

Project access and email delivery have separate statuses. **Awaiting acceptance** means the account invitation is pending; it does not prove that the welcome email arrived.

If the email provider temporarily limits sending, Compass saves your welcome message and retries automatically after the provider's cooldown. The contact shows **Welcome email queued**. You do not need to resend while it is queued. Retries use the existing account invitation and do not send repeated account setup emails.

If delivery fails permanently or retries are exhausted, the contact shows **Welcome email failed**, and the staff member who invited them receives an in-app notification. Check the recipient and email setup before retrying. If the person already has active project access, use **Resend welcome email**; this sends only the welcome and preserves their existing access. If delivery is **unconfirmed**, check the sending mailbox or provider history before resending; Compass holds uncertain sends for review to avoid duplicates. Revoked, expired, removed, or superseded invitations are not automatically sent.

The welcome message normally has the subject **Welcome to Compass for [project]**. Its secure button opens account setup or sign-in. A separate account setup email may also come from the authentication provider.

## Quick Check {#quick-check}

- [ ] I searched for an existing contact.
- [ ] The person's name, company, category, and email are correct.
- [ ] The contact is assigned only to intended projects.
- [ ] The role and audience visibility are appropriate.
- [ ] I verified the recipient's view after inviting.

See [Navigating projects](/dashboard/help/navigating-projects) and [Requesting help](/dashboard/help/requesting-help).
