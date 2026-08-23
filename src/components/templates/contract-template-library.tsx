"use client"

import Link from "next/link"
import { useRouter } from "next/navigation"
import { useState, useTransition } from "react"
import {
  IconArchive,
  IconFileImport,
  IconFileText,
  IconUpload,
} from "@tabler/icons-react"
import { toast } from "sonner"

import {
  archiveContractTemplate,
  createContractTemplateDraft,
  importOrcContractTemplateLibrary,
  publishContractTemplateVersion,
  saveContractTemplateDraft,
  type ContractTemplateLibraryItem,
} from "@/app/actions/contract-templates"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog"
import { Badge } from "@/components/ui/badge"
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
import { Textarea } from "@/components/ui/textarea"

function statusLabel(value: string): string {
  return value.replaceAll("_", " ")
}

function TemplateEditor({
  template,
  canManage,
}: {
  readonly template: ContractTemplateLibraryItem
  readonly canManage: boolean
}): React.ReactElement {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [name, setName] = useState(template.name)
  const [category, setCategory] = useState(template.category)
  const [signingStage, setSigningStage] = useState(template.signingStage)
  const [inclusionMode, setInclusionMode] = useState(
    template.defaultInclusionMode
  )
  const [content, setContent] = useState(template.version?.contentMarkdown ?? "")
  const [changeNote, setChangeNote] = useState(template.version?.changeNote ?? "")

  function save(): void {
    startTransition(async () => {
      const result = await saveContractTemplateDraft({
        templateId: template.id,
        name,
        category,
        signingStage,
        inclusionMode,
        contentMarkdown: content,
        changeNote,
      })
      if (!result.success) {
        toast.error(result.error)
        return
      }
      toast.success(result.message)
      router.refresh()
    })
  }

  function publish(): void {
    if (!template.version) return
    startTransition(async () => {
      const result = await publishContractTemplateVersion(
        template.id,
        template.version?.id ?? ""
      )
      if (!result.success) {
        toast.error(result.error)
        return
      }
      toast.success(result.message)
      router.refresh()
    })
  }

  return (
    <article className="border-b py-4 last:border-b-0">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-semibold">{template.code}</span>
            <span>{template.name}</span>
            <Badge variant="outline">{statusLabel(template.category)}</Badge>
            <Badge variant="secondary">
              {statusLabel(template.signingStage)}
            </Badge>
          </div>
          <p className="mt-1 text-xs text-muted-foreground">
            {template.version
              ? `Version ${template.version.versionNumber} · ${statusLabel(template.version.status)}`
              : "No version imported"}
            {template.defaultInclusionMode === "reference"
              ? " · referenced, not embedded"
              : ""}
          </p>
        </div>
        <div className="flex gap-2">
          {template.version?.driveDocumentUrl && (
            <Button asChild size="sm" variant="outline">
              <Link href={template.version.driveDocumentUrl} target="_blank">
                <IconFileText className="size-4" />Drive copy
              </Link>
            </Button>
          )}
          {template.sourceUrl && (
            <Button asChild size="sm" variant="outline">
              <Link href={template.sourceUrl} target="_blank">Source</Link>
            </Button>
          )}
        </div>
      </div>

      <details className="mt-3">
        <summary className="cursor-pointer text-sm font-medium">
          Review and edit template
        </summary>
        <div className="mt-4 grid gap-4 border-t pt-4 md:grid-cols-2 xl:grid-cols-4">
          <div className="space-y-1.5 md:col-span-2">
            <Label htmlFor={`contract-name-${template.id}`}>Document name</Label>
            <Input
              id={`contract-name-${template.id}`}
              value={name}
              onChange={(event) => setName(event.target.value)}
              disabled={!canManage}
            />
          </div>
          <div className="space-y-1.5">
            <Label>Category</Label>
            <Select value={category} onValueChange={setCategory} disabled={!canManage}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="agreement">Agreement</SelectItem>
                <SelectItem value="general_conditions">General conditions</SelectItem>
                <SelectItem value="exhibit">Exhibit</SelectItem>
                <SelectItem value="form">Operational form</SelectItem>
                <SelectItem value="manual">Manual</SelectItem>
                <SelectItem value="generated">Compass-generated</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label>Signing stage</Label>
            <Select value={signingStage} onValueChange={setSigningStage} disabled={!canManage}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="contract">Contract execution</SelectItem>
                <SelectItem value="construction">During construction</SelectItem>
                <SelectItem value="closeout">Closeout / walk-through</SelectItem>
                <SelectItem value="reference">Reference only</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label>Packet treatment</Label>
            <Select value={inclusionMode} onValueChange={setInclusionMode} disabled={!canManage}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="embedded">Embed content</SelectItem>
                <SelectItem value="reference">Reference only</SelectItem>
                <SelectItem value="generated">Generate from Compass</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5 md:col-span-2 xl:col-span-3">
            <Label htmlFor={`contract-note-${template.id}`}>Version note</Label>
            <Input
              id={`contract-note-${template.id}`}
              value={changeNote}
              onChange={(event) => setChangeNote(event.target.value)}
              disabled={!canManage}
              placeholder="What changed in this version?"
            />
          </div>
          <div className="space-y-1.5 md:col-span-2 xl:col-span-4">
            <Label htmlFor={`contract-content-${template.id}`}>
              Document content
            </Label>
            <Textarea
              id={`contract-content-${template.id}`}
              rows={18}
              value={content}
              onChange={(event) => setContent(event.target.value)}
              disabled={!canManage || template.defaultInclusionMode === "generated"}
              className="font-mono text-xs"
            />
            <p className="text-xs text-muted-foreground">
              Markdown headings, lists, and tables are supported. Compass tokens
              such as {"{{project.address}}"} are filled from the packet snapshot.
            </p>
          </div>
        </div>
        {canManage && (
          <div className="mt-4 flex flex-wrap justify-end gap-2 border-t pt-4">
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button variant="ghost" className="text-destructive" disabled={pending}>
                  <IconArchive className="size-4" />Archive
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Archive {template.code}?</AlertDialogTitle>
                  <AlertDialogDescription>
                    It will no longer be available for new packets. Existing
                    project packets retain their document snapshots.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                  <AlertDialogAction
                    onClick={() =>
                      startTransition(async () => {
                        const result = await archiveContractTemplate(template.id)
                        if (!result.success) {
                          toast.error(result.error)
                          return
                        }
                        toast.success(result.message)
                        router.refresh()
                      })
                    }
                  >Archive template</AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
            <Button variant="outline" onClick={save} disabled={pending}>
              Save as draft
            </Button>
            {template.version?.status === "draft" && (
              <Button onClick={publish} disabled={pending}>
                <IconUpload className="size-4" />Publish v{template.version.versionNumber}
              </Button>
            )}
          </div>
        )}
      </details>
    </article>
  )
}

export function ContractTemplateLibrary({
  templates,
  canManage,
}: {
  readonly templates: readonly ContractTemplateLibraryItem[]
  readonly canManage: boolean
}): React.ReactElement {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [newCode, setNewCode] = useState("")
  const [newName, setNewName] = useState("")
  const [newContent, setNewContent] = useState("")

  function createTemplate(): void {
    startTransition(async () => {
      const result = await createContractTemplateDraft({
        code: newCode,
        name: newName,
        contentMarkdown: newContent,
      })
      if (!result.success) {
        toast.error(result.error)
        return
      }
      setNewCode("")
      setNewName("")
      setNewContent("")
      toast.success(result.message)
      router.refresh()
    })
  }
  return (
    <section>
      <div className="flex flex-wrap items-start justify-between gap-4 border-y py-4">
        <div>
          <h2 className="font-semibold">Contract document library</h2>
          <p className="mt-1 max-w-3xl text-sm text-muted-foreground">
            Published versions are copied into project packets. Editing a
            template creates an independent draft; existing packets never change.
          </p>
        </div>
        {canManage && (
          <Button
            onClick={() =>
              startTransition(async () => {
                const result = await importOrcContractTemplateLibrary()
                if (!result.success) {
                  toast.error(result.error)
                  return
                }
                toast.success(result.message)
                router.refresh()
              })
            }
            disabled={pending}
          >
            <IconFileImport className="size-4" />
            {templates.length === 0 ? "Import ORC contract library" : "Refresh from approved source"}
          </Button>
        )}
      </div>
      {templates.length === 0 ? (
        <div className="border-b py-10 text-sm text-muted-foreground">
          Import the approved ORC workbook to create the initial published library.
        </div>
      ) : (
        <div>{templates.map((template) => (
          <TemplateEditor key={template.id} template={template} canManage={canManage} />
        ))}</div>
      )}
      {canManage && (
        <details className="border-b py-4">
          <summary className="cursor-pointer text-sm font-medium">
            Create a new contract document or addendum
          </summary>
          <div className="mt-4 grid gap-4 border-t pt-4 md:grid-cols-3">
            <div className="space-y-1.5">
              <Label htmlFor="new-contract-code">Document code *</Label>
              <Input
                id="new-contract-code"
                value={newCode}
                onChange={(event) => setNewCode(event.target.value.toUpperCase())}
                placeholder="ADD-01"
                maxLength={20}
              />
            </div>
            <div className="space-y-1.5 md:col-span-2">
              <Label htmlFor="new-contract-name">Document name *</Label>
              <Input
                id="new-contract-name"
                value={newName}
                onChange={(event) => setNewName(event.target.value)}
                placeholder="Project-specific addendum"
              />
            </div>
            <div className="space-y-1.5 md:col-span-3">
              <Label htmlFor="new-contract-content">Initial document text *</Label>
              <Textarea
                id="new-contract-content"
                rows={10}
                value={newContent}
                onChange={(event) => setNewContent(event.target.value)}
                className="font-mono text-xs"
                placeholder="# Addendum title"
              />
            </div>
          </div>
          <div className="mt-4 flex justify-end border-t pt-4">
            <Button
              onClick={createTemplate}
              disabled={pending || !newCode.trim() || !newName.trim() || !newContent.trim()}
            >
              <IconFileText className="size-4" />Create draft
            </Button>
          </div>
        </details>
      )}
    </section>
  )
}
