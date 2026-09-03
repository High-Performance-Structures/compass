"use client"

import { useState, useTransition, type FormEvent, type MouseEvent } from "react"
import { useRouter } from "next/navigation"
import { IconEdit, IconTrash } from "@tabler/icons-react"
import { toast } from "sonner"

import {
  removeProjectDocument,
  updateProjectDocument,
  type ProjectDocumentItem,
} from "@/app/actions/project-documents"
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
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
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
import { PROJECT_DOCUMENT_CATEGORIES } from "@/lib/project-documents"

export function ProjectDocumentManagementActions({
  projectId,
  document,
}: {
  readonly projectId: string
  readonly document: ProjectDocumentItem
}): React.ReactElement {
  const router = useRouter()
  const [editOpen, setEditOpen] = useState(false)
  const [removeOpen, setRemoveOpen] = useState(false)
  const [category, setCategory] = useState(document.category)
  const [error, setError] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()
  const isReferenced = document.references.length > 0

  function changeEditOpen(nextOpen: boolean): void {
    setEditOpen(nextOpen)
    if (nextOpen) {
      setCategory(document.category)
      setError(null)
    }
  }

  function changeRemoveOpen(nextOpen: boolean): void {
    setRemoveOpen(nextOpen)
    if (nextOpen) setError(null)
  }

  function save(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault()
    const data = new FormData(event.currentTarget)
    setError(null)
    startTransition(async () => {
      const result = await updateProjectDocument(projectId, document.id, {
        category,
        title: String(data.get("title") ?? ""),
        description: String(data.get("description") ?? ""),
        documentDate: String(data.get("documentDate") ?? ""),
        revision: String(data.get("revision") ?? ""),
      })
      if (!result.success) {
        setError(result.error)
        return
      }
      toast.success("Document information updated.")
      setEditOpen(false)
      router.refresh()
    })
  }

  function remove(event: MouseEvent<HTMLButtonElement>): void {
    event.preventDefault()
    if (isReferenced) return
    setError(null)
    startTransition(async () => {
      const result = await removeProjectDocument(projectId, document.id)
      if (!result.success) {
        setError(result.error)
        return
      }
      toast.success("Document removed from Compass. The Drive file was not changed.")
      setRemoveOpen(false)
      router.refresh()
    })
  }

  return (
    <>
      <Dialog open={editOpen} onOpenChange={changeEditOpen}>
        <DialogTrigger asChild>
          <Button type="button" size="sm" variant="ghost">
            <IconEdit className="size-4" />
            Edit information
          </Button>
        </DialogTrigger>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-xl">
          <form onSubmit={save}>
            <DialogHeader>
              <DialogTitle>Edit document information</DialogTitle>
              <DialogDescription>
                Update how this file appears in Compass. The source Drive file and
                historical estimate or contract basis snapshots are not changed.
              </DialogDescription>
            </DialogHeader>
            <div className="mt-5 grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor={`document-category-${document.id}`}>Type</Label>
                <Select value={category} onValueChange={setCategory}>
                  <SelectTrigger id={`document-category-${document.id}`}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {PROJECT_DOCUMENT_CATEGORIES.map((option) => (
                      <SelectItem key={option.value} value={option.value}>
                        {option.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor={`document-title-${document.id}`}>Display title</Label>
                <Input
                  id={`document-title-${document.id}`}
                  name="title"
                  defaultValue={document.title}
                  required
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor={`document-date-${document.id}`}>Document date</Label>
                <Input
                  id={`document-date-${document.id}`}
                  name="documentDate"
                  type="date"
                  defaultValue={document.documentDate ?? ""}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor={`document-revision-${document.id}`}>Revision</Label>
                <Input
                  id={`document-revision-${document.id}`}
                  name="revision"
                  defaultValue={document.revision ?? ""}
                  placeholder="Example: Rev 4"
                />
              </div>
              <div className="space-y-1.5 sm:col-span-2">
                <Label htmlFor={`document-description-${document.id}`}>
                  Description or issue note
                </Label>
                <Textarea
                  id={`document-description-${document.id}`}
                  name="description"
                  rows={3}
                  defaultValue={document.description ?? ""}
                />
              </div>
            </div>
            {error && <p className="mt-3 text-sm text-destructive">{error}</p>}
            <DialogFooter className="mt-5">
              <Button
                type="button"
                variant="outline"
                onClick={() => setEditOpen(false)}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={isPending}>
                {isPending ? "Saving..." : "Save changes"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <AlertDialog open={removeOpen} onOpenChange={changeRemoveOpen}>
        <AlertDialogTrigger asChild>
          <Button type="button" size="sm" variant="ghost" className="text-destructive">
            <IconTrash className="size-4" />
            Remove from Compass
          </Button>
        </AlertDialogTrigger>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove “{document.title}” from Compass?</AlertDialogTitle>
            <AlertDialogDescription>
              {isReferenced
                ? "This document is part of an estimate or contract basis. Remove those references before removing its Compass record."
                : "This removes the publication from internal, owner, and subcontractor document lists. The source file stays in Google Drive."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          {error && <p className="text-sm text-destructive">{error}</p>}
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isPending}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              disabled={isPending || isReferenced}
              onClick={remove}
            >
              {isPending ? "Removing..." : "Remove from Compass"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}
