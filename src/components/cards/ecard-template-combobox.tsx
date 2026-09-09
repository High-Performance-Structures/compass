"use client"

import { useState } from "react"
import Image from "next/image"
import { Check, ChevronsUpDown } from "lucide-react"

import { Button } from "@/components/ui/button"
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"
import {
  ECARD_TEMPLATES,
  getEcardTemplate,
  type EcardDepartment,
  type EcardTemplate,
} from "@/lib/greeting-cards/templates"
import { cn } from "@/lib/utils"

const DEPARTMENTS: readonly EcardDepartment[] = [
  "company",
  "orc",
  "hps",
  "nu-tech",
]

export function EcardTemplateCombobox({
  value,
  onValueChange,
}: {
  readonly value: string
  readonly onValueChange: (value: string) => void
}): React.ReactElement {
  const [open, setOpen] = useState(false)
  const selectedTemplate = getEcardTemplate(value)

  return (
    <Popover modal open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          id="greeting-ecard-design"
          type="button"
          variant="outline"
          role="combobox"
          aria-expanded={open}
          aria-label="Choose an e-card design"
          className="h-auto min-h-16 w-full justify-between gap-3 px-3 py-2 text-left font-normal"
        >
          {selectedTemplate?.thumbnailPath ? (
            <Image
              src={selectedTemplate.thumbnailPath}
              alt=""
              width={72}
              height={48}
              className="h-12 w-18 shrink-0 rounded-md border object-cover"
              unoptimized
            />
          ) : null}
          <span className="min-w-0 flex-1">
            <span className="block truncate font-medium">
              {selectedTemplate
                ? `${selectedTemplate.code} · ${selectedTemplate.name}`
                : "Choose an e-card"}
            </span>
            {selectedTemplate ? (
              <span className="block truncate text-xs text-muted-foreground">
                {departmentLabel(selectedTemplate.department)} · {styleLabel(selectedTemplate)}
              </span>
            ) : null}
          </span>
          <ChevronsUpDown className="size-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        className="z-[70] w-[var(--radix-popover-trigger-width)] min-w-[22rem] max-w-[calc(100vw-2rem)] p-0"
      >
        <Command>
          <CommandInput placeholder="Search design, department, occasion, or code…" />
          <CommandList className="compass-content-scroll max-h-[28rem]">
            <CommandEmpty>No matching e-card design.</CommandEmpty>
            {DEPARTMENTS.map((department) => (
              <CommandGroup
                key={department}
                heading={departmentLabel(department)}
              >
                {ECARD_TEMPLATES.filter(
                  (template) => template.department === department,
                ).map((template) => (
                  <TemplateOption
                    key={template.id}
                    template={template}
                    selected={template.id === value}
                    onSelect={() => {
                      onValueChange(template.id)
                      setOpen(false)
                    }}
                  />
                ))}
              </CommandGroup>
            ))}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
}

function TemplateOption({
  template,
  selected,
  onSelect,
}: {
  readonly template: EcardTemplate
  readonly selected: boolean
  readonly onSelect: () => void
}): React.ReactElement {
  const searchableValue = [
    template.code,
    template.name,
    template.description,
    departmentLabel(template.department),
    styleLabel(template),
  ].join(" ")

  return (
    <CommandItem
      value={searchableValue}
      onSelect={onSelect}
      className="items-start gap-3 py-2"
    >
      <Check
        className={cn("mt-5 size-4", selected ? "opacity-100" : "opacity-0")}
      />
      {template.thumbnailPath ? (
        <Image
          src={template.thumbnailPath}
          alt=""
          width={96}
          height={64}
          className="h-16 w-24 shrink-0 rounded-md border object-cover"
          unoptimized
        />
      ) : null}
      <span className="min-w-0 flex-1 py-1">
        <span className="block truncate font-medium">
          {template.code} · {template.name}
        </span>
        <span className="mt-1 block line-clamp-2 text-xs leading-4 text-muted-foreground">
          {template.description}
        </span>
        <span className="mt-1 block text-xs text-muted-foreground">
          {styleLabel(template)}
        </span>
      </span>
    </CommandItem>
  )
}

function departmentLabel(department: EcardDepartment): string {
  switch (department) {
    case "company":
      return "Company-wide"
    case "orc":
      return "Open Range Construction"
    case "hps":
      return "High Performance Structures"
    case "nu-tech":
      return "Nu-Tech Systems"
  }
}

function styleLabel(template: EcardTemplate): string {
  switch (template.style) {
    case "message":
      return "Message design"
    case "photo":
      return "Wordless photo"
    case "illustrated":
      return "Wordless illustration"
    case "legacy":
      return "Classic design"
  }
}
