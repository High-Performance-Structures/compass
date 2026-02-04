import { BaseMapper } from "./base-mapper"
import type { Project } from "@/db/schema"
import type { NetSuiteJob } from "../client/types"

export class ProjectMapper extends BaseMapper<Project, NetSuiteJob> {
  toRemote(local: Project): Partial<NetSuiteJob> {
    return {
      companyName: local.name,
    }
  }

  toLocal(remote: NetSuiteJob): Partial<Project> {
    return {
      name: remote.companyName,
      netsuiteJobId: remote.id,
      status: mapJobStatus(remote.jobStatus?.refName),
    }
  }

  getNetSuiteRecordType(): string {
    return "job"
  }

  getLocalTable(): string {
    return "projects"
  }

  getSuiteQLFields(): string[] {
    return [
      "id",
      "entityid",
      "companyname",
      "jobstatus",
      "startdate",
      "projectedenddate",
      "datecreated",
      "lastmodifieddate",
    ]
  }
}

function mapJobStatus(nsStatus?: string): string {
  if (!nsStatus) return "OPEN"

  const normalized = nsStatus.toLowerCase()
  if (normalized.includes("closed") || normalized.includes("complete")) {
    return "CLOSED"
  }
  if (normalized.includes("progress") || normalized.includes("active")) {
    return "IN_PROGRESS"
  }
  return "OPEN"
}
