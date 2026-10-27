---
{
  "id": "settings.company",
  "featureId": "help-resources",
  "slug": "company-settings",
  "title": "Company Settings, Workflow Rules, and Drive Filing",
  "summary": "Maintain department identity, follow-up rules, Nu-Tech email settings, travel charges, and the project paper trail.",
  "contextSummary": "Settings changes affect company-wide workflows and future outputs. Review permissions, save deliberately, and verify the actual document, mailbox, or Drive copy.",
  "category": "Start Here",
  "tags": ["settings", "Company", "Departments", "Workflows", "paper trail", "Drive", "trusted addresses", "project aging", "travel", "zone charges"],
  "audiences": ["staff"],
  "permissions": ["help:read"],
  "routes": ["/dashboard/settings"],
  "owner": "Compass product team",
  "lastReviewed": "2026-10-25"
}
---

## Maintain Department Identity {#departments}

Open **Settings → Company → Departments** and select the department. The company owner can save its Compass name, document/email and legal names, contact details, mailing address, license number, website, office hours, logo, and Workspace sending address and sender name. Documents, emails, portals, and print views read this identity. Use a PNG logo under 300 KB; a transparent background works best.

Save before choosing **Check sending mailbox**. This asks Google whether Compass may send as the saved address and sends no email. A successful check verifies mailbox authorization, not delivery to a particular recipient. Inspect the next generated document or email before sharing it. **Reset to defaults** restores built-in department values; it does not rewrite files already sent or saved.

## Set Follow-Up and Ordering Rules {#workflows}

Admins use **Settings → Workflows** for **Staff Message Desk** thresholds, stale reminders, **Project aging**, **Nu-Tech emails**, the catalog link, and **Project paper trail**. Follow-up thresholds use business days. Project aging measures time since logged client contact and must have an overdue threshold later than its follow-up-due threshold.

Nu-Tech settings supply manufacturer, warehouse, dealer, and template details. Department profiles supply the sending mailbox and office identity. Use [Conversations and notifications](/dashboard/help/conversations-and-notifications#message-desk), [Navigating projects](/dashboard/help/navigating-projects#project-follow-up), and [Nu-Tech orders](/dashboard/help/nutech-orders) for the operational steps.

## Review Travel Charges and Rates {#travel}

**Settings → Zone charges** controls travel-charge assumptions shown on the portfolio map. Authorized staff can also make per-job adjustments to zone and mountain charges. Review the location, rate, and job adjustment before using a suggested charge in pricing. **Settings → Rate book** manages accepted estimating rates; see [Financial workflows](/dashboard/help/financial-workflows#rate-book). Neither map layers nor a settings edit independently adds an approved accounting charge.

**Settings → Workflows → Weather & fire alerts** sets when the dashboard map's Weather and Fire & smoke layers flag a job: heavy snow or rain in 24 hours, wind gusts, extreme cold or heat, and how close an active wildfire must be. Each company sets its own limits. The same page holds the rules for scheduled work: which item titles each rule matches, what it checks (a low or high temperature, gusts, rain or snow), the limit, and how many days after the item to keep checking, plus whether at-risk items notify the assignee and the job's staff. See [Schedules and tasks](/dashboard/help/schedules-and-tasks#weather).

## Enable the Project Paper Trail {#paper-trail}

In **Settings → Workflows → Project paper trail**, choose **Off**, **Test projects only**, or **All projects**. Test mode needs selected projects before anything saves. Choose which supported record types to save: purchase orders, estimates, RFIs, and change orders. Set the quiet period after an edit and whether milestone copies are retained. Start with test projects and verify folder placement and privacy before expanding.

The working PDFs go to the mapped purchasing, working-estimate, communications, and change-order folders. Supported milestone events retain dated copies; later working edits replace the working copy. Records show their save state and an **Open copy** link. If a mapped folder is missing or a save fails, fix the mapping or reported error and verify a successful read-back. The paper trail begins Off by default and covers only the enabled project/type combination.

## Review Outside Drive Access {#trusted-access}

**Company email domains and trusted addresses** defines which recipients count as inside the company for paper-trail folder checks. The connected Google account's domain always counts. Add a company domain or a specific trusted personal address only after verifying who owns it and why it belongs in the internal audience; this is not a way to hide unintended sharing.

When the normal folder has other outside access, a copy is held in **Compass Records (internal)** and the warning identifies the outside access to review. This check changes where Compass files the copy; it does not revoke an existing Drive share. Correct inappropriate sharing in Drive and inspect the resulting copy. Deleting a Compass record preserves its last filed copy.
