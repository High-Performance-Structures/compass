"use client"

import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible"
import { SearchableCombobox } from "@/components/searchable-combobox"
import {
  IconChevronDown,
  IconChevronRight,
  IconLoader2,
  IconTemplate
} from "@tabler/icons-react"
import type { TemplateImportState } from "./use-template-import"

/** Picks one schedule item, and optional to-dos, from a published template. */
export function TemplateImportSection({
  template,
  onBulkTemplateImport,
}: {
  readonly template: TemplateImportState
  readonly onBulkTemplateImport?: () => void
}) {
  const {
    templateGroups,
    templateLoading,
    templateLoadError,
    selectedTemplateId,
    selectedTemplateItemId,
    selectedTemplateTodoIds,
    templateTodosOpen,
    selectedTemplateGroup,
    setTemplateTodosOpen,
    setSelectedTemplateTodoIds,
    chooseTemplate,
    applyTemplateScheduleItem,
    toggleTemplateTodo,
    retryTemplateLoad,
  } = template
  return (
    <section className="border-y bg-muted/20 py-3">
      <div className="mb-2 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2 text-xs font-medium">
          <IconTemplate className="size-4" />
          Import from a published template
        </div>
        {onBulkTemplateImport && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-7 px-2 text-xs"
            onClick={onBulkTemplateImport}
          >
            Import several
          </Button>
        )}
      </div>
      {templateLoading ? (
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <IconLoader2 className="size-3.5 animate-spin" />
          Loading template schedule items…
        </div>
      ) : templateLoadError ? (
        <div className="flex items-center justify-between gap-3 text-xs text-muted-foreground">
          <span>Compass could not load the published templates.</span>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-7 px-2 text-xs"
            onClick={retryTemplateLoad}
          >
            Retry
          </Button>
        </div>
      ) : templateGroups?.length === 0 ? (
        <p className="text-xs text-muted-foreground">
          No published templates contain reusable schedule items.
        </p>
      ) : (
        <div className="grid gap-2 sm:grid-cols-2">
          <SearchableCombobox
            value={selectedTemplateId}
            // Ignore the picker's reset while templates reload so
            // a typed title and dates are never cleared.
            onValueChange={(templateId) => {
              if (templateId !== "") chooseTemplate(templateId)
            }}
            options={(templateGroups ?? []).map((group) => ({
              value: group.templateId,
              label: group.templateName,
              description: `${group.scheduleItems.length} schedule items`,
            }))}
            ariaLabel="Choose schedule template"
            placeholder="Choose template"
            searchPlaceholder="Search templates..."
            emptyMessage="No matching templates."
          />
          <SearchableCombobox
            value={selectedTemplateItemId}
            onValueChange={(templateItemId) => {
              if (templateItemId !== "") applyTemplateScheduleItem(templateItemId)
            }}
            disabled={!selectedTemplateGroup}
            options={(selectedTemplateGroup?.scheduleItems ?? []).map((item) => ({
              value: item.id,
              label: item.title,
            }))}
            ariaLabel="Choose template schedule item"
            placeholder="Choose schedule item"
            searchPlaceholder="Search schedule items..."
            emptyMessage="No matching schedule items."
          />
        </div>
      )}
      {selectedTemplateGroup && selectedTemplateItemId && (
        <div className="mt-3 border-t pt-3">
          {selectedTemplateGroup.linkedTodos.length > 0 ? (
            <Collapsible open={templateTodosOpen} onOpenChange={setTemplateTodosOpen}>
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="text-xs font-medium">Optional template to-dos</p>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    {selectedTemplateTodoIds.length} of{" "}
                    {selectedTemplateGroup.linkedTodos.length} selected · none are added
                    unless selected
                  </p>
                </div>
                <CollapsibleTrigger asChild>
                  <Button type="button" variant="outline" size="sm" className="h-8">
                    Choose to-dos
                    {templateTodosOpen ? (
                      <IconChevronDown className="ml-1 size-3.5" />
                    ) : (
                      <IconChevronRight className="ml-1 size-3.5" />
                    )}
                  </Button>
                </CollapsibleTrigger>
              </div>
              <CollapsibleContent className="mt-3 border-y">
                <div className="flex items-center justify-end gap-1 border-b py-1">
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="h-7 px-2 text-xs"
                    onClick={() =>
                      setSelectedTemplateTodoIds(
                        selectedTemplateGroup.linkedTodos.map((todo) => todo.id)
                      )
                    }
                  >
                    Select all
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="h-7 px-2 text-xs"
                    disabled={selectedTemplateTodoIds.length === 0}
                    onClick={() => setSelectedTemplateTodoIds([])}
                  >
                    Clear
                  </Button>
                </div>
                <div className="max-h-52 divide-y overflow-y-auto">
                  {selectedTemplateGroup.linkedTodos.map((todo) => (
                    <label
                      key={todo.id}
                      className="flex cursor-pointer items-start gap-3 py-2.5"
                    >
                      <Checkbox
                        checked={selectedTemplateTodoIds.includes(todo.id)}
                        onCheckedChange={(value) =>
                          toggleTemplateTodo(todo.id, value === true)
                        }
                        aria-label={`Include ${todo.title}`}
                      />
                      <span className="min-w-0 flex-1">
                        <span className="block text-xs font-medium">{todo.title}</span>
                        {todo.checklistItemCount > 0 && (
                          <span className="mt-0.5 block text-xs text-muted-foreground">
                            Includes {todo.checklistItemCount} checklist item
                            {todo.checklistItemCount === 1 ? "" : "s"}
                          </span>
                        )}
                      </span>
                    </label>
                  ))}
                </div>
              </CollapsibleContent>
            </Collapsible>
          ) : (
            <p className="text-xs text-muted-foreground">
              This template does not include any to-dos.
            </p>
          )}
        </div>
      )}
    </section>
  )
}
