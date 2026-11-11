"use client"

import * as React from "react"
import { toast } from "sonner"

import {
  getStaffSageLinkStatus,
  linkStaffMemberToSageEmployee,
  refreshSageEmployees,
  type StaffSageLinkStatus,
} from "@/app/actions/sage-employee-links"
import { Button } from "@/components/ui/button"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"

/**
 * Sage contact review › Staff to link to Sage: active staff that the Sage
 * employee list could not link by email, why, and a "Link to Sage employee"
 * choice from the current Sage employees nobody is linked to yet.
 */
export function StaffSageLinksSection({ open }: { readonly open: boolean }): React.ReactElement | null {
  const [status, setStatus] = React.useState<StaffSageLinkStatus | null>(null)
  const [choices, setChoices] = React.useState<Readonly<Record<string, string>>>({})
  const [busyKey, setBusyKey] = React.useState<string | null>(null)

  const reload = React.useCallback(async () => {
    const result = await getStaffSageLinkStatus()
    setStatus(result.success ? result.data : null)
  }, [])
  React.useEffect(() => { if (open) void reload() }, [open, reload])

  if (!status) return null

  const link = async (key: string, suggested: string | null): Promise<void> => {
    const sageRecordId = choices[key] ?? suggested
    if (!sageRecordId) { toast.error("Choose the Sage employee first."); return }
    setBusyKey(key)
    try {
      const result = await linkStaffMemberToSageEmployee({ key, sageRecordId })
      if (!result.success) { toast.error(result.error); return }
      toast.success("Linked to the Sage employee")
      await reload()
    } finally { setBusyKey(null) }
  }

  const refresh = async (): Promise<void> => {
    setBusyKey("refresh")
    try {
      const result = await refreshSageEmployees()
      if (!result.success) toast.error(result.error)
      else toast.success("Sage employees will be read within a few minutes")
    } finally { setBusyKey(null) }
  }

  return (
    <section aria-labelledby="staff-sage-links" className="space-y-3 border-b pb-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h3 id="staff-sage-links" className="text-sm font-semibold">Staff to link to Sage</h3>
          <p className="text-xs text-muted-foreground">
            {status.lastSyncedAt
              ? `Sage employees last read ${new Date(status.lastSyncedAt).toLocaleString()}.`
              : "Sage's employee list has not been read yet."}
            {status.available && !status.readerRunning ? " The Sage employee reader has not checked in recently." : ""}
            {" "}Staff link automatically when exactly one current Sage employee has their email; names never link anyone.
          </p>
        </div>
        {status.available ? (
          <Button type="button" size="sm" variant="outline" onClick={() => void refresh()} disabled={busyKey !== null}>
            Read Sage employees now
          </Button>
        ) : null}
      </div>
      {status.staff.length === 0 ? (
        <p className="text-sm text-muted-foreground">Every active staff member is linked to a Sage employee.</p>
      ) : (
        <ul className="divide-y">
          {status.staff.map((row) => (
            <li key={row.key} className="flex flex-wrap items-center justify-between gap-2 py-2">
              <div className="min-w-0">
                <p className="text-sm font-medium">{row.name}</p>
                <p className="text-xs text-muted-foreground">{row.email ?? "No email"} · {row.reason}</p>
              </div>
              {status.canLink && status.employees.length > 0 ? (
                <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto">
                  <Select
                    value={choices[row.key] ?? row.suggestedSageRecordId ?? ""}
                    onValueChange={(value) => setChoices((current) => ({ ...current, [row.key]: value }))}
                  >
                    <SelectTrigger className="w-full sm:w-72" aria-label={`Sage employee for ${row.name}`}>
                      <SelectValue placeholder="Choose Sage employee" />
                    </SelectTrigger>
                    <SelectContent>
                      {status.employees.map((employee) => (
                        <SelectItem key={employee.sageRecordId} value={employee.sageRecordId}>{employee.label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Button
                    type="button"
                    size="sm"
                    onClick={() => void link(row.key, row.suggestedSageRecordId)}
                    disabled={busyKey !== null || !(choices[row.key] ?? row.suggestedSageRecordId)}
                  >
                    Link to Sage employee
                  </Button>
                </div>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
