"use client"

import { useState, useTransition } from "react"
import { useForm } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import { z } from "zod/v4"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { saveProjectEstimateAssembly, deleteProjectEstimateAssembly } from "@/app/actions/estimate-assemblies"
import type { ProjectEstimateLineItem } from "@/app/actions/project-estimates"
import type { EstimateAssembly } from "@/lib/estimates/assemblies"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogTrigger } from "@/components/ui/dialog"

const assemblyFormSchema = z.object({
  name: z.string().trim().min(1, "Enter an assembly name.").max(160),
  description: z.string().max(2000),
})

function money(cents: number): string {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(cents / 100)
}

export function ProjectEstimateAssemblyEditor({ projectId, estimateId, assembly, assemblies, lines }: {
  readonly projectId: string
  readonly estimateId: string
  readonly assembly: EstimateAssembly | null
  readonly assemblies: readonly EstimateAssembly[]
  readonly lines: readonly ProjectEstimateLineItem[]
}): React.ReactElement {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [pending, startTransition] = useTransition()
  const { register, reset, handleSubmit, formState: { errors } } = useForm<z.infer<typeof assemblyFormSchema>>({ resolver: zodResolver(assemblyFormSchema), defaultValues: { name: assembly?.name ?? "", description: assembly?.description ?? "" } })
  const [search, setSearch] = useState("")
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set())

  function changeOpen(value: boolean): void {
    if (pending) return
    if (value) {
      reset({ name: assembly?.name ?? "", description: assembly?.description ?? "" })
      setSearch("")
      setSelected(new Set(lines.filter((line) => assembly !== null && line.assemblyId === assembly.id).map((line) => line.id)))
    }
    setOpen(value)
  }

  function toggle(id: string, checked: boolean): void {
    setSelected((previous) => {
      const next = new Set(previous)
      if (checked) next.add(id)
      else next.delete(id)
      return next
    })
  }

  function submit(values: z.infer<typeof assemblyFormSchema>): void {
    startTransition(async () => {
      const result = await saveProjectEstimateAssembly(projectId, estimateId, assembly?.id ?? null, {
        ...values, lineIds: [...selected],
      })
      if (!result.success) { toast.error(result.error); return }
      toast.success(assembly ? "Assembly updated" : "Assembly created")
      setOpen(false)
      router.refresh()
    })
  }

  function remove(): void {
    if (!assembly || !window.confirm(`Delete “${assembly.name}”? Its estimate items and costs will be kept under Other work.`)) return
    startTransition(async () => {
      const result = await deleteProjectEstimateAssembly(projectId, estimateId, assembly.id)
      if (!result.success) { toast.error(result.error); return }
      toast.success("Assembly deleted; estimate items retained")
      setOpen(false)
      router.refresh()
    })
  }

  const filtered = lines.filter((line) => `${line.divisionCode} ${line.divisionName} ${line.costCode} ${line.description}`.toLowerCase().includes(search.toLowerCase()))
  const groups = new Map<string, ProjectEstimateLineItem[]>()
  for (const line of filtered) {
    const items = groups.get(line.divisionCode) ?? []
    items.push(line)
    groups.set(line.divisionCode, items)
  }
  const subtotal = lines.filter((line) => selected.has(line.id)).reduce((sum, line) => sum + line.lineTotalCents, 0)
  const movedCount = lines.filter((line) => selected.has(line.id) && line.assemblyId !== null && line.assemblyId !== assembly?.id).length

  return (
    <Dialog open={open} onOpenChange={changeOpen}>
      <DialogTrigger asChild><Button type="button" size="sm" variant="outline">{assembly ? "Edit assembly" : "Create assembly"}</Button></DialogTrigger>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{assembly ? "Edit assembly" : "Create assembly"}</DialogTitle>
          <DialogDescription>Combine estimate items from any division. Each item belongs to one assembly and retains its division and cost code.</DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit(submit)} className="space-y-4">
          <div className="space-y-1.5"><Label htmlFor="assembly-name">Assembly name</Label><Input id="assembly-name" {...register("name")} aria-invalid={Boolean(errors.name)} required maxLength={160} disabled={pending} /></div>
          <div className="space-y-1.5"><Label htmlFor="assembly-description">Report description</Label><Textarea id="assembly-description" {...register("description")} aria-invalid={Boolean(errors.description)} maxLength={2000} disabled={pending} /></div>
          {errors.name && <p role="alert" className="text-sm text-destructive">{errors.name.message}</p>}
          {errors.description && <p role="alert" className="text-sm text-destructive">{errors.description.message}</p>}
          <div className="space-y-1.5"><Label htmlFor="assembly-search">Find estimate items</Label><Input id="assembly-search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Division, cost code or description" /></div>
          <div className="max-h-72 space-y-4 overflow-y-auto">
            {[...groups.entries()].map(([divisionCode, items]) => (
              <div key={divisionCode}>
                <label className="flex items-center gap-2 border-b pb-2 text-sm font-medium">
                  <input type="checkbox" disabled={pending} checked={items.every((line) => selected.has(line.id))} onChange={(event) => {
                    const checked = event.target.checked
                    setSelected((previous) => {
                      const next = new Set(previous)
                      for (const line of items) { if (checked) next.add(line.id); else next.delete(line.id) }
                      return next
                    })
                  }} />
                  {divisionCode} · {items[0]?.divisionName}
                </label>
                {items.map((line) => (
                  <label key={line.id} className="flex items-start gap-2 border-b py-2 text-sm">
                    <input type="checkbox" className="mt-1" checked={selected.has(line.id)} disabled={pending} onChange={(event) => toggle(line.id, event.target.checked)} />
                    <span className="min-w-0 flex-1 break-words">{line.costCode} · {line.description}
                      {line.assemblyId && <span className="block text-xs text-muted-foreground">Current assembly: {assemblies.find((item) => item.id === line.assemblyId)?.name ?? "Other work"}</span>}
                    </span>
                    <span className="tabular-nums">{money(line.lineTotalCents)}</span>
                  </label>
                ))}
              </div>
            ))}
            {filtered.length === 0 && <p className="text-sm text-muted-foreground">{lines.length === 0 ? "Save the assembly, then add estimate lines to it." : "No matching estimate items."}</p>}
          </div>
          <div className="flex justify-between border-t pt-3 font-medium" aria-live="polite"><span>{selected.size} items · Assembly subtotal</span><span>{money(subtotal)}</span></div>
          {movedCount > 0 && <p className="text-sm text-muted-foreground">Saving will move {movedCount} selected items from their current assemblies into this assembly.</p>}
          <div className="flex flex-wrap justify-between gap-2">
            <div>{assembly && <Button type="button" variant="destructive" disabled={pending} onClick={remove}>Delete assembly</Button>}</div>
            <div className="flex gap-2"><Button type="button" variant="outline" disabled={pending} onClick={() => changeOpen(false)}>Cancel</Button><Button type="submit" disabled={pending}>{pending ? "Saving…" : "Save assembly"}</Button></div>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}
