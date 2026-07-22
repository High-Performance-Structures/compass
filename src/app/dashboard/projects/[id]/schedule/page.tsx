export const dynamic = "force-dynamic";

import { getCloudflareContext } from "@/lib/db";
import { getDb } from "@/db";
import { projects } from "@/db/schema";
import { eq } from "drizzle-orm";
import { notFound } from "next/navigation";
import {
  getProjectScheduleArchive,
  getScheduleProjectOptions,
  getSchedule,
  type ProjectScheduleArchiveItem,
  type ScheduleProjectOption,
} from "@/app/actions/schedule";
import { getBaselines } from "@/app/actions/baselines";
import {
  getProjectTaskAssigneeOptions,
  type ProjectTaskAssigneeOption,
} from "@/app/actions/project-contacts";
import {
  getScheduleAssigneeOptions,
  type ScheduleAssigneeOption,
} from "@/app/actions/schedule-assignees";
import { ScheduleView } from "@/components/schedule/schedule-view";
import type { ScheduleData, ScheduleBaselineData } from "@/lib/schedule/types";
import { IconArchive, IconExternalLink } from "@tabler/icons-react";

const emptySchedule: ScheduleData = {
  tasks: [],
  dependencies: [],
  exceptions: [],
};

export default async function SchedulePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ task?: string }>;
}) {
  const { id } = await params;
  const { task: linkedScheduleTaskId } = await searchParams;

  let projectName = "Project";
  let schedule: ScheduleData = emptySchedule;
  let baselines: ScheduleBaselineData[] = [];
  let allProjects: readonly ScheduleProjectOption[] = [];
  let archivedSchedule: readonly ProjectScheduleArchiveItem[] = [];
  let taskAssigneeOptions: readonly ProjectTaskAssigneeOption[] = [];
  let scheduleAssigneeOptions: readonly ScheduleAssigneeOption[] = [];

  try {
    const { env } = await getCloudflareContext();
    if (!env?.DB) throw new Error("D1 not available");

    const db = getDb(env.DB);
    const [project] = await db
      .select()
      .from(projects)
      .where(eq(projects.id, id))
      .limit(1);

    if (!project) notFound();

    projectName = project.projectNumber ?? project.name;
    const [
      scheduleResult,
      baselineResult,
      projectResult,
      archiveResult,
      assigneeResult,
      scheduleAssigneeResult,
    ] = await Promise.allSettled([
      getSchedule(id),
      getBaselines(id),
      getScheduleProjectOptions(),
      getProjectScheduleArchive(id),
      getProjectTaskAssigneeOptions(id),
      getScheduleAssigneeOptions(id),
    ]);

    if (scheduleResult.status === "fulfilled") {
      schedule = scheduleResult.value;
    } else {
      console.error("Failed to load project schedule", scheduleResult.reason);
    }
    if (baselineResult.status === "fulfilled") {
      baselines = baselineResult.value;
    } else {
      console.error("Failed to load schedule baselines", baselineResult.reason);
    }
    if (projectResult.status === "fulfilled") {
      allProjects = projectResult.value;
    } else {
      console.error("Failed to load schedule project options", projectResult.reason);
    }
    if (archiveResult.status === "fulfilled") {
      archivedSchedule = archiveResult.value;
    } else {
      console.error("Failed to load schedule archive", archiveResult.reason);
    }
    if (assigneeResult.status === "fulfilled") {
      taskAssigneeOptions = [
        ...assigneeResult.value.projectContacts,
        ...assigneeResult.value.directoryContacts,
      ];
    } else {
      console.error("Failed to load schedule assignees", assigneeResult.reason);
    }
    if (scheduleAssigneeResult.status === "fulfilled") {
      scheduleAssigneeOptions = scheduleAssigneeResult.value;
    } else {
      console.error(
        "Failed to load the schedule contact directory",
        scheduleAssigneeResult.reason,
      );
    }
  } catch (e: unknown) {
    if (
      e &&
      typeof e === "object" &&
      "digest" in e &&
      e.digest === "NEXT_NOT_FOUND"
    )
      throw e;
    console.error("Failed to initialize project schedule page", e);
  }

  return (
    <div className="px-4 py-2 flex flex-col flex-1 min-h-0">
      {archivedSchedule.length > 0 && (
        <details className="mb-2 shrink-0 border bg-background px-3 py-2 text-sm">
          <summary className="flex cursor-pointer list-none items-center gap-2 font-medium">
            <IconArchive className="size-4 text-muted-foreground" />
            Buildertrend schedule archive ({archivedSchedule.length})
            <span className="ml-auto text-xs font-normal text-muted-foreground">
              Read-only history
            </span>
          </summary>
          <div className="mt-3 max-h-48 overflow-y-auto border-t pt-2">
            {archivedSchedule.map((record) => (
              <div
                key={record.id}
                className="flex flex-wrap items-center justify-between gap-2 border-b py-2 last:border-b-0"
              >
                <div>
                  <p>{record.title}</p>
                  <p className="text-xs text-muted-foreground">
                    {record.recordDate ?? "Date unavailable"} ·{" "}
                    {record.recordStatus ?? "historical"}
                  </p>
                </div>
                {record.buildertrendUrl && (
                  <a
                    href={record.buildertrendUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
                  >
                    Open source
                    <IconExternalLink className="size-3.5" />
                  </a>
                )}
              </div>
            ))}
          </div>
        </details>
      )}
      <ScheduleView
        projectId={id}
        projectName={projectName}
        initialData={schedule}
        baselines={baselines}
        allProjects={allProjects}
        taskAssigneeOptions={taskAssigneeOptions}
        scheduleAssigneeOptions={scheduleAssigneeOptions}
        linkedScheduleTaskId={linkedScheduleTaskId ?? null}
      />
    </div>
  );
}
