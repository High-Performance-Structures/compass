import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { describe, expect, it } from "vitest"

import {
  buildBuildertrendInventoryManifest,
  type BuildertrendInventoryManifestOptions,
} from "../inventory-manifest"
import { buildBuildertrendStagingSql } from "../staging-manifest"

function fixture(name: string): unknown {
  return JSON.parse(
    readFileSync(
      resolve(process.cwd(), "scripts/fixtures", name),
      "utf8"
    )
  )
}

const baseOptions: BuildertrendInventoryManifestOptions = {
  kind: "jobs",
  runKey: "job-inventory-2026-07-30",
  sourceLabel: "Buildertrend job inventory",
  capturedAt: "2026-07-30T12:00:00.000Z",
}

function successfulBuild(
  input: unknown,
  options = baseOptions
) {
  const build = buildBuildertrendInventoryManifest(input, options)
  if (!build.success) throw new Error(build.errors.join("\n"))
  return build
}

describe("Buildertrend inventory manifests", () => {
  it("normalizes the visible job capture shape without operational writes", async () => {
    const build = successfulBuild(
      fixture("buildertrend-job-inventory-visible.json")
    )

    expect(build.summary).toEqual({
      kind: "jobs",
      recordCount: 1,
      accessCandidateCount: 1,
      missingProjectIdCount: 0,
    })
    expect(build.manifest.records[0]).toMatchObject({
      sourceKey: "job:1001",
      projectId: "project-example",
      buildertrendJobId: "1001",
      buildertrendRecordId: "1001",
      sourceRecordType: "job",
      title: "O-100-1001 Example Residence",
    })
    expect(build.manifest.accessCandidates[0]).toMatchObject({
      sourceKey: "access:job:1001:501",
      sourceRecordKey: "job:1001",
      projectId: "project-example",
      buildertrendContactId: "501",
    })

    const sql = await buildBuildertrendStagingSql(
      "organization-example",
      build.manifest
    )
    expect(sql.sql).toContain("buildertrend_staging_records")
    const writtenTables = new Set(
      [
        ...sql.sql.matchAll(
          /^\s*(?:INSERT(?:\s+OR\s+\w+)?\s+INTO|UPDATE|DELETE\s+FROM|REPLACE\s+INTO)\s+([a-z_]+)/gim
        ),
      ].flatMap((match) => (match[1] ? [match[1].toLowerCase()] : []))
    )
    expect(writtenTables).toEqual(
      new Set([
        "buildertrend_staging_runs",
        "buildertrend_staging_records",
        "buildertrend_staging_files",
        "buildertrend_staging_access_candidates",
        "buildertrend_staging_observations",
      ])
    )
    expect(sql.sql).not.toContain("pending_sage")
    expect(sql.sql).not.toContain("queued_sage")
    expect(sql.sql).toContain("'not_granted'")
  })

  it("normalizes the all-status job capture shape without inferring a project", () => {
    const build = successfulBuild(
      fixture("buildertrend-job-inventory-all-status.json")
    )

    expect(build.summary.missingProjectIdCount).toBe(1)
    expect(build.manifest.records[0]).toMatchObject({
      sourceKey: "job:1002",
      projectId: undefined,
      buildertrendJobId: "1002",
      title: "N-100-1002 Example Service Project",
      clientName: "First Owner & Second Owner",
      contactEmail: "owner@example.test",
    })
    expect(build.manifest.accessCandidates[0]).toMatchObject({
      sourceKey: "access:job:1002:502",
      contactName: "First Owner & Second Owner",
    })
    expect(build.manifest.accessCandidates[0]?.notes).toContain(
      "split and verify identity"
    )
  })

  it("normalizes lead opportunities as archive-only review inputs", () => {
    const build = successfulBuild(
      fixture("buildertrend-lead-opportunities.json"),
      {
        ...baseOptions,
        kind: "lead_opportunities",
        runKey: "lead-inventory-2026-07-30",
        sourceLabel: "Buildertrend lead opportunity inventory",
      }
    )

    expect(build.summary).toEqual({
      kind: "lead_opportunities",
      recordCount: 1,
      accessCandidateCount: 1,
      missingProjectIdCount: 1,
    })
    expect(build.manifest.records[0]).toMatchObject({
      sourceKey: "lead:2001",
      buildertrendLeadId: "2001",
      sourceRecordType: "lead_opportunity",
      title: "D-100-2001 Example Design Lead",
    })
    expect(build.manifest.accessCandidates[0]).toMatchObject({
      sourceKey: "access:lead:2001:601",
      sourceRecordKey: "lead:2001",
      buildertrendAccessRole: "lead_contact",
      contactName: "Example Lead",
    })
  })

  it("keeps reused project numbers distinct by Buildertrend job ID", () => {
    const build = successfulBuild({
      rows: [
        {
          buildertrendJobId: "1003",
          name: "O-100 Shared Number",
        },
        {
          buildertrendJobId: "1004",
          name: "O-100 Shared Number",
        },
      ],
    })

    expect(build.manifest.records.map((record) => record.sourceKey)).toEqual([
      "job:1003",
      "job:1004",
    ])
    expect(build.summary.missingProjectIdCount).toBe(2)
  })

  it("rejects duplicate or missing source identities instead of filtering rows", () => {
    const duplicate = buildBuildertrendInventoryManifest(
      {
        rows: [
          { buildertrendJobId: "1005", name: "Example One" },
          { buildertrendJobId: "1005", name: "Example Two" },
        ],
      },
      baseOptions
    )
    expect(duplicate).toEqual({
      success: false,
      errors: ['records contains duplicate sourceKey "job:1005"'],
    })

    const missing = buildBuildertrendInventoryManifest(
      { rows: [{ name: "Missing ID" }] },
      baseOptions
    )
    expect(missing).toEqual({
      success: false,
      errors: [
        "rows.0: job inventory rows require a Buildertrend job ID and title",
      ],
    })
  })

  it("rejects untrusted links and invalid capture timestamps", () => {
    const untrusted = buildBuildertrendInventoryManifest(
      {
        rows: [
          {
            buildertrendJobId: "1006",
            name: "Untrusted Link",
            href: "https://example.test/app/JobPage/1006/1",
          },
        ],
      },
      baseOptions
    )
    expect(untrusted).toEqual({
      success: false,
      errors: ["rows.0: Buildertrend job URL is not trusted"],
    })

    const invalidTime = buildBuildertrendInventoryManifest(
      {
        rows: [{ buildertrendJobId: "1006", name: "Invalid Time" }],
      },
      { ...baseOptions, capturedAt: "today" }
    )
    expect(invalidTime).toMatchObject({ success: false })
    if (invalidTime.success) throw new Error("Expected an invalid manifest")
    expect(invalidTime.errors[0]).toContain("capturedAt")
  })

  it("rejects empty, failed, and incomplete capture envelopes by default", () => {
    expect(
      buildBuildertrendInventoryManifest({ rows: [] }, baseOptions)
    ).toEqual({
      success: false,
      errors: [
        "snapshot.rows: empty captures require an explicit allowEmpty decision",
      ],
    })
    expect(
      buildBuildertrendInventoryManifest(
        { rows: [], error: "authentication failed" },
        { ...baseOptions, allowEmpty: true }
      )
    ).toEqual({
      success: false,
      errors: ["snapshot: capture reported an error or unsuccessful status"],
    })
    expect(
      buildBuildertrendInventoryManifest(
        {
          rows: [{ buildertrendJobId: "1007", name: "Captured Row" }],
        },
        { ...baseOptions, expectedRowCount: 2 }
      )
    ).toEqual({
      success: false,
      errors: ["snapshot.rows: expected 2 rows but captured 1"],
    })

    const approvedEmpty = buildBuildertrendInventoryManifest(
      { rows: [], success: true },
      { ...baseOptions, allowEmpty: true, expectedRowCount: 0 }
    )
    expect(approvedEmpty).toMatchObject({
      success: true,
      summary: { recordCount: 0 },
    })
  })

  it("cross-validates job, lead, and contact identities against links", () => {
    const jobMismatch = buildBuildertrendInventoryManifest(
      {
        rows: [
          {
            buildertrendJobId: "1008",
            name: "Mismatched Job",
            href: "/app/JobPage/9999/1",
          },
        ],
      },
      baseOptions
    )
    expect(jobMismatch).toEqual({
      success: false,
      errors: [
        "rows.0: Buildertrend job ID does not match its job link",
      ],
    })

    const leadMismatch = buildBuildertrendInventoryManifest(
      {
        rows: [
          {
            buildertrendLeadId: "2002",
            title: "Mismatched Lead",
            href: "/app/leads/opportunities/Lead/9999",
          },
        ],
      },
      { ...baseOptions, kind: "lead_opportunities" }
    )
    expect(leadMismatch).toEqual({
      success: false,
      errors: [
        "rows.0: Buildertrend lead ID does not match its lead link",
      ],
    })

    const contactMismatch = buildBuildertrendInventoryManifest(
      {
        rows: [
          {
            buildertrendJobId: "1008",
            name: "Mismatched Contact",
            contacts: [
              {
                buildertrendContactId: "700",
                text: "Example Contact",
                href: "/app/Contact/701",
              },
            ],
          },
        ],
      },
      baseOptions
    )
    expect(contactMismatch).toEqual({
      success: false,
      errors: [
        "rows.0.contacts.0: Buildertrend contact ID does not match its contact link",
      ],
    })
  })

  it("produces byte-stable manifests for exact replay", () => {
    const snapshot = fixture("buildertrend-job-inventory-visible.json")
    const first = successfulBuild(snapshot)
    const second = successfulBuild(snapshot)

    expect(JSON.stringify(first.manifest)).toBe(JSON.stringify(second.manifest))
  })

  it("canonicalizes captured row order before producing a manifest", () => {
    const rows = [
      { buildertrendJobId: "1010", name: "Example Alpha" },
      { buildertrendJobId: "1009", name: "Example Beta" },
    ]
    const first = successfulBuild({ rows })
    const second = successfulBuild({ rows: [...rows].reverse() })

    expect(JSON.stringify(first.manifest)).toBe(JSON.stringify(second.manifest))
  })
})
