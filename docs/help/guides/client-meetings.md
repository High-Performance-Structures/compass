---
{
  "id": "client.meetings",
  "featureId": "schedule",
  "slug": "client-meetings",
  "title": "Meet with a Client on Google Meet",
  "summary": "Start or schedule a Google Meet with a project's clients, transcribe it automatically, review the transcript as a draft daily log, and cancel a meeting.",
  "contextSummary": "Client meetings are Google Meet calls hosted from the booking staff member's own Google Calendar. Google emails the invitations; Compass keeps the meeting on the project and logs it in Activity.",
  "category": "Field & Project Work",
  "tags": ["Google Meet", "client meeting", "video call", "invite", "calendar", "owner", "clients"],
  "audiences": ["staff"],
  "permissions": ["help:read", "schedule:read"],
  "routes": ["/dashboard/projects/[id]"],
  "owner": "Office operations",
  "lastReviewed": "2026-10-24"
}
---

## Start or Schedule a Client Meeting {#meet-with-client}

Open the project and choose **Meet with client** under **Client meetings** on the right side of the page.

- **Start now** opens the Google Meet in a new tab right away and emails the link to everyone you invite.
- **Schedule** books the call for a date and time. Google sends each guest a calendar invitation with the Meet link and phone dial-in details.

Pick the meeting length, check the title, and choose who to invite under **Clients and guests**. The project's client contacts are listed first, and you can type any email address. Guests don't need a Compass or Google account. Add coworkers under **Staff** if they should join. They get the invitation and a Compass notification. A note you add appears in the invitation.

## Who Hosts the Call {#host}

The meeting goes on your own Google Calendar, so you are the host. You admit guests who knock. Google saves the transcript and any recording to your Google Drive, and Compass copies the transcript to the project's Meeting Notes folder and a draft daily log. Your Compass account must use your company Google Workspace address. If it doesn't, an administrator can set your Google email mapping in Settings.

## Transcripts {#transcripts}

**Transcribe automatically** is on when you book a meeting. Google starts the transcript when the call begins and tells everyone on the call. Turn it off for calls that shouldn't be transcribed. If it's off, or Compass couldn't turn it on, press **Transcribe** in Meet during the call.

About 10 to 20 minutes after the call ends, Compass saves the transcript two ways:

- **A PDF in the project's Meeting Notes folder** (13_MeetingNotes) in Drive. Open it from the **Transcript** link under **Client meetings**.
- **A draft daily log** on the meeting date, written as the host. It has the full transcript text, so you can search for it in Compass. Open it from the **Daily log** link under **Client meetings**.

The daily log starts as an **internal draft**. The client can't see it. To share it, review the log, trim anything that shouldn't go to the client, and make it client-visible the same way as any other daily log.

The PDF stays internal. If the Meeting Notes folder is shared with the client or vendors, Compass saves it in the project's private records folder instead. If the whole project folder is shared outside the company, Compass doesn't save it and shows **Transcript not saved**. **No transcript** means nobody transcribed the call.

## What Clients and Vendors See {#guest-view}

Guests join from the link in their invitation. Clients and vendors who use Compass also see a **Join meeting** button on their project workspace while a meeting they're invited to is upcoming.

## Join or Cancel a Meeting {#join-cancel}

Upcoming meetings are listed under **Client meetings** with a **Join** button. **Cancel** removes the meeting from the host's Google Calendar, and Google emails a cancellation to every guest. Each meeting started, scheduled, or cancelled is recorded in the project's Activity.

## Quick Check {#quick-check}

- Is the client's email on the project's contacts? It's listed first when you invite.
- Did the guest get the invitation? Ask them to check spam for an email from Google Calendar. You can also copy the link from **Join** and send it yourself.
