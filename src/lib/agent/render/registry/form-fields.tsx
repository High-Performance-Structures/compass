"use client"

// Form pieces Jarvis can render: the Form container, its inputs (Input,
// Textarea, Select, Checkbox, Radio, Switch), Button and Link. The inputs are
// thin wrappers over ./form-controls.tsx.
// Part of the agent render registry; ../registry.tsx combines every group.

import { Button } from "@/components/ui/button"
import {
  BoundInput,
  BoundTextarea,
  BoundSelect,
  BoundCheckbox,
  BoundRadio,
  BoundSwitch,
  FormComponent,
} from "./form-controls"
import type { ComponentMap } from "./types"

export const formFieldComponents: ComponentMap<
  | "Form"
  | "Input"
  | "Textarea"
  | "Select"
  | "Checkbox"
  | "Radio"
  | "Switch"
  | "Button"
  | "Link"
> = {
  // --- Form Container ---

  Form: ({ props, children, onAction }) => (
    <FormComponent
      formId={props.formId}
      action={props.action}
      actionParams={
        props.actionParams ?? undefined
      }
      submitLabel={props.submitLabel ?? undefined}
      onAction={onAction}
    >
      {children}
    </FormComponent>
  ),

  // --- Form Inputs ---

  Input: ({ props }) => (
    <BoundInput
      name={props.name}
      label={props.label}
      type={props.type ?? "text"}
      placeholder={props.placeholder ?? ""}
      defaultValue={props.value ?? undefined}
    />
  ),

  Textarea: ({ props }) => (
    <BoundTextarea
      name={props.name}
      label={props.label}
      placeholder={props.placeholder ?? ""}
      rows={props.rows ?? 3}
      defaultValue={props.value ?? undefined}
    />
  ),

  Select: ({ props }) => (
    <BoundSelect
      name={props.name}
      label={props.label}
      options={props.options}
      placeholder={props.placeholder ?? "Select..."}
      defaultValue={props.value ?? undefined}
    />
  ),

  Checkbox: ({ props, onAction }) => (
    <BoundCheckbox
      name={props.name}
      label={props.label}
      defaultChecked={!!props.checked}
      onChangeAction={props.onChangeAction ?? undefined}
      onChangeParams={
        props.onChangeParams ?? undefined
      }
      onAction={onAction}
    />
  ),

  Radio: ({ props }) => (
    <BoundRadio
      name={props.name}
      label={props.label}
      options={props.options}
      defaultValue={props.value ?? undefined}
    />
  ),

  Switch: ({ props, onAction }) => (
    <BoundSwitch
      name={props.name}
      label={props.label}
      defaultChecked={!!props.checked}
      onChangeAction={props.onChangeAction ?? undefined}
      onChangeParams={
        props.onChangeParams ?? undefined
      }
      onAction={onAction}
    />
  ),

  // --- Actions ---

  Button: ({ props, onAction, loading }) => {
    const variant =
      props.variant === "danger"
        ? "destructive"
        : props.variant === "secondary"
          ? "secondary"
          : "default"

    return (
      <Button
        variant={variant}
        disabled={loading}
        onClick={() =>
          onAction?.({
            name: props.action ?? "buttonClick",
            params:
              props.actionParams ?? {
                message: props.label,
              },
          })
        }
      >
        {loading ? "..." : props.label}
      </Button>
    )
  },

  Link: ({ props, onAction }) => (
    <Button
      variant="link"
      className="h-auto p-0"
      onClick={() =>
        onAction?.({
          name: "navigateTo",
          params: { path: props.href },
        })
      }
    >
      {props.label}
    </Button>
  ),
}
