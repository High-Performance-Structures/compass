"use client"

import { useRef, useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import {
  IconArrowRight,
  IconBuilding,
  IconCheck,
  IconDatabase,
  IconPlus,
} from "@tabler/icons-react"
import { toast } from "sonner"

import {
  createProjectIntake,
  type ProjectIntakeAssignee,
} from "@/app/actions/projects"
import { ProjectSelectionComboboxInput } from "@/components/projects/project-selection-combobox-input"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet"
import { Textarea } from "@/components/ui/textarea"
import type { ProjectIntakeDepartment } from "@/lib/google/project-intake-tracker"

const DEPARTMENTS: readonly {
  readonly value: ProjectIntakeDepartment
  readonly label: string
}[] = [
  { value: "O", label: "ORC" },
  { value: "H", label: "HPS" },
  { value: "N", label: "Nu-Tech" },
  { value: "D", label: "Design" },
]

function fieldValue(formData: FormData, name: string): string | null {
  const value = formData.get(name)
  if (typeof value !== "string") return null
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

function isDepartment(value: string): value is ProjectIntakeDepartment {
  return DEPARTMENTS.some((department) => department.value === value)
}

function Field({
  label,
  htmlFor,
  children,
}: {
  readonly label: string
  readonly htmlFor?: string
  readonly children: React.ReactNode
}): React.ReactElement {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={htmlFor} className="text-xs text-muted-foreground">
        {label}
      </Label>
      {children}
    </div>
  )
}

export function ProjectIntakeDrawer({
  assignees,
}: {
  readonly assignees: readonly ProjectIntakeAssignee[]
}): React.ReactElement {
  const router = useRouter()
  const formRef = useRef<HTMLFormElement>(null)
  const [open, setOpen] = useState(false)
  const [department, setDepartment] = useState<ProjectIntakeDepartment>("O")
  const [isPending, startTransition] = useTransition()

  function submitProject(event: React.FormEvent<HTMLFormElement>): void {
    event.preventDefault()
    const formData = new FormData(event.currentTarget)
    startTransition(async () => {
      const result = await createProjectIntake({
        department,
        projectName: fieldValue(formData, "projectName") ?? "",
        clientName: fieldValue(formData, "clientName"),
        companyName: fieldValue(formData, "companyName"),
        clientFirstName: fieldValue(formData, "clientFirstName"),
        clientLastName: fieldValue(formData, "clientLastName"),
        contactPhone: fieldValue(formData, "contactPhone"),
        contactEmail: fieldValue(formData, "contactEmail"),
        streetNumber: fieldValue(formData, "streetNumber"),
        streetName: fieldValue(formData, "streetName"),
        cityStateZip: fieldValue(formData, "cityStateZip"),
        billingAddress: fieldValue(formData, "billingAddress"),
        assignedTo: fieldValue(formData, "assignedTo"),
        referredBy: fieldValue(formData, "referredBy"),
        notes: fieldValue(formData, "notes"),
      })
      if (!result.success) {
        toast.error(result.error)
        return
      }
      if (result.warning) toast.warning(result.warning)
      else toast.success(`${result.projectNumber} created in Compass and Project Lead Tracking.`)
      formRef.current?.reset()
      setOpen(false)
      router.push(`/dashboard/projects/${result.id}`)
      router.refresh()
    })
  }

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <Button type="button" size="sm">
          <IconPlus className="size-4" />
          New project
        </Button>
      </SheetTrigger>
      <SheetContent className="w-[min(96vw,840px)] overflow-y-auto sm:max-w-none">
        <SheetHeader className="border-b px-5 py-4 text-left">
          <SheetTitle>New Project</SheetTitle>
          <SheetDescription>
            Create the Compass project and update the existing Project Lead Tracking register in one step.
          </SheetDescription>
        </SheetHeader>

        <form ref={formRef} onSubmit={submitProject} className="space-y-6 px-5 pb-6">
          <Alert className="rounded-none border-x-0 border-t-0">
            <IconDatabase className="size-4" />
            <AlertTitle>One intake, both systems</AlertTitle>
            <AlertDescription>
              Compass assigns the next department project number. Drive and Sage setup remain visibly staged until their integrations finish.
            </AlertDescription>
          </Alert>

          <section className="space-y-3">
            <div className="flex items-center gap-2 border-b pb-2">
              <IconBuilding className="size-4" />
              <h3 className="text-sm font-semibold">Project identity</h3>
            </div>
            <div className="grid gap-4 sm:grid-cols-[12rem_minmax(0,1fr)]">
              <Field label="Department">
                <Select
                  value={department}
                  onValueChange={(value) => {
                    if (isDepartment(value)) setDepartment(value)
                  }}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {DEPARTMENTS.map((item) => (
                      <SelectItem key={item.value} value={item.value}>
                        {item.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
              <Field label="Project name" htmlFor="project-intake-name">
                <Input
                  id="project-intake-name"
                  name="projectName"
                  placeholder="Mitchell Residence"
                  required
                />
              </Field>
            </div>
            <p className="text-xs text-muted-foreground">
              The official number is assigned from the live department sequence when you submit.
            </p>
          </section>

          <section className="space-y-3">
            <h3 className="border-b pb-2 text-sm font-semibold">Client and contact</h3>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Client display name" htmlFor="project-intake-client">
                <Input id="project-intake-client" name="clientName" placeholder="Dan and Jane Mitchell" />
              </Field>
              <Field label="Company" htmlFor="project-intake-company">
                <Input id="project-intake-company" name="companyName" />
              </Field>
              <Field label="First name" htmlFor="project-intake-first-name">
                <Input id="project-intake-first-name" name="clientFirstName" />
              </Field>
              <Field label="Last name" htmlFor="project-intake-last-name">
                <Input id="project-intake-last-name" name="clientLastName" />
              </Field>
              <Field label="Phone" htmlFor="project-intake-phone">
                <Input id="project-intake-phone" name="contactPhone" type="tel" />
              </Field>
              <Field label="Email" htmlFor="project-intake-email">
                <Input id="project-intake-email" name="contactEmail" type="email" />
              </Field>
            </div>
          </section>

          <section className="space-y-3">
            <h3 className="border-b pb-2 text-sm font-semibold">Project location</h3>
            <div className="grid gap-4 sm:grid-cols-[10rem_minmax(0,1fr)]">
              <Field label="Street number" htmlFor="project-intake-street-number">
                <Input id="project-intake-street-number" name="streetNumber" placeholder="33" />
              </Field>
              <Field label="Street name" htmlFor="project-intake-street-name">
                <Input id="project-intake-street-name" name="streetName" placeholder="Mitchell Lane" />
              </Field>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="City, state, ZIP" htmlFor="project-intake-city">
                <Input id="project-intake-city" name="cityStateZip" placeholder="Durango, CO 81301" />
              </Field>
              <Field label="Billing address" htmlFor="project-intake-billing">
                <Input id="project-intake-billing" name="billingAddress" />
              </Field>
            </div>
          </section>

          <section className="space-y-3">
            <h3 className="border-b pb-2 text-sm font-semibold">Assignment and notes</h3>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Assigned to">
                <ProjectSelectionComboboxInput
                  id="project-intake-assignee"
                  name="assignedTo"
                  options={assignees.map((assignee) => ({
                    value: assignee.name,
                    label: assignee.name,
                    description: assignee.email,
                  }))}
                  placeholder="Choose staff or type a name..."
                  emptyMessage="No matching staff member."
                  manualInputLabel="Use typed name"
                />
              </Field>
              <Field label="Referred by" htmlFor="project-intake-referral">
                <Input id="project-intake-referral" name="referredBy" />
              </Field>
            </div>
            <Field label="Notes" htmlFor="project-intake-notes">
              <Textarea id="project-intake-notes" name="notes" rows={4} />
            </Field>
          </section>

          <div className="grid gap-2 border-y py-4 text-sm sm:grid-cols-3">
            <span className="flex items-center gap-2"><IconCheck className="size-4 text-emerald-700" /> Compass registry</span>
            <span className="flex items-center gap-2"><IconCheck className="size-4 text-emerald-700" /> Project Lead Tracking</span>
            <span className="flex items-center gap-2 text-muted-foreground"><IconArrowRight className="size-4" /> Drive and Sage staging</span>
          </div>

          <SheetFooter className="px-0">
            <div className="flex justify-end gap-2">
              <Button type="button" variant="outline" onClick={() => setOpen(false)} disabled={isPending}>
                Cancel
              </Button>
              <Button type="submit" disabled={isPending}>
                {isPending ? "Creating project…" : "Create project"}
              </Button>
            </div>
          </SheetFooter>
        </form>
      </SheetContent>
    </Sheet>
  )
}
