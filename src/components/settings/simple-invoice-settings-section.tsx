"use client"

import * as React from "react"
import { toast } from "sonner"

import { useFeatureSettingsEditor } from "@/hooks/use-feature-settings-editor"
import { checkInvoiceSenderMailbox } from "@/app/actions/project-invoice-email"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import { PROJECT_DEPARTMENTS, type ProjectDepartmentCode } from "@/lib/domain/project/statuses"
import { FEATURE_SETTINGS } from "@/lib/feature-settings/registry"
import { simpleInvoiceSettingsSchema } from "@/lib/feature-settings/simple-invoice-settings"

const KEY = "simple-invoices"
const GROUP = FEATURE_SETTINGS[KEY]

type DepartmentListKey = "estimateInvoiceDepartments" | "materialSaleDepartments" | "squareBlockedDepositDepartments"

const DEPARTMENT_LISTS: readonly { readonly key: DepartmentListKey; readonly label: string; readonly help: string }[] = [
  { key: "estimateInvoiceDepartments", label: "Invoice from the job's estimate", help: "Departments without a contract budget: staff bill an estimate in part or in full." },
  { key: "materialSaleDepartments", label: "Material sale numbering", help: "Their invoices use the material sale format (Sage export settings); others use the other billing format." },
  { key: "squareBlockedDepositDepartments", label: "No Square on deposits", help: "Deposit invoices for these departments are paid by check or wire only (card fees are too high)." },
]

/** Settings → Workflows → Simple invoices. */
export function SimpleInvoiceSettingsSection(): React.ReactElement {
  const { loaded, canEdit, customized, error, pending, settings: value, setSettings: setValue, save: saveSettings, reset } = useFeatureSettingsEditor(KEY, {
    savedMessage: "Simple invoice settings saved.",
    resetMessage: "Simple invoice settings reset to defaults."
  })
  const [checkingMailbox, startMailboxCheck] = React.useTransition()

  function toggle(key: DepartmentListKey, department: ProjectDepartmentCode, on: boolean): void {
    const current = value[key]
    setValue({ ...value, [key]: on ? [...new Set([...current, department])] : current.filter((item) => item !== department) })
  }

  function save(event: React.FormEvent<HTMLFormElement>): void {
    event.preventDefault()
    const parsed = simpleInvoiceSettingsSchema.safeParse(value)
    if (!parsed.success) {
      toast.error(parsed.error.issues[0]?.message ?? "Check the simple invoice settings.")
      return
    }
    saveSettings(parsed.data)
  }

  function checkMailbox(): void {
    startMailboxCheck(async () => {
      const result = await checkInvoiceSenderMailbox()
      if (!result.success) toast.error(result.error)
      else toast.success(`Compass can send invoices as ${result.data.address}.`)
    })
  }

  const busy = pending || checkingMailbox
  const disabled = busy || !canEdit
  return (
    <section aria-labelledby="simple-invoice-settings" className="space-y-4 border-b pb-6">
      <div>
        <h2 id="simple-invoice-settings" className="text-base font-semibold">{GROUP.label}</h2>
        <p className="text-sm text-muted-foreground">{GROUP.description}</p>
      </div>
      {error ? <p className="text-sm text-destructive">{error}</p> : null}
      {!loaded && !error ? <p className="text-sm text-muted-foreground">Loading…</p> : null}
      {loaded ? (
        <form onSubmit={save} className="space-y-5">
          <div className="grid max-w-3xl gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="simple-invoice-sender">Invoices are sent from</Label>
              <Input id="simple-invoice-sender" type="email" value={value.senderAddress} disabled={disabled} placeholder="billing@example.com" onChange={(event) => setValue({ ...value, senderAddress: event.target.value.trim() })} />
              <p className="text-xs text-muted-foreground">A Google Workspace mailbox Compass may send as. Blank: each person&apos;s own mailbox.</p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="simple-invoice-sender-name">Sender name</Label>
              <Input id="simple-invoice-sender-name" value={value.senderName} maxLength={80} disabled={disabled} placeholder="Accounting" onChange={(event) => setValue({ ...value, senderName: event.target.value })} />
            </div>
          </div>
          <Button type="button" size="sm" variant="outline" disabled={busy || !value.senderAddress} onClick={checkMailbox}>
            Check mailbox
          </Button>
          {DEPARTMENT_LISTS.map((list) => (
            <fieldset key={list.key} className="max-w-3xl space-y-2">
              <legend className="text-sm font-medium">{list.label}</legend>
              <p className="text-xs text-muted-foreground">{list.help}</p>
              <div className="flex flex-wrap gap-4">
                {PROJECT_DEPARTMENTS.map((department) => (
                  <Label key={department} className="flex items-center gap-2 font-normal">
                    <Checkbox checked={value[list.key].includes(department)} disabled={disabled} onCheckedChange={(checked) => toggle(list.key, department, checked === true)} />
                    {department} jobs
                  </Label>
                ))}
              </div>
            </fieldset>
          ))}
          <div className="flex max-w-3xl items-start justify-between gap-4">
            <div>
              <Label htmlFor="simple-invoice-square-ach">Square invoices accept bank transfer (ACH)</Label>
              <p className="text-xs text-muted-foreground">Card is always accepted on a Square invoice.</p>
            </div>
            <Switch id="simple-invoice-square-ach" checked={value.squareAcceptBankTransfer} disabled={disabled} onCheckedChange={(checked) => setValue({ ...value, squareAcceptBankTransfer: checked })} />
          </div>
          <div className="max-w-xs space-y-2">
            <Label htmlFor="simple-invoice-resend-window">Wait before emailing the same invoice again (minutes)</Label>
            <Input id="simple-invoice-resend-window" type="number" min={1} max={60} step={1} value={value.emailResendWindowMinutes} disabled={disabled} onChange={(event) => setValue({ ...value, emailResendWindowMinutes: Number(event.target.value) })} />
            <p className="text-xs text-muted-foreground">Stops a double click or two people from sending one invoice twice. A failed send can be retried right away.</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {canEdit ? (
              <>
                <Button type="submit" size="sm" disabled={busy}>Save</Button>
                {customized ? <Button type="button" size="sm" variant="ghost" disabled={busy} onClick={reset}>Reset to defaults</Button> : null}
              </>
            ) : (
              <p className="text-xs text-muted-foreground">Only admins can change these settings.</p>
            )}
          </div>
        </form>
      ) : null}
    </section>
  )
}
