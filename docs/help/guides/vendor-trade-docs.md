---
{
  "id": "vendor.tradedocs",
  "featureId": "help-resources",
  "slug": "vendor-trade-docs",
  "title": "Vendor Trade Docs",
  "summary": "Track W-9s, insurance certificates, licenses, agreements and info sheets for each vendor, and request missing ones with a secure link.",
  "contextSummary": "Trade docs live in each vendor's Google Drive folder; Compass records what was received, when it expires, and who checked it. A docs request emails the vendor a no-login link; replies and uploads come back to the vendor's trade docs.",
  "category": "Company Workflows",
  "tags": ["trade docs", "W-9", "certificate of insurance", "COI", "workers comp", "business license", "trade agreement", "info sheet", "vendor", "subcontractor"],
  "audiences": ["staff"],
  "permissions": ["help:read"],
  "routes": ["/dashboard/contacts"],
  "owner": "Company operations",
  "lastReviewed": "2026-10-28"
}
---

## What Each Vendor Needs {#requirements}

Open **Contacts > Vendors**. The **Trade docs** column shows how many required documents each vendor has on file. Select it, or choose **Trade docs** from the vendor's menu, to see each document, when it expires and who recorded it.

What each kind of vendor must have is set in **Settings > Workflows > Trade docs**. A vendor's kind is its category in the directory, such as Subcontractor or Supplier.

Files stay in the vendor's folder in Google Drive. Compass keeps a link to each file, not a copy. Removing a document from Compass leaves the file in Drive.

## Request Missing Documents {#request}

In the vendor's trade docs, select **Request docs**. Choose who to send it to, check which documents to ask for (anything owed is checked for you) and add a note. Then select **Send request**.

The email lists the documents and who certificates must name. It includes a secure link that works without an account until the date shown. From the link, the vendor can:

- upload each document, with its expiration date
- download your blank forms, when a form link is set in Settings
- send an accepted alternative instead, such as the no-employees forms in place of a workers' comp certificate
- fill in and sign the info sheet online, which is saved as a PDF in their Drive folder
- have Compass email your certificate holder details to their insurance agent, with a link of the agent's own for uploading certificates

Each upload becomes the vendor's current document of that type, and the older one moves to the history. You get a notification for each one. Check certificates before you rely on them, then use **Edit** to tick the certificate check.

## Replies and Links {#replies}

Replies to the request come back to the vendor's trade docs under **Requests and replies**, and to you. Compass saves attachments from a reply into the vendor's Drive folder. To record one, select **Upload** on its line and choose the saved file.

The same list shows every link you've sent, when it was opened and when files came in. Select **Turn off** to stop a link right away. Documents already received stay.

## Settings {#settings}

**Settings > Workflows > Trade docs** controls:

- the documents, who needs them, when they expire and how early to warn
- the certificate check and the links to your blank forms
- the Drive folder for vendor folders, and what happens to bills while documents are missing
- which company vendors see, how long links work, the note to vendors and the certificate holder text
- the online info sheet's questions. Mark which questions hold the agent's name and email, so the vendor can send the request on to their agent.

The info sheet's answers, including tax IDs, are kept only in the PDF in the vendor's Drive folder, not in Compass.
