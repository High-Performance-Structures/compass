"use client"

import type { ProjectContactItem, ProjectContactSageOptions } from "@/lib/domain/contacts/types"
import { SearchableCombobox } from "@/components/searchable-combobox"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { PROJECT_WORKFLOW_ROLE_LENSES } from "@/lib/project-workflow-roles"
import { cn } from "@/lib/utils"

import { CostCodePicker, VisibilityCheckbox } from "./contact-editor-pickers"
import {
  CUSTOM_PROJECT_ROLE_VALUE,
  EXTERNAL_PROJECT_ROLES,
  isPresetProjectRole,
  isVendorContactType,
} from "./contact-editor-rules"
import type { ProjectContactEditorState } from "./use-project-contact-editor"

/** Name, role, contact details, estimating codes, notes and visibility. */
export function ContactDetailsFields({
  editor,
  contact,
  sageOptions,
}: {
  readonly editor: ProjectContactEditorState
  readonly contact: ProjectContactItem | null
  readonly sageOptions: ProjectContactSageOptions
}): React.ReactElement {
  const {
    input,
    updateInput,
    selectedDirectory,
    customRoleSelected,
    setCustomRoleSelected,
    identityReadOnly,
    filteredCostCodes,
    applyDivision,
    applyCostCode,
  } = editor
  return (
    <>
            <div className="grid gap-4 sm:grid-cols-2">
              {!isVendorContactType(input.contactType) && (
                <div
                  className={cn(
                    "grid gap-2",
                    input.contactType === "internal" && "sm:col-span-2"
                  )}
                >
                  <Label htmlFor="project-contact-name">Contact name</Label>
                  <Input
                    id="project-contact-name"
                    required
                    value={input.displayName}
                    onChange={(event) => updateInput("displayName", event.target.value)}
                    readOnly={selectedDirectory !== null}
                  />
                </div>
              )}
              {input.contactType === "owner" && (
                <div className="grid gap-2">
                  <Label htmlFor="project-contact-company">Company</Label>
                  <Input
                    id="project-contact-company"
                    value={input.companyName}
                    onChange={(event) => updateInput("companyName", event.target.value)}
                    readOnly={selectedDirectory !== null}
                  />
                </div>
              )}
              <div className="grid gap-2">
                <Label htmlFor="project-contact-role">Project role</Label>
                <SearchableCombobox
                  id="project-contact-role"
                  value={
                    customRoleSelected
                      ? CUSTOM_PROJECT_ROLE_VALUE
                      : input.role
                  }
                  onValueChange={(value) => {
                    // An empty value is the picker's own reset; keep the current role.
                    if (value === "") return
                    if (value === CUSTOM_PROJECT_ROLE_VALUE) {
                      setCustomRoleSelected(true)
                      if (isPresetProjectRole(input.role)) updateInput("role", "")
                      return
                    }
                    setCustomRoleSelected(false)
                    updateInput("role", value)
                  }}
                  options={[
                    ...PROJECT_WORKFLOW_ROLE_LENSES.map((role) => ({
                      value: role.label,
                      label: role.label,
                      description: "Project team",
                    })),
                    ...EXTERNAL_PROJECT_ROLES.map((role) => ({
                      value: role,
                      label: role,
                      description: "External",
                    })),
                    { value: CUSTOM_PROJECT_ROLE_VALUE, label: "Other / custom role...", keywords: "custom other new" },
                  ]}
                  ariaLabel="Project role"
                  placeholder="Choose a project role..."
                  searchPlaceholder="Search roles..."
                  emptyMessage="No matching roles."
                />
                {customRoleSelected && (
                  <Input
                    id="project-contact-custom-role"
                    value={input.role}
                    onChange={(event) => updateInput("role", event.target.value)}
                    placeholder="Enter the project role..."
                    aria-label="Custom project role"
                  />
                )}
              </div>
              <div className="grid gap-2">
                <Label htmlFor="project-contact-trade">Trade / scope</Label>
                <Input
                  id="project-contact-trade"
                  value={input.trade}
                  onChange={(event) => updateInput("trade", event.target.value)}
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="project-contact-email">Email</Label>
                <Input
                  id="project-contact-email"
                  type="email"
                  value={input.email}
                  onChange={(event) => updateInput("email", event.target.value)}
                  disabled={identityReadOnly}
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="project-contact-phone">Phone</Label>
                <Input
                  id="project-contact-phone"
                  type="tel"
                  value={input.phone}
                  onChange={(event) => updateInput("phone", event.target.value)}
                  disabled={identityReadOnly}
                />
              </div>
              {input.contactType !== "internal" && (
                <div className="grid gap-2 sm:col-span-2">
                  <Label htmlFor="project-contact-address">Address</Label>
                  <Input
                    id="project-contact-address"
                    value={input.address}
                    onChange={(event) => updateInput("address", event.target.value)}
                    disabled={identityReadOnly}
                  />
                </div>
              )}
              <div className="grid gap-2">
                <Label htmlFor="project-contact-csi">Estimating division</Label>
                <SearchableCombobox
                  id="project-contact-csi"
                  value={input.csiDivision || "unassigned"}
                  onValueChange={(value) => {
                    if (value !== "") applyDivision(value)
                  }}
                  options={[
                    { value: "unassigned", label: "No division" },
                    ...sageOptions.divisions.map((option) => ({
                      value: option.value,
                      label: option.label,
                      keywords: option.value,
                    })),
                  ]}
                  ariaLabel="Estimating division"
                  placeholder="Choose a division..."
                  searchPlaceholder="Search divisions, e.g. 03 or Concrete..."
                  emptyMessage="No matching divisions."
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="project-contact-cost-code">Cost code</Label>
                <CostCodePicker
                  options={filteredCostCodes}
                  value={input.primaryCostCode}
                  onSelect={applyCostCode}
                />
              </div>
              <p className="text-xs text-muted-foreground sm:col-span-2">
                Choosing a cost code automatically sets its division. Choose a
                division first to narrow the cost-code list.
              </p>
            </div>

            <div className="grid gap-2">
              <Label htmlFor="project-contact-notes">Notes</Label>
              <Textarea
                id="project-contact-notes"
                value={input.notes}
                onChange={(event) => updateInput("notes", event.target.value)}
                rows={4}
              />
            </div>

            <div className="grid gap-3">
              <Label>Visibility and responsibility</Label>
              <div className="grid gap-3 sm:grid-cols-2">
                <VisibilityCheckbox
                  id={`project-contact-internal-${contact?.id ?? "new"}`}
                  checked={input.internalVisible}
                  label="Internal visibility"
                  description="Show this contact to authorized staff."
                  onCheckedChange={(checked) => updateInput("internalVisible", checked)}
                />
                <VisibilityCheckbox
                  id={`project-contact-owner-${contact?.id ?? "new"}`}
                  checked={input.ownerPortalVisible}
                  label="Owner workspace"
                  description="Allow owners to see this contact."
                  onCheckedChange={(checked) => updateInput("ownerPortalVisible", checked)}
                />
                <VisibilityCheckbox
                  id={`project-contact-sub-${contact?.id ?? "new"}`}
                  checked={input.subVendorPortalVisible}
                  label="Sub/vendor workspace"
                  description="Allow approved subs and vendors to see this contact."
                  onCheckedChange={(checked) => updateInput("subVendorPortalVisible", checked)}
                />
                <VisibilityCheckbox
                  id={`project-contact-primary-${contact?.id ?? "new"}`}
                  checked={input.primaryContact}
                  label="Primary contact"
                  description="Make this the primary contact for its type."
                  onCheckedChange={(checked) => updateInput("primaryContact", checked)}
                />
              </div>
            </div>
    </>
  )
}
