"use client"

import * as React from "react"

import { listDrivePickerFolder, searchDrivePicker } from "@/app/actions/drive-picker"
import { listProjectFilesForPicker } from "@/app/actions/project-documents"
import { useActiveProject, useProjectList } from "@/components/project-list-provider"
import { SearchableCombobox } from "@/components/searchable-combobox"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { DRIVE_FOLDER_MIME_TYPE, driveItemUrl, type DrivePickerDestination, type DrivePickerItem } from "@/lib/google/drive-picker"

import { DriveBrowseList, type DriveBrowseCrumb, type DriveBrowseLoadResult } from "./drive-browse-list"
import { DriveUploadPanel } from "./drive-upload-panel"

/** What the field accepts: files, folders, or either. */
export type DriveBrowseChoice = "file" | "folder" | "any"

type Source = "drive" | "projects" | "computer"

const MY_DRIVE = "__my"
const SHARED_WITH_ME = "__shared"

const DRIVE_ROOTS: readonly DrivePickerItem[] = [
  { id: MY_DRIVE, name: "My Drive", kind: "folder", mimeType: DRIVE_FOLDER_MIME_TYPE, modifiedAt: null, url: "" },
  { id: SHARED_WITH_ME, name: "Shared with me", kind: "folder", mimeType: DRIVE_FOLDER_MIME_TYPE, modifiedAt: null, url: "" },
]

function loadDrive(crumb: DriveBrowseCrumb): Promise<DriveBrowseLoadResult> {
  if (crumb.id === null) return Promise.resolve({ success: true, data: DRIVE_ROOTS })
  if (crumb.id === MY_DRIVE) return listDrivePickerFolder({ kind: "my" })
  if (crumb.id === SHARED_WITH_ME) return listDrivePickerFolder({ kind: "shared" })
  return listDrivePickerFolder({ kind: "folder", id: crumb.id })
}

/**
 * The one way Compass adds a Drive file or folder: browse Google Drive, open a
 * Compass project's files, or upload from this computer. Compass keeps a link;
 * the file stays in Drive.
 */
export function DriveBrowseDialog({
  open,
  onOpenChange,
  onPick,
  choose = "file",
  multiple = false,
  title,
  description,
  projectId = null,
  uploadDestination,
  alreadyChosenIds,
}: {
  readonly open: boolean
  readonly onOpenChange: (open: boolean) => void
  readonly onPick: (items: readonly DrivePickerItem[]) => void
  readonly choose?: DriveBrowseChoice
  readonly multiple?: boolean
  readonly title: string
  readonly description?: string
  /** Opens the project tab on this job and uploads into its folder. */
  readonly projectId?: string | null
  /** Where computer uploads go when there's no project; My Drive otherwise. */
  readonly uploadDestination?: DrivePickerDestination
  readonly alreadyChosenIds?: readonly string[]
}): React.ReactElement {
  const projects = useProjectList()
  const { activeProjectId } = useActiveProject()
  const [source, setSource] = React.useState<Source>(projectId ? "projects" : "drive")
  const [chosenProjectId, setChosenProjectId] = React.useState<string>(projectId ?? activeProjectId ?? "")
  const [chosen, setChosen] = React.useState<ReadonlyMap<string, DrivePickerItem>>(new Map())
  const [openFolder, setOpenFolder] = React.useState<DriveBrowseCrumb | null>(null)

  const linkedProjects = projects.filter((project) => project.googleDriveFolderId)
  const chosenProject = linkedProjects.find((project) => project.id === chosenProjectId) ?? null
  const projectLabel = (project: { readonly name: string; readonly projectNumber: string | null }): string =>
    project.projectNumber ? `${project.projectNumber} · ${project.name}` : project.name

  const defaultUpload: DrivePickerDestination =
    uploadDestination ??
    (projectId && chosenProject && chosenProject.id === projectId
      ? { kind: "project", projectId, name: `${projectLabel(chosenProject)} project folder` }
      : { kind: "my" })

  function reset(): void {
    setChosen(new Map())
    setSource(projectId ? "projects" : "drive")
    setChosenProjectId(projectId ?? activeProjectId ?? "")
  }

  function close(): void {
    reset()
    onOpenChange(false)
  }

  function finish(items: readonly DrivePickerItem[]): void {
    if (items.length === 0) return
    onPick(items)
    close()
  }

  function canChoose(item: DrivePickerItem): boolean {
    if (item.id === MY_DRIVE || item.id === SHARED_WITH_ME) return false
    return choose === "any" || item.kind === choose
  }

  function toggle(item: DrivePickerItem, on: boolean): void {
    setChosen((current) => {
      const next = new Map(multiple ? current : [])
      if (on) next.set(item.id, item)
      else next.delete(item.id)
      return next
    })
  }

  const loadProject = React.useCallback(
    async (crumb: DriveBrowseCrumb): Promise<DriveBrowseLoadResult> => {
      if (!chosenProjectId) return { success: true, data: [] }
      const result = await listProjectFilesForPicker(chosenProjectId, crumb.id)
      if (!result.success) return result
      return {
        success: true,
        data: result.files.map((file) => ({
          id: file.id,
          name: file.name,
          kind: file.kind,
          mimeType: file.mimeType,
          modifiedAt: file.modifiedAt,
          url: file.webViewLink ?? driveItemUrl(file.id, file.kind),
        })),
      }
    },
    [chosenProjectId],
  )

  // In folder mode the open folder itself can be the answer.
  const canUseOpenFolder =
    choose !== "file" && openFolder?.id && openFolder.id !== MY_DRIVE && openFolder.id !== SHARED_WITH_ME && source !== "computer"
  const noun = choose === "folder" ? "folder" : "file"

  return (
    <Dialog open={open} onOpenChange={(next) => (next ? onOpenChange(true) : close())}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>
            {description ?? "Find it in Google Drive or a Compass project, or upload it from this computer. Compass links to the file in Drive; nothing is copied."}
          </DialogDescription>
        </DialogHeader>
        <Tabs value={source} onValueChange={(value) => setSource(value === "projects" || value === "computer" ? value : "drive")}>
          <TabsList>
            <TabsTrigger value="drive">Google Drive</TabsTrigger>
            <TabsTrigger value="projects">Compass projects</TabsTrigger>
            {choose !== "folder" && <TabsTrigger value="computer">This computer</TabsTrigger>}
          </TabsList>
          <TabsContent value="drive" className="pt-2">
            <DriveBrowseList
              rootCrumbs={[{ id: null, name: "Drive" }]}
              load={loadDrive}
              search={searchDrivePicker}
              canChoose={canChoose}
              chosen={chosen}
              onToggle={toggle}
              onFolderChange={setOpenFolder}
              alreadyChosenIds={alreadyChosenIds}
            />
          </TabsContent>
          <TabsContent value="projects" className="grid gap-2 pt-2">
            <SearchableCombobox
              ariaLabel="Project"
              placeholder="Choose a project"
              searchPlaceholder="Search projects"
              emptyMessage="No project with a Drive folder matches."
              options={linkedProjects.map((project) => ({
                value: project.id,
                label: projectLabel(project),
                keywords: `${project.clientName ?? ""} ${project.projectNumber ?? ""}`,
              }))}
              value={chosenProjectId}
              onValueChange={setChosenProjectId}
            />
            {chosenProject ? (
              <DriveBrowseList
                rootCrumbs={[{ id: null, name: "Project files" }]}
                load={loadProject}
                canChoose={canChoose}
                chosen={chosen}
                onToggle={toggle}
                onFolderChange={setOpenFolder}
                alreadyChosenIds={alreadyChosenIds}
                key={chosenProject.id}
              />
            ) : (
              <p className="text-sm text-muted-foreground">Choose a project to open its files.</p>
            )}
          </TabsContent>
          {choose !== "folder" && (
            <TabsContent value="computer" className="pt-2">
              <DriveUploadPanel key={`${defaultUpload.kind}-${projectId ?? ""}`} defaultDestination={defaultUpload} onUploaded={(item) => finish([item])} />
            </TabsContent>
          )}
        </Tabs>
        {source !== "computer" && (
          <DialogFooter className="items-center gap-2 sm:justify-between">
            <span className="text-xs text-muted-foreground">
              {chosen.size === 0 ? "Nothing chosen yet" : multiple ? `${chosen.size} chosen` : [...chosen.values()][0]?.name}
            </span>
            <div className="flex flex-wrap gap-2">
              <Button type="button" variant="ghost" onClick={close}>Cancel</Button>
              {canUseOpenFolder && chosen.size === 0 && openFolder?.id && (
                <Button
                  type="button"
                  variant="outline"
                  onClick={() =>
                    finish([{ id: openFolder.id ?? "", name: openFolder.name, kind: "folder", mimeType: DRIVE_FOLDER_MIME_TYPE, modifiedAt: null, url: driveItemUrl(openFolder.id ?? "", "folder") }])
                  }
                >
                  Use this folder
                </Button>
              )}
              <Button type="button" disabled={chosen.size === 0} onClick={() => finish([...chosen.values()])}>
                {multiple && chosen.size > 1 ? `Use ${chosen.size} ${noun}s` : `Use ${noun}`}
              </Button>
            </div>
          </DialogFooter>
        )}
      </DialogContent>
    </Dialog>
  )
}
