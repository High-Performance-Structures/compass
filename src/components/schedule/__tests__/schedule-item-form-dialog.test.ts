// @vitest-environment jsdom

import * as React from "react"
import { act } from "react"
import { createRoot } from "react-dom/client"
import {
  Controller,
  type ControllerProps,
  type FieldPath,
  type FieldValues,
} from "react-hook-form"
import { afterEach, describe, expect, it, vi } from "vitest"

Object.defineProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT", {
  configurable: true,
  value: true,
  writable: true,
})

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn() }),
}))

vi.mock("sonner", () => ({
  toast: { error: vi.fn(), success: vi.fn(), warning: vi.fn() },
}))

vi.mock("@/app/actions/schedule", () => ({
  createTask: vi.fn(),
  updateTask: vi.fn(),
  createDependency: vi.fn(),
  updateDependency: vi.fn(),
  deleteDependency: vi.fn(),
}))

vi.mock("@/app/actions/schedule-phases", () => ({
  deleteSchedulePhaseOption: vi.fn(),
  getSchedulePhaseOptions: vi.fn(async () => []),
  saveSchedulePhaseOption: vi.fn(),
}))

vi.mock("@/app/actions/schedule-confirmations", () => ({
  sendScheduleTaskReminder: vi.fn(),
}))

vi.mock("@/components/schedule/schedule-item-links", () => ({
  ScheduleItemLinks: () => null,
}))

vi.mock("@/components/projects/project-assignee-picker", () => ({
  ProjectAssigneePicker: () => null,
}))

vi.mock("@/components/schedule/schedule-template-import-options-client", () => ({
  clearScheduleTemplateImportOptions: vi.fn(),
  loadScheduleTemplateImportOptions: vi.fn(async () => [
    {
      templateId: "template-1",
      templateName: "Template one",
      scheduleItems: [
        {
          id: "template-item-1",
          title: "Template item",
          workdays: 7,
          phase: "preconstruction",
          displayColor: "blue",
          isMilestone: false,
          assignedTo: null,
          ownerVisible: true,
          subVendorVisible: false,
        },
      ],
      linkedTodos: [],
    },
  ]),
}))

vi.mock("@/components/ui/dialog", () => ({
  Dialog: ({ open, children }: { open: boolean; children: React.ReactNode }) =>
    open ? React.createElement(React.Fragment, null, children) : null,
  DialogContent: ({ children }: { children: React.ReactNode }) =>
    React.createElement("section", null, children),
  DialogHeader: ({ children }: { children: React.ReactNode }) =>
    React.createElement(React.Fragment, null, children),
  DialogTitle: ({ children }: { children: React.ReactNode }) =>
    React.createElement("h1", null, children),
}))

vi.mock("@/components/ui/form", () => {
  type FormFieldProps<TFieldValues extends FieldValues> = ControllerProps<
    TFieldValues,
    FieldPath<TFieldValues>
  >

  function FormField<TFieldValues extends FieldValues>({
    control,
    name,
    ...props
  }: FormFieldProps<TFieldValues>): React.ReactNode {
    return React.createElement(
      Controller<TFieldValues, FieldPath<TFieldValues>>,
      { control, name, ...props }
    )
  }

  const passthrough = ({ children }: { children: React.ReactNode }) =>
    React.createElement(React.Fragment, null, children)

  return {
    Form: passthrough,
    FormControl: passthrough,
    FormField,
    FormItem: passthrough,
    FormLabel: passthrough,
    FormMessage: () => null,
  }
})

vi.mock("@/components/ui/input", () => ({
  Input: React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(
    (props, ref) => React.createElement("input", { ...props, ref })
  ),
}))

vi.mock("@/components/ui/textarea", () => ({
  Textarea: React.forwardRef<HTMLTextAreaElement, React.TextareaHTMLAttributes<HTMLTextAreaElement>>(
    (props, ref) => React.createElement("textarea", { ...props, ref })
  ),
}))

vi.mock("@/components/ui/button", () => ({
  Button: React.forwardRef<HTMLButtonElement, React.ButtonHTMLAttributes<HTMLButtonElement>>(
    (props, ref) => React.createElement("button", { ...props, ref })
  ),
}))

vi.mock("@/components/ui/select", () => {
  type SelectContextValue = {
    value?: string
    disabled?: boolean
    onValueChange?: (value: string) => void
  }
  const SelectContext = React.createContext<SelectContextValue>({})

  function Select({
    value,
    disabled,
    onValueChange,
    children,
  }: SelectContextValue & { children: React.ReactNode }): React.ReactNode {
    return React.createElement(
      SelectContext.Provider,
      { value: { value, disabled, onValueChange } },
      children
    )
  }

  function SelectTrigger({
    children,
    ...props
  }: React.SelectHTMLAttributes<HTMLSelectElement>): React.ReactNode {
    const select = React.useContext(SelectContext)
    return React.createElement(
      "select",
      {
        ...props,
        value: select.value ?? "",
        disabled: select.disabled,
        onChange: (event: React.ChangeEvent<HTMLSelectElement>) =>
          select.onValueChange?.(event.currentTarget.value),
      },
      children
    )
  }

  return {
    Select,
    SelectContent: ({ children }: { children: React.ReactNode }) =>
      React.createElement(React.Fragment, null, children),
    SelectItem: ({
      value,
      children,
    }: {
      value: string
      children: React.ReactNode
    }) => React.createElement("option", { value }, children),
    SelectTrigger,
    SelectValue: () => null,
  }
})

vi.mock("@/components/ui/popover", () => ({
  Popover: ({ children }: { children: React.ReactNode }) =>
    React.createElement(React.Fragment, null, children),
  PopoverContent: ({ children }: { children: React.ReactNode }) =>
    React.createElement(React.Fragment, null, children),
  PopoverTrigger: ({ children }: { children: React.ReactNode }) =>
    React.createElement(React.Fragment, null, children),
}))

vi.mock("@/components/ui/calendar", () => ({
  Calendar: () => null,
}))

vi.mock("@/components/ui/collapsible", () => ({
  Collapsible: ({ children }: { children: React.ReactNode }) =>
    React.createElement(React.Fragment, null, children),
  CollapsibleContent: ({ children }: { children: React.ReactNode }) =>
    React.createElement(React.Fragment, null, children),
  CollapsibleTrigger: ({ children }: { children: React.ReactNode }) =>
    React.createElement(React.Fragment, null, children),
}))

vi.mock("@/components/ui/slider", () => ({
  Slider: () => null,
}))

vi.mock("@/components/ui/switch", () => ({
  Switch: ({ checked, onCheckedChange }: { checked: boolean; onCheckedChange: (value: boolean) => void }) =>
    React.createElement("input", {
      type: "checkbox",
      checked,
      onChange: (event: React.ChangeEvent<HTMLInputElement>) =>
        onCheckedChange(event.currentTarget.checked),
    }),
}))

vi.mock("@/components/ui/checkbox", () => ({
  Checkbox: ({ checked, onCheckedChange }: { checked: boolean; onCheckedChange: (value: boolean) => void }) =>
    React.createElement("input", {
      type: "checkbox",
      checked,
      onChange: (event: React.ChangeEvent<HTMLInputElement>) =>
        onCheckedChange(event.currentTarget.checked),
    }),
}))

vi.mock("@tabler/icons-react", () => {
  const Icon = () => React.createElement("span")
  return {
    IconCalendar: Icon,
    IconChevronDown: Icon,
    IconChevronRight: Icon,
    IconLoader2: Icon,
    IconPlus: Icon,
    IconTemplate: Icon,
    IconTrash: Icon,
  }
})

import { ScheduleItemFormDialog } from "@/components/schedule/schedule-item-form-dialog"

const templateSelector = 'select[aria-label="Choose schedule template"]'
const emptyTasks: readonly never[] = []
const emptyDependencies: readonly never[] = []
const emptyExceptions: readonly never[] = []
const emptyAssignees: readonly never[] = []

function createTestDom(): { container: HTMLDivElement; cleanup: () => void } {
  const container = document.createElement("div")
  document.body.appendChild(container)
  return {
    container,
    cleanup: () => container.remove(),
  }
}

function getDurationInput(container: HTMLDivElement): HTMLInputElement {
  const element = container.querySelector('input[name="workdays"]')
  if (!(element instanceof window.HTMLInputElement)) {
    throw new Error("Duration input is not rendered")
  }
  return element
}

function getTemplateSelect(container: HTMLDivElement): HTMLSelectElement {
  const element = container.querySelector(templateSelector)
  if (!(element instanceof window.HTMLSelectElement)) {
    throw new Error("Template picker is not rendered")
  }
  return element
}

function renderDialog(container: HTMLDivElement) {
  const root = createRoot(container)
  return {
    root,
    render: async (nextOpen: boolean) => {
      await act(async () => {
        root.render(
          React.createElement(ScheduleItemFormDialog, {
            open: nextOpen,
            onOpenChange: () => undefined,
            projectId: "project-1",
            editingTask: null,
            allTasks: emptyTasks,
            dependencies: emptyDependencies,
            exceptions: emptyExceptions,
            assigneeOptions: emptyAssignees,
          })
        )
        await Promise.resolve()
        await Promise.resolve()
      })
    },
  }
}

afterEach(() => {
  vi.clearAllMocks()
})

describe("ScheduleItemFormDialog", () => {
  it("renders a one-workday duration for a new item", async () => {
    const dom = createTestDom()
    const dialog = renderDialog(dom.container)
    await dialog.render(true)

    expect(getDurationInput(dom.container).value).toBe("1")

    await act(async () => {
      dialog.root.unmount()
    })
    dom.cleanup()
  })

  it("restores one workday when a cancelled form is reopened", async () => {
    const dom = createTestDom()
    const dialog = renderDialog(dom.container)
    await dialog.render(true)

    const duration = getDurationInput(dom.container)
    await act(async () => {
      duration.value = "5"
      duration.dispatchEvent(new Event("input", { bubbles: true }))
    })
    expect(duration.value).toBe("5")

    await dialog.render(false)
    await dialog.render(true)

    expect(getDurationInput(dom.container).value).toBe("1")

    await act(async () => {
      dialog.root.unmount()
    })
    dom.cleanup()
  })

  it("resets manual duration to one workday when a template is chosen", async () => {
    const dom = createTestDom()
    const dialog = renderDialog(dom.container)
    await dialog.render(true)

    const duration = getDurationInput(dom.container)
    await act(async () => {
      duration.value = "5"
      duration.dispatchEvent(new Event("input", { bubbles: true }))
    })
    expect(duration.value).toBe("5")

    const template = getTemplateSelect(dom.container)
    await act(async () => {
      template.value = "template-1"
      template.dispatchEvent(new Event("change", { bubbles: true }))
      await Promise.resolve()
    })

    expect(getDurationInput(dom.container).value).toBe("1")

    await act(async () => {
      dialog.root.unmount()
    })
    dom.cleanup()
  })
})
