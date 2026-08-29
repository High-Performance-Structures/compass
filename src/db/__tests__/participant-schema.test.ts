import { readFile } from "node:fs/promises"
import { resolve } from "node:path"
import { describe, expect, it } from "vitest"
import {
  projectSourceRecordParticipants,
  scheduleTaskAssignees,
} from "@/db/schema-participants"

describe("normalized participant schema", () => {
  it("keys participants by tenant, project, source record, and source identity", () => {
    expect(projectSourceRecordParticipants.sourceParticipantId.name).toBe(
      "source_participant_id",
    )
    expect(projectSourceRecordParticipants.sourceRecordType.name).toBe(
      "source_record_type",
    )
    expect(projectSourceRecordParticipants.sourceRecordId.name).toBe(
      "source_record_id",
    )
    expect(projectSourceRecordParticipants.capabilitiesJson.name).toBe(
      "capabilities_json",
    )
  })

  it("keeps multiple assignees in a child relation and leaves legacy assigned_to intact", async () => {
    expect(scheduleTaskAssignees.scheduleTaskId.name).toBe("schedule_task_id")
    expect(scheduleTaskAssignees.participantId.name).toBe("participant_id")
    expect(scheduleTaskAssignees.participantRole.name).toBe("participant_role")
    expect(scheduleTaskAssignees.sourceStartDate.name).toBe("source_start_date")
    expect(scheduleTaskAssignees.sourceWorkdays.name).toBe("source_workdays")
    expect(scheduleTaskAssignees.sourceEndDate.name).toBe("source_end_date")
    expect(scheduleTaskAssignees.responseStatus.name).toBe("response_status")
    expect(scheduleTaskAssignees.dateResponseStatus.name).toBe(
      "date_response_status",
    )
    expect(scheduleTaskAssignees.durationResponseStatus.name).toBe(
      "duration_response_status",
    )
    expect(scheduleTaskAssignees.proposedStartDate.name).toBe(
      "proposed_start_date",
    )
    expect(scheduleTaskAssignees.proposedWorkdays.name).toBe("proposed_workdays")
    expect(scheduleTaskAssignees.proposedEndDate.name).toBe("proposed_end_date")
    expect(scheduleTaskAssignees.responseMessage.name).toBe("response_message")
    expect(scheduleTaskAssignees.respondedAt.name).toBe("responded_at")
    expect(scheduleTaskAssignees.respondedByUserId.name).toBe(
      "responded_by_user_id",
    )
    expect(scheduleTaskAssignees.responseSource.name).toBe("response_source")

    const migration = await readFile(
      resolve(process.cwd(), "drizzle/0140_project_source_record_participants.sql"),
      "utf8",
    )
    expect(migration).toContain("CREATE TABLE `schedule_task_assignees`")
    expect(migration).toContain("`schedule_task_id` text NOT NULL")
    expect(migration).toContain("`participant_id` text NOT NULL")
    expect(migration).not.toContain("ALTER TABLE `schedule_tasks`")
    expect(migration).not.toContain("DROP COLUMN `assigned_to`")
  })
})
