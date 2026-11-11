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
  "lastReviewed": "2026-11-10"
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

For a Sage-linked client or vendor, edit the fields in place and choose **Save**. Compass is where contact corrections are made first: every field of the company and its people (name, title, email, phone, addresses) can always be edited, whatever the state of the Sage link, and every change shows in Compass as soon as you save, everywhere the record appears. Fields shared with Sage (name, owner, email, phone and addresses, and the details of people who are in Sage) also become one Sage change request; each shows a small **Sage update pending** marker until Sage has the value, and Sage syncs leave those fields alone in the meantime. Editing again before approval updates the same request. Staff with Sage review approve access approve it in **Sage review** after a fresh Sage read, and the marker clears once the Sage writer reads the value back. If you have that access, you can approve your own change: the form shows **Approve and send to Sage**. A company that wants a second person to approve every change turns on **Require a second person to approve Sage contact changes** in **Settings > Workflows > Sage contact review**; then someone other than the requester must approve. If the request is rejected, Compass puts the Sage value back and records it in Activity. If the Sage write fails or reads back differently, Compass keeps your value and shows **Sage update failed** with **Retry** and **Reject**. If Compass has never read the record from Sage, or Sage is writing an earlier change at that moment, your values are saved and held, and the Sage change request follows on its own once the read or the write lands. If the record is not linked to a verified Sage record yet, or Sage contact sync is not set up, the change is saved in Compass only and the form says so. If the Sage writer on the Sage computer still needs its update for a company's name, email or phone, the change is saved and requested as usual; Sage refuses it until the writer is updated, which shows as **Sage update failed** with **Retry** and **Reject**. A vendor's category follows its Sage vendor type when the company maps one, so change the type in Sage. A client's primary email and a client person's **Primary contact** are saved in Compass only. For Sage-linked staff, choose **Propose Sage edit**. Approval is unavailable while Sage writes are paused, and if Sage changed in the meantime, the request is held as a conflict. Employee home addresses are never shown in project contact lists and require a separate confidential-contact permission for staff review.

For an unlinked contact, **Verify Sage link** looks up the exact Sage number without changing the directory record. Only one lookup can be active for a contact: selecting the same number again reuses a pending lookup, while a different number requires rejecting the existing candidate in **Sage review** first. If a read-back is older than 15 minutes or an employee name was not returned, use **Refresh Sage read-back** in the review. This requests a new read of the same number and retains the review history; it does not link the contact or write to Sage. Compare the fresh Sage evidence before linking. An employee may review their own matching-name link only when individually granted **Self-review Sage employee identity** under **Settings > Permissions**; other identity links require a separate reviewer.

## Add and Invite a Contact {#add-and-invite}

1. Create or correct the directory record, paying special attention to the email address.
2. From the project **Contacts** page, add the existing contact to that project. An account administrator can also use **Manage Compass access** within Contacts to select multiple accounts and grant specific projects together.
3. Review the project, contact type, email, intended role, and audience visibility.
4. Select **Invite to Compass**, or **Grant project access** if the person already has a Compass login, and review the project and welcome message before sending. While an invitation is pending, the button reads **Resend invitation**.

For a new user, Compass creates a secure account invitation. For an existing user, Compass adds the explicit project assignment. Neither path grants unrelated projects.

Linking a person to a Compass account is a separate, deliberate administrator action. Use **Compass account** beside the named person and choose the exact login. Never decide a match by email alone; the account link does not grant project access by itself.

## Access Requests {#access-requests}

Someone who signs up for Compass without an invitation can ask to join a company instead of waiting. They choose **Request access** (shown in place of the dashboard until they belong to a company, and in the company menu at the top left), pick the company, say whether they are a client, a trade partner or vendor, or an employee, and give their phone and job name or address. Only companies that turned on **Allow access requests** in **Settings > People** are listed; it is off until an admin turns it on.

Admins are notified of each request and review it in **Settings > People > Access requests**. Choose **Review**, then:

1. For a client or vendor, open **Who is this client?** (or **Who is this vendor?**) and choose them from the full list of Contacts: a person, or their client record or vendor company. Exact email matches are listed first. Picking a company adds them as a person there. If nobody matches, leave it on **Add as a new client** (or vendor) and Compass makes a new directory record from what they entered. For a vendor, also choose **Subcontractor** or **Supplier**.
2. For an employee, choose their staff role. Administrator access is never given from a request.
3. Select **Approve**. Compass links the directory person to their login, adds them to the company with that role, and opens every job that directory person is on, the same way **Grant project access** does. For a client it also opens jobs whose owner contact names no directory person yet (common for owners imported from Buildertrend) when that job contact or its client record has the requester's own sign-in email. Jobs kept staff-only are not opened; invite them from the job if they should see it. The person gets an email from you saying they're approved.

Select **Decline** to send a short, polite email instead; nothing is shared. Each decision records who made it and when, and appears in Activity.

## Verify Access {#verify-access}

After inviting, confirm Compass reports success, the person appears on the correct project, and the role and feature permissions fit their work. Open **Owner preview** or **Vendor preview**, then choose the exact assigned person in **Preview as**. The preview follows that person's project records, emails, and files. With no person selected, private records stay hidden. People who haven't accepted their invitation yet are listed as **(invited)**; previewing one shows the workspace they will have once they accept, matched to their project contact by email.

Internal staff can use this read-only preview by default; administrators can narrow **External person preview** in **Settings > Permissions**. Preview visits do not send messages, save drafts, confirm work, mark messages read, or change the person's notification settings. Return to the staff workspace to make changes.

If the person does not appear in the invitation list, check that the contact is active, assigned to the current project, has a valid email, and that you have invitation permission.

## Correct Mistakes Safely {#correct-mistakes}

Stop before inviting either record when you find a likely duplicate. Ask an administrator to reconcile identity and assignments. If access was granted to the wrong person or project, treat it as a potential data-exposure issue and contact an administrator immediately.

## Compare the Directory with Sage {#compare-sage}

Use **Compare clients with Sage** to search Compass clients and the read-only Sage directory side by side. Request a fresh Sage list when needed and compare the names and exact Sage identifiers. Selecting a pair does not link or merge it. Imported links can use their verification workflow; other identity links still require the review appropriate to that record. Proposed Sage edits and new Sage people require approval by staff with Sage review access (a second person when **Settings > Workflows > Sage contact review** requires it) and confirmed read-back.

Project-phase contacts remain project assignments, separate from the underlying Sage client. Reuse an existing named person when assigning the same client to another phase instead of creating a duplicate.

## Merge Duplicate Companies or People {#merge-contacts}

Authorized directory managers can select duplicate company records or use **Merge 2 people** within a company. Choose the record to keep and review linked identities, project relationships, and any conflicts before confirming. Imported directory identities can be eligible for merging, but a conflicting Sage identity must be resolved through the proper review. A merge reconciles directory records; it does not authorize an unrelated Sage write or an invitation. Use the permission-appropriate delete action only for an unnecessary record and review the displayed dependencies first.

## Add a Client Person to a Client Company {#join-client-company}

A client record for one person (for example someone who belongs to a society or association) can join that client company. Open the client in **Contacts**, choose **Company**, and search for the company. Only existing client companies are listed, and only a standalone client record shows this list. Compass then shows what will happen; choose **Join company** to confirm. In one step:

- The person is listed under the company's people, with the record's name, email and phone. If the company already has a person with the same email, that person is used instead of adding a second one; if the record already had its own copy of this person, that copy is used or merged into it.
- The client record is merged into the company, the same way **Merge duplicate companies** works: its jobs, invoices and history move to the company, and the merge history keeps a copy of what moved.
- Every job contact for the record now names the company and this person. Job contacts are updated, never deleted and re-added, so imported conversations and invitations still point at them. A job contact that names another person on the record keeps that person, who also joins the company.
- If the person has a Compass sign-in, it moves to their person at the company. Their sign-in email stays locked as before.

The action is recorded in **Activity**. A client linked to Sage cannot join a company, because the merge would hide that Sage client; nothing is changed or sent in Sage. Joining cannot be undone from Contacts, and there is no **Leave company** yet.

## Review Imported Names {#needs-review}

**Contacts > Needs review** lists people on imported conversations that Compass could not match to one person. Each row is one name or email across every project and conversation, with how many projects and messages it appears on; the count on the tab is the true number of names. A row such as **Name <email>** stands for every message that named that address.

Administrators can choose **Match automatically…** first. Compass shows a preview before it changes anything: how many names it can match, how each was matched, and the largest matches, so you can check them. It matches only clear cases:

- **Staff** by their sign-in email, their other email addresses (**Settings > Team**, open the person), and your **Company email domains** (**Settings > Workflows**), where the part before the @ matches a staff member. Staff records without a Compass account (for example former employees, archived or not) are matched the same way by the email on their staff record (the exact address first, then the same part before the @ on one of your company email domains). Staff with a real account always win over such a record, and when the part before the @ fits several different people nothing is decided. Staff always win over a vendor or client record that carries the same address. Add old addresses and domains before you run it.
- **One person with many rows**: the same email, or the same name on rows that share an email or a directory person, is one person.
- **A vendor's email domain**: an address on a business domain that exactly one vendor's people use becomes a new, uninvited contact of that vendor. Free email services (Gmail, Yahoo, Outlook and the like) and your own domains are never matched this way.

For the names that are left, choose **Pick person**, **Split into people** (for several names run together), or **Leave as is**. One choice applies to every row of that name on every project. When an email's domain points to a vendor (the same domain, or a company name that reads like it, such as acmesteel.com for Acme Steel Inc), **Pick person** offers **New contact of** that vendor as a suggestion; it is never applied without your choice.

Projects that keep imported conversations staff-only (for example a legal hold) are left out by default: their rows stay listed and read only, and a choice on a name skips them. To clean up duplicates there too, an administrator can tick **Include projects whose imported conversations are kept staff-only** in **Match automatically…** or in the choice dialog for a name; the preview counts change to include them. Matching a person never changes who can see a conversation: those conversations stay staff-only. Resolving never shares a conversation, invites anyone, or sends a notification or email; conversations stay staff-only until you use **Share with owner/vendor…**. Each choice, and each automatic run, is recorded once in Activity.

## Connect Unassigned People {#unassigned}

**Contacts > Unassigned** lists people added from imported messages who are not connected to a vendor or client yet, one row per person: addresses the import stored separately but that are the same email (also when written **Name <email>**) are shown as one person, and a choice applies to all of them.

Administrators can choose **Connect automatically…**. Compass first shows how many people it can connect, how each matched, and the companies they would join, so you can check them. It connects a person only when their email is the same as someone at a vendor or client, or their business email domain is used by exactly one vendor or client; each is connected the same way as **Connect to company…** (added to that company, or matched to the person already there, and linked on every project). Staff, recognized by their sign-in and other email addresses and your company email domains, are never connected to a company. Free email addresses never match by domain. A company whose name reads like the email domain is only a suggestion. People on projects that keep imported conversations staff-only (legal hold) are left as they are unless the administrator ticks **Include projects whose imported conversations are kept staff-only**; the preview counts change to include them, and those conversations stay staff-only. Nobody is invited, notified or emailed, and the run is recorded once in Activity. Everyone else stays in **Unassigned** for **Connect to company…**.

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
