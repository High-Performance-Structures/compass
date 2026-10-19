---
{
  "id": "equipment",
  "featureId": "equipment",
  "slug": "equipment-and-machine-logs",
  "title": "Equipment and Machine Logs",
  "summary": "Set up company machines, record hours and costs, review service needs, and approve entries for Sage handoff.",
  "contextSummary": "Machine entries affect project cost and equipment history. Confirm the machine, job, date, hours or cost, meter reading, and approval state before accounting handoff.",
  "category": "Field & Project Work",
  "tags": ["equipment", "machines", "machine log", "running hours", "standby", "idle", "fuel", "maintenance", "repair", "service schedule", "rate book", "Sage"],
  "audiences": ["staff"],
  "permissions": ["help:read", "finance:read"],
  "routes": ["/dashboard/equipment", "/dashboard/field"],
  "owner": "Field and accounting operations",
  "lastReviewed": "2026-10-19"
}
---

## Open the Equipment Workspace {#workspace}

Open **Office Tools → Equipment** to review active and retired machines, current hour meters, the last job recorded, upcoming service, entries waiting for approval, machine hours by job for the current month, and recent history. The totals at the top summarize running hours, fuel, service and repair cost, and services already due.

All internal staff can record machine work. Only staff with Equipment approval access can add or configure machines, change service schedules, and approve or reject entries.

## Set Up a Machine {#machine-setup}

Choose **Add machine**, enter a clear company name and the exact Sage equipment number, and link the machine to its accepted Machine entry in the rate book. The linked rate is the running rate used for project charges and shop tickets. Add standby and idle rates only when those hours should be priced separately. Record the current hour meter and keep **Active** on while the machine should appear in logging choices.

Open a machine's gear to correct its setup. If a machine has log history, retire it by turning off **Active** instead of removing it. Removing a machine requires confirmation and is blocked when history depends on it.

## Log Machine Time or Cost {#machine-log}

Choose **Log machine entry**, then select **Hours**, **Fuel**, **Maintenance**, **Repair**, or **Other**.

- For **Hours**, choose the machine, work date, and job; record running, standby, and idle hours, the operator and cost code when known, and the current hour meter. Review the displayed project charge before saving.
- For fuel or another cost, record the amount, vendor, payment method, hour meter, and job when the cost belongs to one. Leave the job blank only for genuine machine overhead.
- For maintenance or repair, record parts and outside cost, internal shop hours, meter, notes, and the scheduled service performed when applicable. Selecting a scheduled service updates when that service is next due.

An entry starts in **Waiting for approval**. Saving it records operational work; it does not by itself prove that Sage accepted an accounting entry.

## Review and Approve Entries {#approval}

Equipment approvers should compare the machine, date, job, operator, cost code, hours, meter change, receipts or notes, rate-book charge, and intended Sage destination. Select one or more waiting entries and choose **Approve** only when they are ready for accounting handoff. Use **Reject selected** when the entry should not proceed, then coordinate the correction with the person who logged it.

Approved machine hours are destined for the Sage daily field report equipment line. Fuel and other costs are destined for a payable-invoice equipment cost line. Maintenance and repair can include both an equipment cost and internal shop labor. Confirm the read-back or accounting status before calling an entry posted.

## Maintain Service Schedules {#service-schedules}

In a machine's setup, add services such as oil changes, greasing, or inspections. A service may repeat by meter hours, calendar days, or whichever becomes due first. Enter the last completed meter and date so Compass can calculate **Soon** and **Due** correctly. When logging maintenance, choose the matching scheduled service to reset its due calculation.

Removing a service schedule requires care because it removes the reminder, not the machine's prior log entries. Verify meter readings whenever the service state looks wrong.

## Log from Field Mode {#field-mode}

Internal staff can use the active machine list available in Field Mode to record supported machine hours and costs. Confirm the active project before entering work. When offline, the entry remains in this device's queue; keep Compass and its app data intact, reconnect, wait for the queue to clear, and verify the entry in **Equipment** before retrying. See [Offline Field Mode](/dashboard/help/offline-field-mode#machine-log) for the device workflow.

## Correct an Entry {#correct-entry}

Use the pencil on an entry only while your role and its state allow changes. Use the trash control for an incorrect removable entry and review the confirmation. Do not delete accurate history merely to make totals look different. For an approved or Sage-related discrepancy, stop before creating a replacement and coordinate the correction so the project and accounting records do not duplicate the same work.

## Quick Check {#quick-check}

- [ ] The machine, date, job, operator, and cost code are correct.
- [ ] Hours, costs, rates, and the hour meter are reasonable.
- [ ] Service work updated the correct schedule.
- [ ] The approval state matches the actual review.
- [ ] I verified synchronization or Sage handoff before retrying.
