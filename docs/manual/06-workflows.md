# 6. Workflow flowcharts

Every flow in this chapter was traced from the code. The function names and status strings are the real ones, so a developer can search for them. Where a step could not be confirmed in code, the text says **(inferred)**.

## 6.1 Lead → estimate → contract → job

![Lead intake: number, records and accounting handoff](diagrams/flow-lead-intake.png)

![Estimate to contract](diagrams/flow-estimate-contract.png)

1. **Intake.** `createProjectIntake` (`src/app/actions/projects.ts`).
   - **Permissions.** It needs `project` create and `customers` read, plus `customers` create when it is creating a new customer.
   - **Validation.** It checks the client status, job status, job type and department.
   - **Duplicate check.** It returns `duplicateWarning` until the user confirms the new job is not a duplicate.
2. **Number.** `allocateIntakeProjectNumber` (`src/lib/domain/project/intake.ts`) takes the next sequence for the department, as described in section 2.1. A collision in the database batch is reported as a sequence conflict, and the user resubmits.
3. **One batch** (`intakeRecordStatements`, `intakeQueueStatements`) writes:
   - the project, the customer (inserted or updated) and the project contacts;
   - two `project_operations` rows: a tracker write, and an accounting handoff (`sage_project_handoff`, `sage_write_status: queued`);
   - an `ensure_client_and_job` row in `sage_client_project_write_operations` (status `queued`).
4. **After the batch.** The project's drive folder is provisioned from the department template. Tracker rows are appended. Activity `project.created` records the tracker, drive and accounting statuses. The on-premises writer then claims the queued operation and creates the client and job in accounting (section 7.1).
5. **Estimate.** Staff create a draft estimate, add lines and price them, then send it for signature in one of two ways:
   - `prepareEstimateForClientSignature` builds an e-sign envelope. It requires priced lines and a date, and creates client signers followed by a company signer.
   - `markEstimateSentOutsideCompass` is used for a signature collected outside Compass.

   Either way the estimate becomes `signature_pending`.
6. **Acceptance** happens in one of two ways:
   - The e-sign webhook receives `folder_executed`.
   - A person records it with `recordManualEstimateAcceptance`, which needs an attestation and evidence.

   If the job already has an accepted contract, staff with `change-orders` approve must choose how to treat the new version:
   - `difference_change_order`: a change order of kind `contract_version` is built and executed in the same batch.
   - `replace_contract`: a rebaseline, recorded by a change order of kind `replacement`.
7. **`acceptProjectEstimate`** (`src/lib/domain/estimates/acceptance.ts`) writes one batch:
   - other accepted versions become `superseded`;
   - this estimate becomes `accepted` with `sage_status: ready`;
   - a linked change order is executed (`changeOrderExecutionFromEstimate`);
   - a phase proposal is completed.

   After the batch, `rebuildProjectContractBudget` creates a new current budget revision.
8. **Contract packet** (optional). The packet moves `draft` → `internal_review` → `signature_pending` → `executed`. Executing it manually also accepts the linked estimate, unless that estimate changes an already-accepted contract; in that case acceptance must be recorded on the estimate first.
9. **The job status is changed by a person** (`changeProjectJobStatus`). Accepting a contract does not move the job status. The one automatic status write is `awaiting_funding` on a new family phase created from a phase proposal.

## 6.2 Change order approval

![Change order status machine](diagrams/flow-change-order.png)

The transition table is `TRANSITIONS` in `src/lib/change-orders/status.ts`, checked by `canTransitionChangeOrder`:

| From | Allowed next statuses |
|---|---|
| `draft` | `submitted`, `void` |
| `submitted` | `triage`, `needs_information`, `declined`, `void` |
| `triage` | `needs_information`, `pricing`, `internal_review`, `declined`, `void` |
| `needs_information` | `submitted`, `triage`, `pricing`, `declined`, `void` |
| `pricing` | `needs_information`, `internal_review`, `declined`, `void` |
| `internal_review` | `needs_information`, `pricing`, `approved_for_owner`, `declined`, `void` |
| `approved_for_owner` | `internal_review`, `signature_pending`, `declined`, `void` |
| `signature_pending` | `approved_for_owner`, `executed`, `declined`, `void` |
| `executed` | `sage_pending`, `closed` |
| `sage_pending` | `executed`, `synced` |
| `synced` | `closed` |
| `closed`, `declined`, `void` | none (terminal) |

- **External users.** Owners and vendors can only move `needs_information` → `submitted`, which is how they answer a question. Their requests always start as `submitted`.
- **Approval statuses.** Moving into `approved_for_owner`, `signature_pending`, `executed`, `sage_pending`, `synced` or `closed` needs approve permission. These are also the statuses that the owner audience can see.
- **Guards in `updateProjectChangeOrder`:**
  - A change order cannot be set to `synced` by hand; that waits for a future accounting connector.
  - A `replacement` change order is executed only through `executeProjectChangeOrderRebaseline`.
  - Executing an owner-audience change order needs an executed document.
  - A change order backed by an estimate is executed by accepting the estimate.
  - Every change order except a description-only one needs lines with cost codes and amounts.
- **Effects.** `signature_pending` sets `foxit_status: handoff_ready`. `sage_pending` sets `sage_status: pending_manual_sync`. Each transition writes a `project_change_order_history` row. Execution rebuilds the contract budget.
- **Accounting.** The accounting handoff is manual today; no automated writer exists for change orders.
- **Sending to the owner.** This is not a tracked email. The change order appears in the owner view once its status is published, and the e-sign handoff is flagged.

## 6.3 RFQ → bid → PO

![RFQ to bid to PO](diagrams/flow-rfq-po.png)

1. **Create.** `createRfqRequest` validates the cost codes in scope (at most 50 linked selections) and creates an RFQ in `draft`.
2. **Send.** `sendProjectRfqEmail` checks that:
   - the recipient is valid and there are at most 5 cc's;
   - the RFQ is unchanged since it was loaded (optimistic concurrency);
   - the RFQ is `draft` or `sent`;
   - the template has been reviewed;
   - every linked file is inside the project's drive folder and is not in the trash.

   It then creates a delivery row and a hashed price link, and sends through `sendTrackedEmail`. On success the RFQ becomes `sent`. On failure the price link is revoked.
3. **Responses** arrive in one of three ways:
   - The vendor uses the no-login price link (`submitRfqQuoteByLink`). This is allowed from `sent` or `response_received`.
   - Staff record a response by hand (`saveManualProjectRfqResponse`, with source email, phone or other).
   - The vendor replies by email. The reply threads onto the RFQ (section 6.7) but does not change its status **(inferred from the absence of a status write)**.
4. **Award.** `approveProjectRfqBid` needs `rfqs` approve and status `response_received`. It inserts the approval and moves the RFQ to `awarded`, which locks it. The approved bid can be imported into a draft estimate once.
5. **Purchase order.** `createPurchaseOrderRequest` may reference the awarded RFQ. `sendPurchaseOrderEmail` sends by tracked email and moves a `draft` or `approved` PO to `sent`. Every later status change also marks the paper trail due.
6. **Accounting.** `queueProjectOperationForSageSync` can queue the PO (`sync_status: queued_sage`). The consumer of this queue is not part of the current bridge **(inferred)**.

## 6.4 Pay application → accounting invoice

![Pay application to accounting invoice](diagrams/flow-pay-app.png)

1. **Create.** `createProjectOwnerPayApplicationDraft` (`src/app/actions/project-financial-workflows.ts`) needs a current contract-budget revision with lines. It creates the application as `building`, adds the lines and a mirror operation, then sets it to `draft`.
2. **Edit.** Staff edit the line amounts, percent complete, the deposit applied (`auto` or `manual`) and the owner detail level.
3. **Ready.** `markProjectOwnerPayApplicationReady` needs a payment due or a deposit greater than zero. The application becomes `internal_review`.
4. **Approve for billing.** `approveProjectOwnerPayApplicationForBilling` (`src/app/actions/pay-application-billing.ts`) sets:
   - status `billed`;
   - `owner_visible = true`;
   - `sync_status: awaiting_sage_invoice`;
   - Activity `pay_application_billed`.

   The owner can now see the application.
5. **Accounting invoice.** Accounting creates the invoice in the accounting system. Staff then record its number with `setProjectOwnerPayApplicationSageInvoice`, which sets `sync_status: synced`.
6. **Undo.** `undoProjectOwnerPayApplicationBilling` is blocked once a later application or an invoice number exists, and while payments are applied to the application (`payApplicationHasActivePayments`; void them first). Payments received against a billed application follow section 6.10.
7. **Read-only check.** `queueSagePayApplicationSync` queues a run that the on-premises poller claims. The poller reads the accounting system's latest progress-billing application, and `ingestSagePayApplicationSnapshot` stores and reconciles it against the Compass budget. The poller does not write the invoice number.

## 6.5 Daily log → to-dos

![Daily log to to-dos](diagrams/flow-daily-log-todos.png)

1. **Create.** `createProjectDailyLog` (`src/app/actions/project-field.ts`) calls `createDailyLog` (`src/lib/domain/field/daily-logs.ts`). Native retries are idempotent because the `clientSubmissionId` becomes the log id.
2. **Follow-ups.** `applyDailyLogFollowUps` (`src/lib/daily-logs/log-followups-server.ts`) handles the to-dos the log refers to:
   - **Worked:** records a `worked` event, and moves `open` to `in_progress` when the company rule is on.
   - **Still blocked:** records `still_blocked`.
   - **Cleared:** records `unblocked` and sets `in_progress`.
3. **New to-dos.** An issue or next-step line marked *Make to-do* becomes a new `open` to-do. Its `created` event carries the log id, and the assignee is notified. The company setting `ask`, `auto` or `off` decides whether the button is offered.
4. **Completion.** Nothing in this flow marks a to-do complete. Completion is a manual decision.
5. **Missing-log reminders** run every 10 minutes (`sendMissingDailyLogReminders`). They skip days that are not work days, times before the reminder time, people who have already logged, and people whose calendar shows time off. They claim one `daily_log_reminders` row per person per day, then notify in-app and by push.

## 6.6 Card payment → accounting posting

![Card payment to accounting posting](diagrams/flow-card-payment.png)

1. **Webhook.** `POST /api/integrations/square/webhook` returns 503 unless the feature is enabled and a signature key is configured. It verifies the provider's HMAC signature and deduplicates on the event id (`beginSquareWebhookEvent`, `sage_square_webhook_events`, 10-minute processing lease).
2. **Processing.** `processSquareWebhookEvent` (`src/lib/sage/square-payment.ts`):
   - For `invoice.payment_made` it fetches the payment details from the provider. If the sale date, payment request count, total, location or amount (overpayment) looks wrong, it raises an *attention* error. Otherwise it queues a receipt operation at `manual_action_required` (customer receipts are never posted automatically), upserts the owner receivable, notifies staff, and queues a `post_square_processing_fee` operation for the fee.
   - Refunds and failed scheduled charges are flagged for review.
3. **Outcomes.**
   - Success completes the event.
   - An attention error flags the event, notifies staff ("needs accounting review") and returns 200, so the provider does not retry.
   - Any other error marks the event failed and returns 500, so the provider redelivers.
4. **Fee writer.** The on-premises fee writer claims queued fee operations (`/api/integrations/sage/square-payments/requests`).
   - It first looks for a matching fee already in accounting, from 10 days before to 45 days after. If it finds one, the outcome is `already_in_sage`.
   - Otherwise it posts a general-ledger entry that debits merchant fees and credits the deposit account.
   - It reports `succeeded`, `already_in_sage` or `failed`.
5. **Every minute.** Reconciliation notifies about stuck receipts and reminds the invoice creator, during business hours, to enter receipts in accounting.

## 6.7 Tracked email

![Tracked email](diagrams/flow-tracked-email.png)

- **`sendTrackedEmail`** (`src/lib/email/tracked-send.ts`):
  - picks the sender: the staff member's own mailbox, a department mailbox or the system sender;
  - creates an `email_reply_threads` row with a token;
  - sends with the reply-to address `<mailbox>+<token>@<domain>`, an `X-Compass-Reply-Token` header and a token footer.

  The caller writes its own delivery row, status change and Activity.
- **Inbound sync.** The per-minute job calls `/api/email/gmail-sync` with a bearer secret. `syncGmailInboundReplies` takes a mailbox lease and cooldown and works within a 45-second budget. Each message is deduplicated into `inbound_emails` and gets a `matched_status`:
  - A token match posts the reply onto the record's thread or project channel, updates unread counts, moves a `new` RFI to `in_progress`, and calls `announceTrackedRecordReply` (Activity plus notifications to project staff and the original sender).
  - A token match on Compass's own copy of a sent message is `ignored_outbound`.
  - Mail with no token is either routed by a project match or left as `needs_review` for the inbound-email review queue.
- **The standard and its CI check** are described in section 4.6.

## 6.8 Permission check

![Permission check](diagrams/flow-permission-check.png)

The order is fixed:

1. middleware;
2. the user;
3. the organization;
4. demo read-only;
5. the feature permission;
6. project access;
7. the audience filter on reads.

`canFeature` → `getEffectivePermissionAccessLevel` (`src/lib/permission-enforcement.ts`) computes the access level (`none`, `view`, `edit`, `delete` or `approve`):

1. It starts from the role baseline in the permission matrix.
2. A role override replaces the baseline.
3. Team overrides can only raise it.
4. A user override applies last. It applies only to staff-assignable features, and it can deny.
5. *Individual-only* features (for example private employee details, accounting contact review and the project archive) are granted only by an explicit per-user grant, to active internal staff in a company that is not a demo. They fail closed when storage is unavailable.

All overrides are read once per request. A missing project returns "Project not found" whether or not the project exists, so its existence is never disclosed.

## 6.9 Design job → construction job

![Design job to construction job](diagrams/flow-design-to-construction.png)

- **Linking.** A construction job is linked to its design job in one of two ways:
  - created new: `createLinkedProject` runs intake and then `insertProjectLink`;
  - linked existing: `linkExistingProject` needs `project` update, the same company, and no existing link.

  The design job stays a design job.
- **Workflow carry-over.** `carryOverBetweenLinkedJobs` (`src/lib/job-workflows/carryover.ts`) copies completed workflow checks across the link, in both directions, when the company's carry-over rule covers that pair of departments (the default rule is design to construction). Only checks that also exist in the target are copied, keeping who ticked them and when, and each copy writes a project-audit row. A failure is logged and the link stands. Staff can re-run carry-over (`carryOverLinkedJobWorkflows`).
- **Replacing a contract.** Replacing a contract, or changing it by a new version, is always recorded by a change order: kind `replacement` or `contract_version` (`src/lib/change-orders/contract-version-acceptance.ts`). No code links a change order on the design job to the construction job automatically; the two jobs keep separate contracts. Pre-construction billing on the design job continues alongside **(inferred from the separate `billing_scope` values `construction` and `preconstruction`)**.
- **Phased work.** Phases use project families:
  - an accepted phase proposal creates a family phase in `awaiting_funding`;
  - `activateProjectFamilyPhase` needs a phase number and an authorization (the contract amount or an originating change order) before it creates the project shell and syncs the trackers.

## 6.10 Payment received → pay application or invoice

![Payment received against pay applications and invoices](diagrams/flow-payment-received.png)

The actions are in `src/app/actions/received-payments.ts`; the money rules are in `src/lib/domain/financials/rules.ts`, the reads in `receivables.ts`, and the only writer is `src/lib/domain/financials/store.ts`.

1. **Open.** `getProjectReceivablePayments` (feature `financials`, action `read`) lists the project's billed items and payments. `getRecordPaymentOptions` lists the customer's open items on the project, with the focused item first and prefilled.
2. **Record.** `recordReceivedPayment` (action `create`) takes the amount, date, method (`check`, `cash`, `ach` or `card`), reference, memo and the requested split. The dialog shows an applied and unapplied preview, but the server recomputes everything with `planPaymentAllocations`.
3. **Write.** One D1 batch inserts the `payments` row, one `invoice_payment_allocations` or `pay_application_payment_allocations` row per item, and each invoice's new `amount_paid`, `amount_due` and `status`. Each allocation insert repeats the action's read as a guard; a failed guard writes 0 cents, the positive-amount CHECK rejects it, and the whole batch rolls back with "A balance changed… refresh". Activity `payment_received` is recorded.
4. **Apply later.** `applyReceivedPaymentToItems` (action `create`) applies an unapplied remainder with the same checks and the same guarded batch. Activity `payment_applied`.
5. **Accounting.** Nothing is posted to the accounting system. Staff enter the receipt there by hand, because the accounting system restricts automated payment posting. Card payments follow section 6.6 and are posted only by that bridge.
6. **Void.** `voidReceivedPaymentWithReason` (action `update`) needs a reason. It is refused for a payment that is already void or that came from the card-payment bridge. It stamps `voided_at`, `voided_by` and `void_reason`, releases every active allocation (`released_at`, `released_by`) and lowers each invoice's paid amount by what this payment applied, never below zero. Invoice allocations added after the read abort the void, and a second void writes a blank reason that the CHECK rejects. Activity `payment_voided`. If the receipt was entered in accounting, staff reverse it there.
7. **Owner view.** `getOwnerPayApplicationBalances` (`scope: "member"`) gives the owner's billing page the paid and outstanding amounts of billed applications.
