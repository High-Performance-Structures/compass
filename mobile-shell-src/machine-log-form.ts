/**
 * Field Mode's machine log: hours on a job, a fill-up, a service, a repair
 * or another cost. Like the daily log, what is typed lives in a draft saved
 * on the phone, so redrawing the screen never clears it; saving checks the
 * same rules as the office page and keeps everything when something is
 * missing.
 */
import { z } from "zod/v4"

import {
  emptyMachineLogDraft,
  formatCents,
  formatNumber,
  isMachineLogKind,
  machineTimeChargeCents,
  MACHINE_LOG_KIND_LABELS,
  MACHINE_LOG_KINDS,
  PAID_WITH_OPTIONS,
  type MachineLogDraft,
  type MachineLogKind,
} from "../src/lib/equipment/model"
import { fieldMachineLogDraftSchema, type FieldMachine } from "../src/lib/field/types"

export const MACHINE_DRAFT_KEY = "compass_field_machine_draft_v1"

export const machineDraftSchema = fieldMachineLogDraftSchema
export type MachineDraft = z.infer<typeof machineDraftSchema>

export type MachineSaveState = "idle" | "saved" | "synced"

type Escape = (value: string) => string
type Option = { readonly value: string; readonly label: string }

/** A new entry of a kind, keeping the machine and job just used. */
export function nextMachineDraft(kind: MachineLogKind, today: string, previous: MachineDraft | null, projectId: string): MachineDraft {
  return {
    ...emptyMachineLogDraft(kind, today),
    machineId: previous?.machineId ?? "",
    projectId: kind === "hours" ? (previous?.projectId || projectId) : "",
  }
}

/** Sets one field from a control's name; changing the kind clears the other kinds' fields. */
export function updateMachineDraft(draft: MachineDraft, name: string, value: string): MachineDraft {
  if (name === "kind") {
    if (!isMachineLogKind(value)) return draft
    return { ...emptyMachineLogDraft(value, draft.entryDate), machineId: draft.machineId, projectId: value === "hours" ? draft.projectId : "", hourMeter: draft.hourMeter }
  }
  return isDraftKey(name) ? { ...draft, [name]: value } : draft
}

const DRAFT_KEYS: ReadonlySet<string> = new Set(Object.keys(emptyMachineLogDraft("hours", "")))

function isDraftKey(name: string): name is Exclude<keyof MachineLogDraft, "kind"> {
  return name !== "kind" && DRAFT_KEYS.has(name)
}

/** What the hours charge the job at the machine's rates, e.g. "$860.00", or "". */
export function hoursChargeLabel(draft: MachineDraft, machine: FieldMachine | undefined): string {
  if (draft.kind !== "hours" || !machine) return ""
  const hours = (value: string): number | null => {
    const parsed = Number(value)
    return value.trim() && Number.isFinite(parsed) && parsed > 0 ? parsed : null
  }
  const cents = machineTimeChargeCents(
    { runningHours: hours(draft.runningHours), standbyHours: hours(draft.standbyHours), idleHours: hours(draft.idleHours) },
    machine,
  )
  return cents === null ? "" : formatCents(cents)
}

export function machineSaveLabel(state: MachineSaveState, online: boolean): string {
  if (state === "synced") return "✓ Saved and synced"
  if (state === "saved") return online ? "✓ Saved, syncing" : "✓ Saved on this phone"
  return online ? "Save and sync" : "Save for sync"
}

export function machineErrorControlId(key: string): string {
  return `machine-${key === "hours" ? "runningHours" : key}`
}

function requiredTag(): string {
  return `<span class="required-tag">Required</span>`
}

function errorText(errors: ReadonlyMap<string, string>, key: string, escape: Escape): string {
  const message = errors.get(key)
  return message ? `<span class="field-error" id="machine-${escape(key)}-error">${escape(message)}</span>` : ""
}

function invalid(errors: ReadonlyMap<string, string>, key: string, escape: Escape): string {
  return errors.has(key) ? ` aria-invalid="true" aria-describedby="machine-${escape(key)}-error"` : ""
}

function options(items: readonly Option[], selected: string, escape: Escape, placeholder: string): string {
  return `<option value="">${escape(placeholder)}</option>${items
    .map((item) => `<option value="${escape(item.value)}" ${item.value === selected ? "selected" : ""}>${escape(item.label)}</option>`)
    .join("")}`
}

function input(name: keyof MachineDraft, label: string, draft: MachineDraft, errors: ReadonlyMap<string, string>, escape: Escape, extra = ""): string {
  return `<label class="field"><span>${escape(label)}</span><input id="machine-${name}" name="${name}" value="${escape(draft[name])}"${extra}${invalid(errors, name, escape)} />${errorText(errors, name, escape)}</label>`
}

/** The machine log form's fields; the save button is added by the caller. */
export function machineFieldsHtml(input_: {
  readonly draft: MachineDraft
  readonly machines: readonly FieldMachine[]
  readonly jobs: readonly Option[]
  readonly costCodes: readonly Option[]
  readonly errors: ReadonlyMap<string, string>
  readonly escape: Escape
}): string {
  const { draft, machines, jobs, costCodes, errors, escape } = input_
  const machine = machines.find((item) => item.id === draft.machineId)
  const isHours = draft.kind === "hours"
  const isService = draft.kind === "maintenance" || draft.kind === "repair"
  const decimal = ` inputmode="decimal"`
  const summary = errors.size > 0
    ? `<p class="form-alert" role="alert">${escape(errors.size === 1 ? "1 item needs attention. Everything you entered is still here." : `${errors.size} items need attention. Everything you entered is still here.`)}</p>`
    : ""
  const kinds = MACHINE_LOG_KINDS.map(
    (kind) => `<button type="button" class="kind-chip${kind === draft.kind ? " selected" : ""}" data-machine-kind="${kind}" aria-pressed="${kind === draft.kind}">${escape(MACHINE_LOG_KIND_LABELS[kind])}</button>`,
  ).join("")
  const machineHint = machine
    ? `<span class="field-hint">${escape([machine.rateLabel ? `Rate book: ${machine.rateLabel}` : "No rate book rate", machine.hourMeter !== null ? `Hour meter ${formatNumber(machine.hourMeter)}` : ""].filter(Boolean).join(" · "))}</span>${machine.services
        .filter((item) => item.state !== "ok")
        .map((item) => `<span class="field-hint service-${item.state}">${escape(item.dueLabel)}</span>`)
        .join("")}`
    : ""

  const hoursFields = isHours
    ? `<label class="field"><span>Operator</span><input id="machine-operatorName" name="operatorName" placeholder="You, if left blank" value="${escape(draft.operatorName)}" /></label>
      ${costCodes.length > 0 ? `<label class="field"><span>Cost code</span><select id="machine-costCode" name="costCode">${options(costCodes, draft.costCode, escape, "None")}</select></label>` : ""}
      <fieldset class="work-lines"${errors.has("hours") ? ` aria-describedby="machine-hours-error"` : ""}>
        <legend class="field-label">Hours${requiredTag()}</legend>
        <div class="hours-row">
          ${input("runningHours", "Running", draft, errors, escape, decimal)}
          ${input("standbyHours", "Standby", draft, errors, escape, decimal)}
          ${input("idleHours", "Idle", draft, errors, escape, decimal)}
        </div>
        ${errorText(errors, "hours", escape)}
        <span class="field-hint" data-machine-charge>${escape(hoursChargeLabel(draft, machine) ? `Charges the job ${hoursChargeLabel(draft, machine)} at the machine's rates.` : "")}</span>
      </fieldset>`
    : ""

  const serviceSelect = draft.kind === "maintenance" && machine && machine.services.length > 0
    ? `<label class="field"><span>Service done</span><select id="machine-serviceItemId" name="serviceItemId">${options(
        machine.services.map((item) => ({ value: item.id, label: item.name })),
        draft.serviceItemId,
        escape,
        "Something else (describe below)",
      )}</select></label>`
    : ""

  const costFields = !isHours
    ? `${serviceSelect}
      <div class="hours-row two">
        ${draft.kind === "fuel" ? input("gallons", "Gallons", draft, errors, escape, decimal) : ""}
        <label class="field"><span>${isService ? "Parts / outside cost" : "Total cost"}${isService ? "" : requiredTag()}</span><input id="machine-amount" name="amount" inputmode="decimal" placeholder="$" value="${escape(draft.amount)}"${invalid(errors, "amount", escape)} />${errorText(errors, "amount", escape)}</label>
        ${isService ? input("shopHours", "Our shop hours", draft, errors, escape, decimal) : ""}
      </div>
      <label class="field"><span>Paid with</span><select id="machine-paidWith" name="paidWith">${options(PAID_WITH_OPTIONS.map((option) => ({ value: option, label: option })), draft.paidWith, escape, "Not set")}</select></label>
      ${input("vendor", "Vendor", draft, errors, escape)}`
    : ""

  return `${summary}
    <fieldset class="kind-chips"><legend class="field-label">What are you logging?</legend><div>${kinds}</div></fieldset>
    <label class="field"><span>Machine${requiredTag()}</span><select id="machine-machineId" name="machineId"${invalid(errors, "machineId", escape)}>${options(
      machines.map((item) => ({ value: item.id, label: item.name })),
      draft.machineId,
      escape,
      "Choose a machine",
    )}</select>${errorText(errors, "machineId", escape)}${machineHint}</label>
    <label class="field"><span>Date${requiredTag()}</span><input id="machine-entryDate" name="entryDate" type="date" value="${escape(draft.entryDate)}"${invalid(errors, "entryDate", escape)} />${errorText(errors, "entryDate", escape)}</label>
    <label class="field"><span>${isHours ? "Job" : "Charge to a job"}${isHours ? requiredTag() : ""}</span><select id="machine-projectId" name="projectId"${invalid(errors, "projectId", escape)}>${options(
      jobs,
      draft.projectId,
      escape,
      isHours ? "Choose the job" : "No job (machine overhead)",
    )}</select>${errorText(errors, "projectId", escape)}</label>
    ${hoursFields}
    ${costFields}
    ${input("hourMeter", "Hour meter", draft, errors, escape, decimal)}
    <label class="field"><span>Notes${draft.kind === "other" || draft.kind === "repair" ? requiredTag() : ""}</span><textarea id="machine-notes" name="notes" placeholder="${escape(draft.kind === "repair" ? "What broke and what was fixed" : "Anything the office should know")}"${invalid(errors, "notes", escape)}>${escape(draft.notes)}</textarea>${errorText(errors, "notes", escape)}</label>`
}
