"use client"

// Form inputs bound to the json-render state store (BoundInput, BoundTextarea,
// BoundSelect, BoundCheckbox, BoundRadio, BoundSwitch) and FormComponent, which
// collects their values and submits them as one formSubmit action.
// Used by the Form/Input/... renderers in ./form-fields.tsx.

import { useState, type ReactNode } from "react"
import { useStateBinding, useStateStore } from "@json-render/react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Checkbox } from "@/components/ui/checkbox"
import { Switch } from "@/components/ui/switch"
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { FormIdProvider, useFormId } from "../form-context"
import { isRecord } from "@/lib/shared/guards"

// Form input wrapper that uses data binding
export function BoundInput({
  name,
  label,
  type,
  placeholder,
  defaultValue,
}: {
  readonly name: string
  readonly label: string
  readonly type: string
  readonly placeholder: string
  readonly defaultValue?: string
}) {
  const formId = useFormId()
  const path = `/form/${formId}/${name}`
  const [value, setValue] = useStateBinding<string>(path)

  // seed default value on first render
  if (value === undefined && defaultValue) {
    setValue(defaultValue)
  }

  return (
    <div className="space-y-2">
      <Label htmlFor={name}>{label}</Label>
      <Input
        id={name}
        name={name}
        type={type}
        placeholder={placeholder}
        value={value ?? defaultValue ?? ""}
        onChange={(e) => setValue(e.target.value)}
      />
    </div>
  )
}

export function BoundTextarea({
  name,
  label,
  placeholder,
  rows,
  defaultValue,
}: {
  readonly name: string
  readonly label: string
  readonly placeholder: string
  readonly rows: number
  readonly defaultValue?: string
}) {
  const formId = useFormId()
  const path = `/form/${formId}/${name}`
  const [value, setValue] = useStateBinding<string>(path)

  if (value === undefined && defaultValue) {
    setValue(defaultValue)
  }

  return (
    <div className="space-y-2">
      <Label htmlFor={name}>{label}</Label>
      <Textarea
        id={name}
        name={name}
        placeholder={placeholder}
        rows={rows}
        value={value ?? defaultValue ?? ""}
        onChange={(e) => setValue(e.target.value)}
      />
    </div>
  )
}

export function BoundSelect({
  name,
  label,
  options,
  placeholder,
  defaultValue,
}: {
  readonly name: string
  readonly label: string
  readonly options: ReadonlyArray<string>
  readonly placeholder: string
  readonly defaultValue?: string
}) {
  const formId = useFormId()
  const path = `/form/${formId}/${name}`
  const [value, setValue] = useStateBinding<string>(path)

  if (value === undefined && defaultValue) {
    setValue(defaultValue)
  }

  return (
    <div className="space-y-2">
      <Label>{label}</Label>
      <Select
        value={value ?? defaultValue ?? ""}
        onValueChange={setValue}
      >
        <SelectTrigger className="w-full">
          <SelectValue placeholder={placeholder} />
        </SelectTrigger>
        <SelectContent>
          {options.map((opt) => (
            <SelectItem key={opt} value={opt}>
              {opt}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  )
}

export function BoundCheckbox({
  name,
  label,
  defaultChecked,
  onChangeAction,
  onChangeParams,
  onAction,
}: {
  readonly name: string
  readonly label: string
  readonly defaultChecked: boolean
  readonly onChangeAction?: string
  readonly onChangeParams?: Record<string, unknown>
  readonly onAction?: (action: {
    name: string
    params?: Record<string, unknown>
  }) => void
}) {
  const formId = useFormId()
  const path = `/form/${formId}/${name}`
  const [value, setValue] =
    useStateBinding<boolean>(path)

  if (value === undefined) {
    setValue(defaultChecked)
  }

  const checked = value ?? defaultChecked

  return (
    <div className="flex items-center space-x-2">
      <Checkbox
        id={name}
        checked={checked}
        onCheckedChange={(c) => {
          const next = c === true
          setValue(next)
          if (onChangeAction && onAction) {
            onAction({
              name: "mutate",
              params: {
                action: onChangeAction,
                params: onChangeParams ?? {},
              },
            })
          }
        }}
      />
      <Label
        htmlFor={name}
        className={`cursor-pointer ${
          checked
            ? "line-through text-muted-foreground"
            : ""
        }`}
      >
        {label}
      </Label>
    </div>
  )
}

export function BoundRadio({
  name,
  label,
  options,
  defaultValue,
}: {
  readonly name: string
  readonly label?: string
  readonly options: ReadonlyArray<string>
  readonly defaultValue?: string
}) {
  const formId = useFormId()
  const path = `/form/${formId}/${name}`
  const [value, setValue] = useStateBinding<string>(path)

  const initial = defaultValue ?? options[0] ?? ""
  if (value === undefined) {
    setValue(initial)
  }

  return (
    <div className="space-y-2">
      {label && <Label>{label}</Label>}
      <RadioGroup
        value={value ?? initial}
        onValueChange={setValue}
      >
        {options.map((opt) => (
          <div
            key={opt}
            className="flex items-center space-x-2"
          >
            <RadioGroupItem
              value={opt}
              id={`${name}-${opt}`}
            />
            <Label
              htmlFor={`${name}-${opt}`}
              className="cursor-pointer"
            >
              {opt}
            </Label>
          </div>
        ))}
      </RadioGroup>
    </div>
  )
}

export function BoundSwitch({
  name,
  label,
  defaultChecked,
  onChangeAction,
  onChangeParams,
  onAction,
}: {
  readonly name: string
  readonly label: string
  readonly defaultChecked: boolean
  readonly onChangeAction?: string
  readonly onChangeParams?: Record<string, unknown>
  readonly onAction?: (action: {
    name: string
    params?: Record<string, unknown>
  }) => void
}) {
  const formId = useFormId()
  const path = `/form/${formId}/${name}`
  const [value, setValue] =
    useStateBinding<boolean>(path)

  if (value === undefined) {
    setValue(defaultChecked)
  }

  return (
    <div className="flex items-center justify-between space-x-2">
      <Label
        htmlFor={name}
        className="cursor-pointer"
      >
        {label}
      </Label>
      <Switch
        id={name}
        checked={value ?? defaultChecked}
        onCheckedChange={(next) => {
          setValue(next)
          if (onChangeAction && onAction) {
            onAction({
              name: "mutate",
              params: {
                action: onChangeAction,
                params: onChangeParams ?? {},
              },
            })
          }
        }}
      />
    </div>
  )
}

// Form component that collects bound values and submits
export function FormComponent({
  formId,
  action,
  actionParams,
  submitLabel,
  children,
  onAction,
}: {
  readonly formId: string
  readonly action: string
  readonly actionParams?: Record<string, unknown>
  readonly submitLabel?: string
  readonly children?: ReactNode
  readonly onAction?: (action: {
    name: string
    params?: Record<string, unknown>
  }) => void
}) {
  const [submitting, setSubmitting] = useState(false)
  const [feedback, setFeedback] = useState<{
    type: "success" | "error"
    message: string
  } | null>(null)
  const stateCtx = useStateStore()

  const handleSubmit = async () => {
    setSubmitting(true)
    setFeedback(null)

    // collect all values under /form/{formId}/
    const formData: Record<string, unknown> = {}

    // walk the data model to find form values
    const allData = stateCtx.state
    if (
      allData &&
      typeof allData === "object" &&
      "form" in allData
    ) {
      const forms = allData.form
      if (isRecord(forms) && forms[formId]) {
        Object.assign(formData, forms[formId])
      }
    }

    // also try path-based get for nested data
    // StateProvider supports path-based access.
    const rawVal = stateCtx.get(`/form/${formId}`)
    if (rawVal && typeof rawVal === "object") {
      Object.assign(formData, rawVal)
    }

    onAction?.({
      name: "formSubmit",
      params: {
        action,
        formData,
        actionParams: actionParams ?? {},
      },
    })

    setSubmitting(false)
  }

  return (
    <FormIdProvider value={formId}>
      <div className="space-y-4">
        {children}
        {feedback && (
          <div
            className={`text-sm px-3 py-2 rounded ${
              feedback.type === "success"
                ? "bg-success/10 text-success  "
                : "bg-destructive/10 text-destructive  "
            }`}
          >
            {feedback.message}
          </div>
        )}
        <Button
          onClick={handleSubmit}
          disabled={submitting}
          className="w-full"
        >
          {submitting
            ? "Saving..."
            : submitLabel ?? "Submit"}
        </Button>
      </div>
    </FormIdProvider>
  )
}
