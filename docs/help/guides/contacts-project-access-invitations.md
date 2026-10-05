---
{
  "id": "contacts.access",
  "featureId": "project-contacts",
  "slug": "contacts-project-access-invitations",
  "title": "Contacts, Project Access, and Invitations",
  "summary": "Manage directory contacts, duplicate merges, project assignments, invitations, and access verification.",
  "contextSummary": "A contact record, a project assignment, and a Compass login are separate. Search first, assign the correct project, then invite and verify access.",
  "category": "Start Here",
  "tags": ["contacts", "duplicate contacts", "merge", "access", "permissions", "invitations", "resend invitation", "users", "Sage comparison", "client matching"],
  "audiences": ["staff"],
  "permissions": ["help:read", "vendor:read"],
  "routes": ["/dashboard/contacts", "/dashboard/projects/[id]/contacts"],
  "owner": "Compass product team",
  "lastReviewed": "2026-10-05"
}
---

## Directory, Project, and Login Are Separate {#directory-vs-access}

Compass keeps the company directory, project assignments, and user access separate. A directory contact is an address-book record. Assigning that contact to a project records a business relationship. Neither action creates a login or sends an invitation.

The safe sequence is **search the directory, assign the project, invite the person, then verify their view**. This separation prevents a contact from receiving project information merely because their name appears in the directory.

## Search Before Creating {#search-before-creating}

Open **Contacts**, choose the relevant customer, vendor, or internal directory, and search by person, company, and email. Check spelling variations before adding a record.

Use one directory record when the same company works on several projects. Use separate person records when individuals need separate accounts. Do not create placeholder users for “TBD,” and do not recreate employees as customers or vendors.

Clients, vendors, and internal people are separate Contacts views. A client or vendor company can contain several named people. Open the company action menu to view those people. Staff can have separate permissions to edit each directory under **Settings > Permissions**. An external user sees only a person explicitly linked to their own Compass account, not the full directory.

For a Sage-linked record, choose **Propose Sage edit** rather than directly changing its contact fields. Request a current Sage refresh first; the read must be recent. The proposal appears in **Sage review** for an authorized reviewer other than the proposer. When Sage contact sync is enabled, approval queues a Sage update, and Compass updates the contact only after the bridge reads it back. Approval is unavailable while writes are paused. If Sage changed in the meantime, the proposal is held as a conflict. Employee home addresses are never shown in project contact lists and require a separate confidential-contact permission for staff review.

For an unlinked contact, **Verify Sage link** looks up the exact Sage number without changing the directory record. Only one lookup can be active for a contact: selecting the same number again reuses a pending lookup, while a different number requires rejecting the existing candidate in **Sage review** first. If a read-back is older than 15 minutes or an employee name was not returned, use **Refresh Sage read-back** in the review. This requests a new read of the same number and retains the review history; it does not link the contact or write to Sage. Compare the fresh Sage evidence before linking. An employee may review their own matching-name link only when individually granted **Self-review Sage employee identity** under **Settings > Permissions**; other identity links require a separate reviewer.

## Compare Clients with Sage {#compare-clients-with-sage}

Authorized reviewers can open the **Clients & Leads** view and choose **Compare with Sage**. Use **Request fresh list** when the displayed Sage capture is missing or outdated, then search the Compass and read-only Sage lists side by side. Select one record from each list and compare the legal name, exact Sage number, email, and any existing Compass claim.

Selecting a pair does not link, merge, or transfer anything. **Look up selected pair in Sage** starts the normal verification workflow, which still requires a fresh read-back and approval in **Sage review**. Stop and investigate when a Sage number is already claimed, several Compass records claim it, or the Compass client already has a different Sage identity. Never resolve a possible duplicate by choosing the closest name alone.

## Add and Invite a Contact {#add-and-invite}

1. Create or correct the directory record, paying special attention to the email address.
2. From the project **Contacts** page, add the existing contact to that project. An account administrator can also use **Manage Compass access** within Contacts to select multiple accounts and grant specific projects together.
3. Review the project, contact type, email, intended role, and audience visibility.
4. Select **Invite contact** and review the project and welcome message before sending.

For a new user, Compass creates a secure account invitation. For an existing user, Compass adds the explicit project assignment. Neither path grants unrelated projects.

If the contact already has a pending account invitation, the action changes to **Resend invitation**. Review the current email address and editable welcome message before resending. Resending uses the current account invitation and does not add access to any other project.

Linking a person to a Compass account is a separate, deliberate administrator action. Use **Compass account** beside the named person and choose the exact login. Never decide a match by email alone; the account link does not grant project access by itself.

## Verify Access {#verify-access}

After inviting, confirm Compass reports success, the person appears on the correct project, and the role and feature permissions fit their work. For an owner or project partner, use the appropriate audience preview when available.

If the person does not appear in the invitation list, check that the contact is active, assigned to the current project, has a valid email, and that you have invitation permission.

## Merge Duplicate Contacts {#merge-duplicates}

Authorized staff can select exactly two client/lead companies or two vendor companies in **Contacts** and choose **Merge 2 duplicates**. For duplicate people, open the company and select two people. Review the preview and deliberately choose the record to keep.

The other record is archived, its project links are moved to the survivor, and the merge and archived details remain in the audit history. The merge does not overwrite the survivor's phone, email, or address, merge Sage records, grant Compass access, or combine two different Compass login identities. Review any different contact fields first and copy needed current information into the record you intend to keep.

Compass blocks unsafe merges, including conflicting Sage identities or person records linked to different Compass accounts. Stop and resolve the identity conflict instead of bypassing it. After a merge, verify the surviving contact, named people, project assignments, Sage link, and Compass account link before sending an invitation.

## Correct Mistakes Safely {#correct-mistakes}

Stop before inviting either record when you find a likely duplicate. Use the authorized merge preview or ask an administrator to reconcile identity and assignments. If access was granted to the wrong person or project, treat it as a potential data-exposure issue and contact an administrator immediately.

## Quick Check {#quick-check}

- [ ] I searched for an existing contact.
- [ ] The person's name, company, category, and email are correct.
- [ ] The contact is assigned only to intended projects.
- [ ] The role and audience visibility are appropriate.
- [ ] I verified the recipient's view after inviting.

See [Navigating projects](/dashboard/help/navigating-projects) and [Requesting help](/dashboard/help/requesting-help).
