"use client"

import * as React from "react"
import { IconCircleCheck, IconLoader2 } from "@tabler/icons-react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"

import { setProjectRfiVendorAssignment } from "@/app/actions/project-rfis"
import { SearchableCombobox } from "@/components/searchable-combobox"
import { Button } from "@/components/ui/button"
import type { RfiVendorAssignment, RfiVendorOption } from "@/lib/rfis/vendor-assignment"

const NO_VENDOR = ""

/** Staff control for the vendor company that can see one RFI. */
export function ProjectRfiVendorAssignment({
  projectId,
  rfiId,
  audience,
  assignment,
  options,
}: {
  readonly projectId: string
  readonly rfiId: string
  readonly audience: string
  readonly assignment: RfiVendorAssignment | null
  readonly options: readonly RfiVendorOption[]
}): React.ReactElement {
  const router = useRouter()
  const current = assignment?.contactId ?? NO_VENDOR
  const [selected, setSelected] = React.useState(current)
  const [saving, setSaving] = React.useState(false)
  const vendorVisible = audience === "sub_vendor" || audience === "public"
  // A deactivated contact stays selectable so staff can see what to replace.
  const choices = assignment && !options.some((option) => option.contactId === assignment.contactId)
    ? [...options, { contactId: assignment.contactId, label: `${assignment.label} (inactive)` }]
    : options

  async function save(): Promise<void> {
    if (saving) return
    setSaving(true)
    try {
      const result = await setProjectRfiVendorAssignment(projectId, rfiId, selected === NO_VENDOR ? null : selected)
      if (!result.success) {
        toast.error(result.error)
        return
      }
      toast.success(selected === NO_VENDOR ? "Vendor removed from this RFI." : "Vendor assigned to this RFI.")
      router.refresh()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Unable to update the RFI vendor.")
    } finally {
      setSaving(false)
    }
  }

  const warning = !vendorVisible
    ? null
    : assignment === null
      ? "Assign a vendor company to share this RFI with that company’s team."
      : !assignment.contactActive
        ? "This vendor assignment is inactive. Choose an active company contact."
        : null

  return (
    <div className="mt-3 space-y-1">
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-[1fr_auto]">
        <SearchableCombobox
          ariaLabel="Vendor who can see this RFI"
          placeholder="No vendor"
          searchPlaceholder="Search subcontractors and suppliers..."
          className="h-9 w-full"
          value={selected}
          onValueChange={setSelected}
          options={[
            { value: NO_VENDOR, label: "No vendor" },
            ...choices.map((option) => ({ value: option.contactId, label: option.label })),
          ]}
        />
        <Button type="button" variant="outline" disabled={saving || selected === current} onClick={() => void save()}>
          {saving ? <IconLoader2 className="size-4 animate-spin" /> : <IconCircleCheck className="size-4" />}
          Save vendor
        </Button>
      </div>
      {warning ? <p className="text-xs text-destructive">{warning}</p> : null}
    </div>
  )
}
