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
  "lastReviewed": "2026-09-05"
}
---

## Directory, Project, and Login Are Separate {#directory-vs-access}

Compass keeps the company directory, project assignments, and user access separate. A directory contact is an address-book record. Assigning that contact to a project records a business relationship. Neither action creates a login or sends an invitation.

The safe sequence is **search the directory, assign the project, invite the person, then verify their view**. This separation prevents a contact from receiving project information merely because their name appears in the directory.

## Search Before Creating {#search-before-creating}

Open **Contacts**, choose the relevant customer, vendor, or internal directory, and search by person, company, and email. Check spelling variations before adding a record.

Use one directory record when the same company works on several projects. Use separate person records when individuals need separate accounts. Do not create placeholder users for “TBD,” and do not recreate employees as customers or vendors.

## Add and Invite a Contact {#add-and-invite}

1. Create or correct the directory record, paying special attention to the email address.
2. From the project **Contacts** page, add the existing contact to that project. For several projects, use the contact's project-access controls in the directory.
3. Review the project, contact type, email, intended role, and audience visibility.
4. Select **Invite contact** and review the project and welcome message before sending.

For a new user, Compass creates a secure account invitation. For an existing user, Compass adds the explicit project assignment. Neither path grants unrelated projects.

## Verify Access {#verify-access}

After inviting, confirm Compass reports success, the person appears on the correct project, and the role and feature permissions fit their work. For an owner or project partner, use the appropriate audience preview when available.

If the person does not appear in the invitation list, check that the contact is active, assigned to the current project, has a valid email, and that you have invitation permission.

## Correct Mistakes Safely {#correct-mistakes}

Stop before inviting either record when you find a likely duplicate. Ask an administrator to reconcile identity and assignments. If access was granted to the wrong person or project, treat it as a potential data-exposure issue and contact an administrator immediately.

## Quick Check {#quick-check}

- [ ] I searched for an existing contact.
- [ ] The person's name, company, category, and email are correct.
- [ ] The contact is assigned only to intended projects.
- [ ] The role and audience visibility are appropriate.
- [ ] I verified the recipient's view after inviting.

See [Navigating projects](/dashboard/help/navigating-projects) and [Requesting help](/dashboard/help/requesting-help).
