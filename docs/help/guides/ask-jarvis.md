---
{
  "id": "jarvis",
  "featureId": "agent",
  "slug": "ask-jarvis",
  "title": "Ask Jarvis: What It Can Do",
  "summary": "Use Jarvis to find project records and messages, ask about a screenshot, manage schedules and dashboards, change themes, and remember context.",
  "contextSummary": "Jarvis uses live Compass tools for permitted data and actions. Schedule changes and dashboard deletion wait for Confirm; a proposed action is not a completed action.",
  "category": "Start Here",
  "tags": ["Jarvis", "Ask Jarvis", "AI assistant", "search", "unread messages", "schedule", "confirm", "dashboards", "themes", "memory", "screenshot"],
  "audiences": ["staff"],
  "permissions": ["help:read", "agent:read"],
  "routes": ["/dashboard"],
  "owner": "Compass product team",
  "lastReviewed": "2026-10-28"
}
---

## Start with a Clear Request {#start}

Open **Ask Jarvis**, state the project number or full name, and explain the result you need. Jarvis knows the current page, but confirm the project when requesting a change. Include the date range, record type, or message phrase when useful. You can ask follow-up questions in the same conversation.

Jarvis is an internal staff capability controlled by agent permissions. Owners, trade partners, and guests use their audience-specific Help and project workspaces. Other tools still enforce their own access rules and connection requirements.

## Find and Summarize Live Compass Records {#find-records}

Jarvis can query customers, vendors, projects and their details, invoices, vendor bills, schedule tasks, project-operation records, daily logs, owner updates, and RFIs. Ask for a summary, comparison, or a short list with links to the source. Project, daily-log, owner-update, and RFI results provide live Compass links so you can inspect the actual record.

Examples: “Find this job's latest daily logs and summarize issues”; “Show the current RFIs for this project”; “Find the latest owner update and open it”; “Look up this vendor and its bills.” Queries return a bounded set of records. Ask for a narrower search or additional results before treating a summary as a complete reconciliation. Accounting data is the Compass view of those records; verify posting and payment in the Sage workflow.

## Read Conversations and Unread Messages {#read-messages}

Jarvis can list the channels you can see, report their unread counts, read recent messages, and search message text. Searches can be narrowed to one channel, a recent number of days, and a result limit. Answers can include the conversation, author, time, and a link.

Examples: “Do I have unread messages?”; “Summarize the newest messages in this project channel”; “Find messages about the inspection from the last seven days.” These built-in tools search Compass conversation channels. They do not search every external mailbox or every separate project email-history record, and they do not send, edit, delete, or mark messages read. Open the result and use the correct workspace to reply.

## Read and Change Project Schedules {#schedule-actions}

Jarvis can read a full project schedule with tasks, dependencies, workday exceptions, counts, overall completion, and critical-path summary. It can create tasks or milestones, update titles, start dates, workday durations, phases, status, progress, and assignees, delete tasks, and create or remove predecessor relationships. Relationships include finish-to-start, start-to-start, finish-to-finish, and start-to-finish with working-day lag; cycle checks still apply.

Examples: “Show this project's critical path”; “Add a three-workday framing task starting October 19”; “Move this inspection to October 22”; “Make drywall start after insulation finishes.” Jarvis first reads the schedule to resolve task names. Review the proposed change and press **Confirm** before it runs. Deleting a task also removes its dependencies. Inspect downstream dates afterward. These tools do not publish a schedule, create a baseline, or change workday exceptions; use [Schedules and tasks](/dashboard/help/schedules-and-tasks) for those workflows.

## Report a Problem or Request a Change {#file-feedback}

Tell Jarvis about a problem or a change you'd like, such as "The schedule won't save my end date." Jarvis offers to file it with the Feedback Desk and shows the request with **Confirm** and **Cancel**. Once you confirm, it is filed under your own name, you get the usual receipt, and it appears in **Conversations & Requests → My Requests**. See [Requesting help](/dashboard/help/requesting-help).

## Build and Manage Custom Dashboards {#dashboards}

Jarvis can turn retrieved data into a structured display such as tables, charts, statistics, or a dashboard. Ask it to fetch the relevant data first, then specify what to show. It can save the currently rendered display as a named custom dashboard, list your saved dashboards, load one for editing, save an update, and delete one after confirmation.

Examples: “Show these invoices in a table and chart”; “Save this view as Weekly review”; “List my saved dashboards”; “Load Weekly review and simplify its layout.” A generated dashboard displays the supplied data; verify its scope and refresh the underlying data before relying on it as a current report. Deleting a custom dashboard does not delete its source project records.

## Open Pages and Show Notices {#navigate}

Jarvis can navigate to supported Compass pages, including the dashboard, Contacts, Projects, project details, schedules, daily logs, owner updates, RFIs, photos, Financials, People, Files, Conversations, Settings, and saved boards. It can show an on-screen notice. Ask “Open this project's daily logs” or follow a live record link when available. A toast or navigation action alone is not proof that a record was saved.

## Choose or Create a Theme {#themes}

Jarvis can list available preset and personal themes, switch your theme, generate and save a custom theme with light and dark colors and typography, and edit an existing custom theme. Ask “List my themes,” “Switch to Notebook,” or “Create a readable theme with larger spacing.” Presets are selected as supplied; edits apply to custom themes. This changes appearance, not record permissions.

## Remember Preferences and Decisions {#memory}

Ask Jarvis to remember a preference, workflow, fact, or decision for later and to recall your saved context by topic. For example, “Remember that I want short project summaries with source links” or “What did we decide about our reporting workflow?” These built-in memories are stored for your Compass user and organization; do not assume another user's chat or a separate assistant shares them. Never save credentials, authentication codes, or secret links as memories. A remembered decision is context; confirm current project state with a live lookup.

## Ask About a Screenshot {#screenshots}

Attach up to two screenshots with the image button in the chat box and ask your question, such as "Why is this task showing late?" or "What does this error mean?" Jarvis reads the images along with your message. Crop out anything private that doesn't need to be shared, and open the actual record before acting on what Jarvis says.

## Review Confirmations and Verify Results {#confirm}

Built-in task creation, task updates, task deletion, dependency creation/removal, Feedback Desk requests, and custom-dashboard deletion show an action summary with **Confirm** and **Cancel** in chat. Until you press **Confirm**, nothing in that pending action has changed. Check the exact target and proposed values. **Cancel** leaves it unchanged. Confirmations expire after about ten minutes; if one expires, ask Jarvis to prepare it again after checking current state.

Wait for **Done.** or an explicit successful tool result, then open the actual record. If the action fails, preserve the message and check current state before retrying. Each confirmation can be used once; to repeat a change, ask Jarvis again.

## Know When to Use the Dedicated Workflow {#limits}

Jarvis can draft wording, explain Help, and analyze the data returned to it. Its current built-in record queries are read-only except for the schedule, feedback, dashboard, theme, and memory actions listed above. They do not create daily logs, publish owner updates or social posts, send project email, approve contracts, post accounting entries, or record payments. Use the corresponding workspace for those actions, or a separately available authorized integration.

Owner Update editors have their own Jarvis drafting control; see [Owner updates](/dashboard/help/owner-updates#draft-with-jarvis). Drafting there does not publish. If a tool or provider is unavailable, use Help and the dedicated Compass page, keep unfinished work, and [report the exact error](/dashboard/help/requesting-help).
