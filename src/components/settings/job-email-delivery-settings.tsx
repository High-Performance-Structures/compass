"use client"

import * as React from "react"
import { toast } from "sonner"
import {
  getJobEmailDeliverySettings,
  removeJobEmailW9,
  saveJobEmailDeliverySettings,
} from "@/app/actions/job-email-delivery-settings"
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from "@/components/ui/alert-dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import type { JobEmailDeliveryView } from "@/lib/job-workflows/email-delivery-server"

export function JobEmailDeliverySettings({ canEdit }: { readonly canEdit: boolean }): React.ReactElement {
  const [settings, setSettings] = React.useState<JobEmailDeliveryView | null>(null)
  const [agentEmail, setAgentEmail] = React.useState("")
  const [error, setError] = React.useState<string | null>(null)
  const [pending, startTransition] = React.useTransition()
  const fileInput = React.useRef<HTMLInputElement>(null)

  React.useEffect(() => {
    void getJobEmailDeliverySettings().then((result) => {
      if (!result.success) {
        setError(result.error)
        return
      }
      setSettings(result.data)
      setAgentEmail(result.data.insuranceAgentEmail ?? "")
    })
  }, [])

  function save(event: React.FormEvent<HTMLFormElement>): void {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    startTransition(async () => {
      setError(null)
      const result = await saveJobEmailDeliverySettings(form)
      if (!result.success) {
        setError(result.error)
        return
      }
      setSettings(result.data)
      setAgentEmail(result.data.insuranceAgentEmail ?? "")
      if (fileInput.current) fileInput.current.value = ""
      toast.success("Job email delivery settings saved.")
    })
  }

  function remove(version: string): void {
    startTransition(async () => {
      setError(null)
      const result = await removeJobEmailW9(version)
      if (!result.success) {
        setError(result.error)
        return
      }
      setSettings(result.data)
      toast.success("Company W-9 removed.")
    })
  }

  return (
    <div className="space-y-3 border-b pb-4">
      <div>
        <h3 className="text-sm font-semibold">Certificate requests and W-9 delivery</h3>
        <p className="text-sm text-muted-foreground">Used by the Agreement &amp; deposit checklist on scope-of-work jobs.</p>
      </div>
      {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
      {!settings && !error ? <p className="text-sm text-muted-foreground">Loading delivery settings…</p> : null}
      {settings ? (
        <form onSubmit={save} className="space-y-3">
          <div className="max-w-sm space-y-1.5">
            <Label htmlFor="job-email-insurance-agent">Insurance agent email</Label>
            <Input
              id="job-email-insurance-agent"
              name="insuranceAgentEmail"
              type="email"
              value={agentEmail}
              onChange={(event) => setAgentEmail(event.target.value)}
              disabled={pending || !canEdit}
            />
          </div>
          <div className="max-w-sm space-y-1.5">
            {canEdit ? <Label htmlFor="job-email-w9">Company W-9 PDF</Label> : <p className="text-sm font-medium">Company W-9 PDF</p>}
            <p id="job-email-w9-status" className="break-words text-sm text-muted-foreground">
              {settings.w9Filename ? `${settings.w9Filename} is the current attachment.` : "No W-9 uploaded."}
            </p>
            {canEdit ? (
              <Input id="job-email-w9" name="w9" type="file" accept=".pdf,application/pdf" aria-describedby="job-email-w9-status job-email-w9-limit" ref={fileInput} disabled={pending} />
            ) : null}
            {canEdit ? <p id="job-email-w9-limit" className="text-xs text-muted-foreground">Upload or replace the PDF. Maximum 1 MB.</p> : null}
          </div>
          {canEdit ? (
            <div className="flex flex-wrap items-center gap-2">
              <Button type="submit" size="sm" disabled={pending}>Save delivery settings</Button>
              {settings.w9Version ? (
                <AlertDialog>
                  <AlertDialogTrigger asChild>
                    <Button type="button" variant="outline" size="sm" disabled={pending}>Remove W-9</Button>
                  </AlertDialogTrigger>
                  <AlertDialogContent>
                    <AlertDialogHeader>
                      <AlertDialogTitle>Remove the company W-9?</AlertDialogTitle>
                      <AlertDialogDescription>Staff will need a new upload before they can email the W-9 from a job.</AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel>Cancel</AlertDialogCancel>
                      <AlertDialogAction onClick={() => { if (settings.w9Version) remove(settings.w9Version) }}>Remove W-9</AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
              ) : null}
            </div>
          ) : null}
        </form>
      ) : null}
    </div>
  )
}
