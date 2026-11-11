---
{
  "id": "offline",
  "featureId": "project-hub",
  "slug": "offline-field-mode",
  "title": "Offline Field Mode",
  "summary": "Prepare the field app for offline use and safely synchronize queued work.",
  "contextSummary": "Open needed projects and files while online. Offline work remains queued on this device until Compass confirms synchronization.",
  "category": "Field & Project Work",
  "tags": ["offline", "field app", "mobile", "sync", "documents", "queue"],
  "audiences": ["staff"],
  "permissions": ["help:read", "project:read"],
  "routes": ["/dashboard/field"],
  "owner": "Field operations",
  "lastReviewed": "2026-11-10"
}
---

## Prepare While Online {#prepare}

Before service is lost, sign in, open and refresh every active project you expect to use, and open or save the documents needed offline. Confirm the app reports **Online** and **Up to date**. A project or Drive link that has never been loaded may not be available offline.

## Available Field Work {#available-work}

Field Mode focuses on active projects, today's work, daily logs, documents, messages, notifications, and basic settings. Administrative controls, broad financials, developer tools, and unrelated projects are intentionally excluded.

## Which Jobs Appear {#which-jobs}

Each job has one **Field app** choice, the same for everyone: **Automatic**, **Always show**, or **Hide**. Change it on the job's **Information** page, or for many jobs at once in **Settings → Workflows → Field app**, which lists every job that isn't closed and says whether each one is in the field app now.

- **Automatic** shows a job while its job status is in one of the company's field app phases (by default **Under construction** and **Closeout**) and its department isn't left out (by default the N department, material orders). Which job statuses belong to each phase is set in **Settings → Workflows → Portfolio map**, so moving a status such as Contract Docs Signed into Under construction there brings those jobs into the field app.
- **Always show** puts the job in the field app in any phase or department, for example a job still in preconstruction that a crew needs now.
- **Hide** keeps the job out of the field app.
- Closed jobs (Complete, Closed, Inactive, Bid Refused, or archived) never appear.

Who sees a job: anyone added to the job sees it while it is in the field app. When **Active Sage employees see every field app job automatically** is on (the default), staff whose internal contact is active and linked to a Sage employee record see every job in the field app without being added to each one. Clients, owners, trade partners and suppliers only ever see the jobs they were added to. After a job is switched on or off, the field app picks up the change by itself: while online, it checks for a new project list each time it opens or comes back to the screen (at most once a minute). To check right away, tap **Refresh** on the **Projects** tab. You do not need to sign out and back in. If a job you have open leaves the list, it stays open on that device, with any waiting work still syncing, until you choose another project. (Automatic refresh and the **Refresh** button need Android 1.0.9 or iPhone build 58 or later; older versions update the list only when you sign in.)

## Create Work Offline {#create-work}

Confirm the project, then create a supported log or message and choose the available save/queue action. Attach supported photos or files as needed. Queued work stays on the device until confirmed by the server.

Do not uninstall Compass, clear app storage, or sign out while an unresolved queue exists unless support directs you to do so.

## Synchronize After Reconnecting {#sync}

Open Compass, keep it open, and confirm status changes to **Online**. Allow queued records and attachments to upload, wait for **0 waiting** or **Up to date**, then open the project and verify each result. A queued message is not delivered and a queued log is not safely stored on the server until synchronization is confirmed.

## Sync Troubleshooting {#sync-troubleshooting}

Do not repeatedly resubmit the same work. Record the project, item, time, waiting count, and exact error. Keep the device and app data intact, then use Compass feedback or contact an administrator.

## Read Messages and Use Field Controls {#field-navigation}

Field Mode has roomier tabs, readable message content, and date controls that work in mobile browsers. Use the project and tab controls to confirm where you are before entering a log or reply. When you open full Compass from the app on a phone or tablet, the **Field Mode** button beside the sidebar control (or **Field** in the bottom bar on a phone) returns you to Field Mode. Browser layout improvements do not make uncached records or Drive files available offline; check the connection and queue indicators before assuming delivery.

## Log Out or Switch Accounts {#logout}

Available in Android 1.0.7 and iOS 1.0.1 or later. Open **Field settings** using the sliders icon, then choose **Account → Log out**. Compass blocks logout while saved work is waiting to sync or a transfer is running. Reconnect and keep the app open until the waiting count reaches zero. Android also needs a connection to finish stopping notifications for the signed-out account.

Confirming logout clears the device's sign-in, downloaded projects and files, and unfinished drafts. Work already synced remains in Compass. You can then sign in with another Compass account. Signing out of the app does not sign out of Safari or Chrome.

## Quick Check {#quick-check}

- [ ] Needed projects and files were opened while online.
- [ ] The correct project is active.
- [ ] I kept Compass open after reconnecting.
- [ ] The waiting count reached zero.
- [ ] I verified server records before retrying.
