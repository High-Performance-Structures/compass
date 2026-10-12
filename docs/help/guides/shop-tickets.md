---
{
  "id": "shop.tickets",
  "featureId": "financials",
  "slug": "shop-tickets",
  "title": "Shop Tickets, Sage Labor Hours, and Pay Applications",
  "summary": "Create, issue, and void shop tickets; pull eligible labor hours from Sage; and include issued tickets in pay applications.",
  "contextSummary": "A draft shop ticket can be corrected or deleted. Issuing freezes its number and rates, and only issued, non-void tickets count toward the pay application.",
  "category": "Financial Workflows",
  "tags": ["shop ticket", "labor hours", "Sage timecards", "machine hours", "rate book", "pay application", "void", "paper trail"],
  "audiences": ["staff"],
  "permissions": ["help:read", "finance:read"],
  "routes": ["/dashboard/projects/[id]/shop-tickets", "/dashboard/projects/[id]/financials/pay-applications/[applicationId]", "/dashboard/settings"],
  "owner": "Accounting operations",
  "lastReviewed": "2026-10-12"
}
---

## Create a Draft Ticket {#create-draft}

Open **Project Financials → Shop Tickets** for the correct project. Add lines with an active cost code, choose **Labor** or **Machine**, enter the hours, and save the draft. A draft can be edited or deleted with confirmation. Verify the project, work date, description, cost code, type, and hours before issuing.

## Review Rates and Budget {#rates-and-budget}

Shop-ticket rates come from the active **Settings → Rate book**. Compass copies the applicable rate onto the ticket when it is issued so a later rate-book change does not rewrite history. Review the calculated amount and any budget mismatch. Issuing a mismatch requires the correct code or change order, or an explicit confirmation that the review is complete.

Shop-ticket numbering and document heading are configured in **Settings → Workflows → Shop tickets**. A number is assigned on first save and is never reused after issue, including when the ticket is later voided.

## Get Labor Hours from Sage {#sage-labor-hours}

Set the draft's labor dates, then choose **Get hours from Sage**. Compass shows read-only timecard hours for the project and period without exposing employee pay rates. Select the eligible rows and use **Add to ticket** to create labor lines.

Compass prevents the same Sage timecard hours from being billed on two active tickets. Removing the line from a draft or voiding its issued ticket releases that link. If a Sage cost code has no valid Compass match, correct the mapping in Sage and refresh rather than recoding the employee's time to a convenient line. Machine hours remain manual.

## Issue or Void a Ticket {#issue-and-void}

**Issue ticket** freezes its number, lines, rates, and amount. Review the PDF and any budget warning first. An issued ticket cannot be edited or deleted; use **Void ticket**, enter a clear reason, and confirm. The retained PDF and history are marked void so the original sequence remains auditable.

When the project paper trail is enabled for shop tickets, wait for the saved Drive copy and use its open action to verify the correct project folder and PDF. Drive filing does not issue the ticket or post anything to Sage.

## Include Tickets in a Pay Application {#pay-application}

Enter the intended **Pay app** number and **Billing month** before issuing. The pay-application workspace lists tickets whose saved number matches that Compass pay application. Only issued, non-void tickets are included in its shop-ticket total. Confirm the ticket numbers, labor dates, amounts, and supporting PDFs before relying on the total. A draft or void ticket remains visible for history but does not increase the application; an arbitrary number that does not match a Compass pay application will not appear on that application's page.

## Quick Check {#quick-check}

- [ ] Project, work date, cost code, type, and hours are correct.
- [ ] The copied rates and budget warning were reviewed.
- [ ] Sage timecard hours were not already used on another ticket.
- [ ] I understand that issuing freezes the ticket and its number.
- [ ] Only issued, non-void tickets are counted in the pay application.

See [Financial workflows](/dashboard/help/financial-workflows) and [Company settings](/dashboard/help/company-settings).
