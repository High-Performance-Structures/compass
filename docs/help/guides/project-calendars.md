---
{
  "id": "project.calendars",
  "featureId": "schedule",
  "slug": "project-calendars",
  "title": "Project Calendars in Google Calendar",
  "summary": "Give a job its own Google calendar with its schedule, events and client meetings, shared only with staff and kept up to date by Compass.",
  "contextSummary": "A project calendar is a Google calendar for one job, owned by the company's Compass Google account and shared view-only with staff (the job's team or all staff). It never goes to clients or vendors. Compass refreshes it every few minutes and replaces edits made in Google. Every job starts without one. Office staff create or remove a job's calendar on its Information page; admins can change which jobs get one in Settings → Workflows → Project calendars.",
  "category": "Field & Project Work",
  "tags": ["Google Calendar", "project calendar", "job calendar", "schedule", "milestones", "client meetings", "sharing", "sync"],
  "audiences": ["staff"],
  "permissions": ["help:read", "schedule:read"],
  "routes": ["/dashboard/projects/[id]/information", "/dashboard/settings"],
  "owner": "Office operations",
  "lastReviewed": "2026-10-24"
}
---

## What a Project Calendar Is {#overview}

A **project calendar** is a Google calendar for one job, named like **Compass – O-152-00 Reiter Residence**. It lets anyone following the job see its dates in Google Calendar on their phone or computer, next to their own meetings.

The company's Compass Google account owns every project calendar, so nothing depends on one person's account. Compass is in charge of what's on it. When a date changes in Compass, the calendar updates within a few minutes. Changes made in Google are replaced, so make changes in Compass. Each event has an **Open in Compass** link.

Project calendars are **staff only**. They're never shared with the job's clients, owners, subcontractors or suppliers, even when those people are on the project in Compass.

## What's on It {#whats-on-it}

Depending on your company's settings, a project calendar shows:

- **Milestones** and **other schedule items** from the job's schedule, as all-day items
- **Work Calendar events** for the job that everyone in the company can see. Private and invite-only events stay off.
- **Client meetings** booked with **Meet with client**, at their times, with the Google Meet link

Events show as **free** time and don't send reminders, so the calendar never blocks anyone's availability. Items appear from a couple of weeks back to several months ahead.

## Who Can See It {#sharing}

Compass shares the calendar **view-only** with either the staff on the job's team or all staff, depending on the company setting. When someone joins or leaves the team, Compass adds or removes their access within a few minutes. People who don't use the company's Google Workspace accounts can't be added.

Compass also adds the calendar to each person's Google Calendar list once, so they don't have to accept an invitation. Anyone can hide it, recolor it, or remove it from their list in Google like any other calendar.

## Create One for a Job {#turn-on}

Every job starts **without** a Google calendar. To make one, open the job's **Overview → Information** page and find **Project Google calendar**. Office staff can:

- **Create Google calendar**: makes the calendar now and shares it
- **Update now**: refreshes it right away instead of waiting a few minutes
- **Open in Google Calendar**: opens it, once it's shared with you
- **Remove Google calendar**: deletes the calendar from Google for everyone it was shared with. Nothing in Compass changes, and you can create it again later.

When every open job gets a calendar, closing a job (any status other than open or warranty) deletes its calendar from Google. **Use company setting** undoes a job's on/off choice.

## Company Settings {#company-settings}

Admins manage project calendars in **Settings → Workflows → Project calendars**:

- **Which jobs get a calendar**: **Only jobs staff choose** (the default, so no job has one until staff create it), **Every open and warranty job**, or **Not offered**, which hides the option on every job
- **Shared with**: staff on the job's team, or all staff
- **Add it to each person's Google Calendar**: put the calendar in each person's calendar list automatically
- **Never share with**: people who never get project calendars, such as system accounts
- **What goes on each calendar**: milestones, other schedule items, Work Calendar events, and client meetings
- **Days back** and **Days ahead**: how much of the past and future is shown

Project calendars need the company's Google Workspace connection with permission to create calendars, share them, and add them to staff calendar lists. Your Google Workspace admin grants these once in Google Admin.

## Project Calendars and My Compass {#my-compass}

**My Compass** is each person's own calendar of the work assigned to them across all jobs. A project calendar is one job's full schedule for everyone following it. Many people use both. See [My Compass Calendar in Google Calendar](/dashboard/help/my-compass-calendar).
