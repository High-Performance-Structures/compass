"use client"

import * as React from "react"

import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Switch } from "@/components/ui/switch"
import { Textarea } from "@/components/ui/textarea"
import {
  INFO_SHEET_FIELD_KINDS,
  INFO_SHEET_FIELD_KIND_LABELS,
  INFO_SHEET_FIELD_PURPOSES,
  type InfoSheetField,
  type InfoSheetFieldKind,
  type InfoSheetFieldPurpose,
  type InfoSheetSettings,
  type TradeDocType,
} from "@/lib/trade-docs/settings"

const OFF = "off"

const PURPOSE_LABELS: Readonly<Record<InfoSheetFieldPurpose, string>> = {
  none: "-",
  agent_name: "Agent's name",
  agent_email: "Agent's email",
}

function isKind(value: string): value is InfoSheetFieldKind {
  return INFO_SHEET_FIELD_KINDS.some((kind) => kind === value)
}

function isPurpose(value: string): value is InfoSheetFieldPurpose {
  return INFO_SHEET_FIELD_PURPOSES.some((purpose) => purpose === value)
}

function newFieldId(label: string, taken: ReadonlySet<string>): string {
  const base = label.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 32) || "field"
  let id = base
  for (let n = 2; taken.has(id); n += 1) id = `${base}-${n}`
  return id
}

/**
 * The online info sheet a vendor fills in from their docs link. Fields are
 * turned off rather than removed, like document types. The answers are saved
 * as a signed PDF in the vendor's Drive folder, not in Compass.
 */
export function TradeDocInfoSheetSettings({
  value,
  onChange,
  docTypes,
  disabled,
}: {
  readonly value: InfoSheetSettings
  readonly onChange: (next: InfoSheetSettings) => void
  readonly docTypes: readonly TradeDocType[]
  readonly disabled: boolean
}): React.ReactElement {
  function updateField(index: number, patch: Partial<InfoSheetField>): void {
    onChange({ ...value, fields: value.fields.map((field, i) => (i === index ? { ...field, ...patch } : field)) })
  }

  function setPurpose(index: number, purpose: InfoSheetFieldPurpose): void {
    // Each purpose belongs to one field at most.
    onChange({
      ...value,
      fields: value.fields.map((field, i) =>
        i === index ? { ...field, purpose } : purpose !== "none" && field.purpose === purpose ? { ...field, purpose: "none" } : field,
      ),
    })
  }

  function move(index: number, by: -1 | 1): void {
    const target = index + by
    if (target < 0 || target >= value.fields.length) return
    const fields = [...value.fields]
    const [moved] = fields.splice(index, 1)
    if (!moved) return
    fields.splice(target, 0, moved)
    onChange({ ...value, fields })
  }

  function addField(): void {
    const id = newFieldId("New question", new Set(value.fields.map((field) => field.id)))
    onChange({
      ...value,
      fields: [...value.fields, { id, label: "New question", kind: "text", options: [], required: false, active: true, purpose: "none" }],
    })
  }

  return (
    <fieldset className="grid gap-3 border-t pt-4" disabled={disabled}>
      <legend className="sr-only">Online info sheet</legend>
      <div className="grid gap-1 sm:max-w-2xl">
        <h3 className="text-sm font-semibold">Online info sheet</h3>
        <p className="text-sm text-muted-foreground">
          The vendor fills this in from their docs link and signs by typing their name. Compass saves it as a PDF in the
          vendor&apos;s Drive folder and records it as the document chosen here. The answers themselves aren&apos;t kept in Compass.
        </p>
      </div>
      <div className="grid gap-1.5 sm:max-w-sm">
        <Label htmlFor="trade-doc-info-sheet-type">Records as</Label>
        <Select
          value={value.docTypeId ?? OFF}
          onValueChange={(next) => onChange({ ...value, docTypeId: next === OFF ? null : next })}
          disabled={disabled}
        >
          <SelectTrigger id="trade-doc-info-sheet-type">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={OFF}>No online info sheet</SelectItem>
            {docTypes.map((type) => (
              <SelectItem key={type.id} value={type.id}>{type.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      {value.docTypeId && (
        <>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[900px] text-sm">
              <thead>
                <tr className="border-b text-left text-xs text-muted-foreground">
                  <th className="py-2 pr-4 font-medium">Question</th>
                  <th className="py-2 pr-4 font-medium">Answer</th>
                  <th className="py-2 pr-4 font-medium">Choices</th>
                  <th className="py-2 pr-4 font-medium">Required</th>
                  <th className="py-2 pr-4 font-medium">Used for</th>
                  <th className="py-2 pr-4 font-medium">On</th>
                  <th className="py-2 font-medium">Order</th>
                </tr>
              </thead>
              <tbody>
                {value.fields.map((field, index) => (
                  <tr key={field.id} className="border-b align-top">
                    <td className="py-2 pr-4">
                      <Input aria-label={`Question ${index + 1}`} className="h-8 w-60" maxLength={80} value={field.label} onChange={(event) => updateField(index, { label: event.target.value })} />
                    </td>
                    <td className="py-2 pr-4">
                      <Select value={field.kind} onValueChange={(next) => { if (isKind(next)) updateField(index, { kind: next }) }} disabled={disabled}>
                        <SelectTrigger aria-label={`Answer type for ${field.label}`} className="h-8 w-36">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {INFO_SHEET_FIELD_KINDS.map((kind) => (
                            <SelectItem key={kind} value={kind}>{INFO_SHEET_FIELD_KIND_LABELS[kind]}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </td>
                    <td className="py-2 pr-4">
                      {field.kind === "choice" ? (
                        <Input
                          aria-label={`Choices for ${field.label}`}
                          className="h-8 w-60"
                          placeholder="Comma separated"
                          value={field.options.join(", ")}
                          onChange={(event) => updateField(index, { options: event.target.value.split(",").map((option) => option.trim()).filter(Boolean).slice(0, 12) })}
                        />
                      ) : (
                        <span className="text-muted-foreground">-</span>
                      )}
                    </td>
                    <td className="py-2 pr-4">
                      <Checkbox aria-label={`${field.label} is required`} checked={field.required} onCheckedChange={(checked) => updateField(index, { required: checked === true })} />
                    </td>
                    <td className="py-2 pr-4">
                      <Select value={field.purpose} onValueChange={(next) => { if (isPurpose(next)) setPurpose(index, next) }} disabled={disabled}>
                        <SelectTrigger aria-label={`What Compass uses ${field.label} for`} className="h-8 w-36">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {INFO_SHEET_FIELD_PURPOSES.map((purpose) => (
                            <SelectItem key={purpose} value={purpose}>{PURPOSE_LABELS[purpose]}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </td>
                    <td className="py-2 pr-4">
                      <Switch aria-label={`Ask ${field.label}`} checked={field.active} onCheckedChange={(active) => updateField(index, { active })} />
                    </td>
                    <td className="py-2">
                      <div className="flex gap-1">
                        <Button type="button" size="sm" variant="ghost" aria-label={`Move ${field.label} up`} disabled={index === 0} onClick={() => move(index, -1)}>↑</Button>
                        <Button type="button" size="sm" variant="ghost" aria-label={`Move ${field.label} down`} disabled={index === value.fields.length - 1} onClick={() => move(index, 1)}>↓</Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div>
            <Button type="button" variant="outline" size="sm" onClick={addField} disabled={value.fields.length >= 40}>Add question</Button>
          </div>
          <div className="grid gap-1.5 sm:max-w-2xl">
            <Label htmlFor="trade-doc-info-sheet-certification">Statement they sign</Label>
            <Textarea
              id="trade-doc-info-sheet-certification"
              rows={2}
              maxLength={400}
              value={value.certification}
              onChange={(event) => onChange({ ...value, certification: event.target.value })}
            />
            <p className="text-xs text-muted-foreground">
              &quot;Used for&quot; marks the agent&apos;s name and email, so the vendor can have Compass send your certificate holder
              details to their agent.
            </p>
          </div>
        </>
      )}
    </fieldset>
  )
}
