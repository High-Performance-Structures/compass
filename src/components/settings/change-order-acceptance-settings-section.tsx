"use client"

import * as React from "react"
import { toast } from "sonner"
import {
  getFeatureSettingsForEditor,
  resetFeatureSettings,
  saveFeatureSettings,
} from "@/app/actions/feature-settings"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Switch } from "@/components/ui/switch"
import { FEATURE_SETTINGS } from "@/lib/feature-settings/registry"
import {
  CHANGE_ORDER_STAFF_SIGNOFF_ROLES,
  changeOrderAcceptanceSettingsSchema,
  type ChangeOrderAcceptanceSettings,
} from "@/lib/feature-settings/contract-settings"

const KEY = "change-order-acceptance"
const GROUP = FEATURE_SETTINGS[KEY]

const SIGNOFF_LABELS: Readonly<Record<ChangeOrderAcceptanceSettings["staffSignOff"], string>> = {
  approvers: "Staff who can approve change orders",
  admins: "Admins only",
  nobody: "Nobody (always require written approval)",
}

function isSignOffRole(value: string): value is ChangeOrderAcceptanceSettings["staffSignOff"] {
  return CHANGE_ORDER_STAFF_SIGNOFF_ROLES.some((role) => role === value)
}

/** Settings → Workflows: how staff record an owner's change-order approval without a signed document. */
export function ChangeOrderAcceptanceSettingsSection(): React.ReactElement {
  const [loaded, setLoaded] = React.useState(false)
  const [canEdit, setCanEdit] = React.useState(false)
  const [customized, setCustomized] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const [value, setValue] = React.useState<ChangeOrderAcceptanceSettings>(GROUP.defaults)
  const [pending, startTransition] = React.useTransition()

  const load = React.useCallback(async () => {
    const result = await getFeatureSettingsForEditor(KEY)
    if (!result.success) {
      setError(result.error)
      return
    }
    const parsed = changeOrderAcceptanceSettingsSchema.safeParse(result.data.settings)
    setValue(parsed.success ? parsed.data : GROUP.defaults)
    setCanEdit(result.data.canEdit)
    setCustomized(result.data.customized)
    setLoaded(true)
  }, [])

  React.useEffect(() => {
    void load()
  }, [load])

  function save(event: React.FormEvent<HTMLFormElement>): void {
    event.preventDefault()
    startTransition(async () => {
      const result = await saveFeatureSettings(KEY, value)
      if (!result.success) {
        toast.error(result.error)
        return
      }
      toast.success("Change-order acceptance settings saved.")
      await load()
    })
  }

  function reset(): void {
    startTransition(async () => {
      const result = await resetFeatureSettings(KEY)
      if (!result.success) {
        toast.error(result.error)
        return
      }
      toast.success("Change-order acceptance settings reset to defaults.")
      await load()
    })
  }

  return (
    <section aria-labelledby="change-order-acceptance-settings" className="space-y-4 border-b pb-6">
      <div>
        <h2 id="change-order-acceptance-settings" className="text-base font-semibold">{GROUP.label}</h2>
        <p className="text-sm text-muted-foreground">{GROUP.description}</p>
      </div>
      {error ? <p className="text-sm text-destructive">{error}</p> : null}
      {!loaded && !error ? <p className="text-sm text-muted-foreground">Loading…</p> : null}
      {loaded ? (
        <form onSubmit={save} className="space-y-4">
          <div className="max-w-sm space-y-2">
            <Label htmlFor="co-acceptance-signoff-role">Who may record a staff sign-off</Label>
            <Select
              value={value.staffSignOff}
              onValueChange={(next) => {
                if (isSignOffRole(next)) setValue({ ...value, staffSignOff: next })
              }}
              disabled={pending || !canEdit}
            >
              <SelectTrigger id="co-acceptance-signoff-role">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {CHANGE_ORDER_STAFF_SIGNOFF_ROLES.map((role) => (
                  <SelectItem key={role} value={role}>{SIGNOFF_LABELS[role]}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">
              A staff sign-off records a verbal or in-person approval with no document and a required note.
            </p>
          </div>
          <div className="flex items-start justify-between gap-4">
            <div>
              <Label htmlFor="co-acceptance-priced-evidence">Priced change orders need written approval</Label>
              <p className="text-xs text-muted-foreground">
                On: a staff sign-off is only for change orders that don&apos;t change the price. Off: any change order can be signed off.
              </p>
            </div>
            <Switch
              id="co-acceptance-priced-evidence"
              checked={value.pricedRequiresEvidence}
              disabled={pending || !canEdit}
              onCheckedChange={(checked) => setValue({ ...value, pricedRequiresEvidence: checked })}
            />
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {canEdit ? (
              <>
                <Button type="submit" size="sm" disabled={pending}>Save</Button>
                {customized ? <Button type="button" size="sm" variant="ghost" disabled={pending} onClick={reset}>Reset to defaults</Button> : null}
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
