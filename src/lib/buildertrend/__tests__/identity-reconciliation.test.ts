import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { describe, expect, it } from "vitest"

import {
  buildBuildertrendIdentityReviewSql,
  parseBuildertrendIdentityReviewManifest,
  type BuildertrendIdentityReviewManifest,
} from "../identity-reconciliation"

const stagingMigration = readFileSync(
  resolve(process.cwd(), "drizzle/0084_buildertrend_staging_foundation.sql"),
  "utf8"
).replaceAll("--> statement-breakpoint", "")
const identityMigration = readFileSync(
  resolve(
    process.cwd(),
    "drizzle/0085_buildertrend_identity_reconciliation.sql"
  ),
  "utf8"
).replaceAll("--> statement-breakpoint", "")

type TestStatement = {
  readonly all: () => readonly unknown[]
  readonly get: () => unknown
  readonly run: () => unknown
}

type TestDatabase = {
  readonly exec: (sql: string) => unknown
  readonly prepare: (sql: string) => TestStatement
  readonly close: () => void
}

type TestDatabaseModule = {
  readonly Database: new (filename: string) => TestDatabase
}

function isTestDatabaseModule(value: unknown): value is TestDatabaseModule {
  return (
    value !== null &&
    typeof value === "object" &&
    "Database" in value &&
    typeof value.Database === "function"
  )
}

async function openDatabase(): Promise<TestDatabase> {
  if ("Bun" in globalThis) {
    const bunSqliteSpecifier = "bun:sqlite"
    const sqliteModule: unknown = await import(bunSqliteSpecifier)
    if (!isTestDatabaseModule(sqliteModule)) {
      throw new Error("bun:sqlite did not provide a Database constructor")
    }
    return new sqliteModule.Database(":memory:")
  }

  const { default: Database } = await import("better-sqlite3")
  const database = new Database(":memory:")
  return {
    exec: (sql) => database.exec(sql),
    prepare: (sql) => {
      const statement = database.prepare(sql)
      return {
        all: () => statement.all(),
        get: () => statement.get(),
        run: () => statement.run(),
      }
    },
    close: () => database.close(),
  }
}

async function createDatabase(): Promise<TestDatabase> {
  const database = await openDatabase()
  database.exec(`
    PRAGMA foreign_keys = ON;
    CREATE TABLE organizations (
      id TEXT PRIMARY KEY NOT NULL
    );
    CREATE TABLE users (
      id TEXT PRIMARY KEY NOT NULL,
      organization_id TEXT,
      FOREIGN KEY (organization_id) REFERENCES organizations(id)
    );
    CREATE TABLE projects (
      id TEXT PRIMARY KEY NOT NULL,
      organization_id TEXT,
      project_number TEXT,
      FOREIGN KEY (organization_id) REFERENCES organizations(id)
    );
    CREATE TABLE customers (
      id TEXT PRIMARY KEY NOT NULL,
      organization_id TEXT,
      name TEXT,
      FOREIGN KEY (organization_id) REFERENCES organizations(id)
    );
    CREATE TABLE vendors (
      id TEXT PRIMARY KEY NOT NULL,
      organization_id TEXT,
      name TEXT,
      FOREIGN KEY (organization_id) REFERENCES organizations(id)
    );
  `)
  database.exec(stagingMigration)
  database.exec(identityMigration)
  database.exec(`
    INSERT INTO organizations (id) VALUES ('org-a'), ('org-b');
    INSERT INTO users (id, organization_id)
    VALUES ('reviewer-a', 'org-a'), ('reviewer-b', 'org-b');
    INSERT INTO projects (id, organization_id, project_number)
    VALUES
      ('project-a', 'org-a', 'O-100'),
      ('project-a-continuation', 'org-a', 'O-100'),
      ('project-b', 'org-b', 'O-100');
    INSERT INTO customers (id, organization_id, name)
    VALUES
      ('pooled-a', 'org-a', 'Pooled accounting customer'),
      ('pooled-b', 'org-b', 'Other organization customer');
    INSERT INTO buildertrend_staging_records (
      id, organization_id, source_key, source_scope, source_record_type,
      buildertrend_job_id, buildertrend_record_id, buildertrend_record_number,
      title, source_status, department_code, review_status, promotion_status,
      sage_reconciliation_status, created_at, updated_at
    ) VALUES
      (
        'source-job-1001', 'org-a', 'job:1001', 'job', 'job_inventory',
        '1001', '1001', 'O-100', 'O-100 First phase', 'Active', 'O',
        'needs_review', 'archive_only', 'not_reviewed',
        '2026-07-31T05:30:00.000Z', '2026-07-31T05:30:00.000Z'
      ),
      (
        'source-job-1002', 'org-a', 'job:1002', 'job', 'job_inventory',
        '1002', '1002', 'O-100', 'O-100 Continuation', 'Warranty', 'O',
        'needs_review', 'archive_only', 'not_reviewed',
        '2026-07-31T05:30:00.000Z', '2026-07-31T05:30:00.000Z'
      );
    INSERT INTO buildertrend_staging_records (
      id, organization_id, source_key, source_scope, source_record_type,
      buildertrend_lead_id, buildertrend_record_id, title, source_status,
      department_code, review_status, promotion_status,
      sage_reconciliation_status, created_at, updated_at
    ) VALUES (
      'source-lead-2001', 'org-a', 'lead:2001', 'lead',
      'lead_opportunity', '2001', '2001', 'D-100 Design lead',
      'Preconstruction', 'D', 'needs_review', 'archive_only',
      'not_reviewed', '2026-07-31T05:30:00.000Z',
      '2026-07-31T05:30:00.000Z'
    );
  `)
  return database
}

function manifest(
  overrides?: Partial<BuildertrendIdentityReviewManifest>
): BuildertrendIdentityReviewManifest {
  return {
    reviewKey: "identity-review-2026-07-31",
    reviewedAt: "2026-07-31T05:30:00.000Z",
    reviewedBy: "reviewer-a",
    decisions: [
      {
        sourceKey: "lead:2001",
        sourceIdentity: { kind: "lead", id: "2001" },
        lifecycleStatus: "preconstruction",
        disposition: "lead_only",
        departmentCode: "D",
        reviewStatus: "approved",
      },
      {
        sourceKey: "job:1001",
        sourceIdentity: { kind: "job", id: "1001" },
        lifecycleStatus: "active",
        disposition: "existing_project",
        departmentCode: "O",
        matchedProjectId: "project-a",
        customerProvenance: {
          customerId: "pooled-a",
          kind: "pooled_accounting",
        },
        reviewStatus: "approved",
      },
      {
        sourceKey: "job:1002",
        sourceIdentity: { kind: "job", id: "1002" },
        lifecycleStatus: "warranty",
        disposition: "existing_project",
        departmentCode: "O",
        matchedProjectId: "project-a-continuation",
        reviewStatus: "approved",
      },
    ],
    relationships: [
      {
        fromSourceKey: "lead:2001",
        toSourceKey: "job:1001",
        type: "lead_conversion",
        reviewStatus: "approved",
      },
      {
        fromSourceKey: "lead:2001",
        toSourceKey: "job:1001",
        type: "department_transition",
        reviewStatus: "approved",
      },
      {
        fromSourceKey: "job:1001",
        toSourceKey: "job:1002",
        type: "continuation",
        reviewStatus: "approved",
      },
    ],
    ...overrides,
  }
}

function scalar(
  database: TestDatabase,
  sql: string
): string | number | null {
  const row: unknown = database.prepare(`SELECT (${sql}) AS value`).get()
  if (row === null || typeof row !== "object" || !("value" in row)) {
    return null
  }
  const value = row.value
  return typeof value === "string" || typeof value === "number"
    ? value
    : null
}

describe("Buildertrend identity reconciliation", () => {
  it("parses explicit identities and rejects inferred or inconsistent edges", () => {
    const parsed = parseBuildertrendIdentityReviewManifest(manifest())
    expect(parsed.success).toBe(true)

    const duplicateIdentity = parseBuildertrendIdentityReviewManifest(
      manifest({
        decisions: [
          ...manifest().decisions,
          {
            sourceKey: "job:duplicate-alias",
            sourceIdentity: { kind: "job", id: "1001" },
            lifecycleStatus: "active",
            disposition: "unmatched",
            reviewStatus: "needs_review",
          },
        ],
      })
    )
    expect(duplicateIdentity.success).toBe(false)
    if (!duplicateIdentity.success) {
      expect(duplicateIdentity.errors.join("\n")).toContain(
        "Duplicate Buildertrend source identity"
      )
    }

    const inferredConversion = parseBuildertrendIdentityReviewManifest(
      manifest({
        relationships: [
          {
            fromSourceKey: "job:1001",
            toSourceKey: "lead:2001",
            type: "lead_conversion",
            reviewStatus: "approved",
          },
        ],
      })
    )
    expect(inferredConversion.success).toBe(false)
  })

  it("records immutable reviewed identities without operational writes", async () => {
    const database = await createDatabase()
    const build = await buildBuildertrendIdentityReviewSql(
      "org-a",
      manifest()
    )

    expect(build.summary.decisionCount).toBe(3)
    expect(build.summary.relationshipCount).toBe(3)
    expect(build.summary.pooledCustomerCount).toBe(1)
    expect(build.summary.leadConversionCount).toBe(1)
    expect(build.sql).not.toMatch(
      /INSERT(?: OR IGNORE)? INTO (?:projects|customers|users|project_members|notifications)\b/
    )

    database.exec(build.sql)
    expect(
      scalar(
        database,
        "SELECT COUNT(*) FROM buildertrend_staging_identity_decisions"
      )
    ).toBe(3)
    expect(
      scalar(
        database,
        "SELECT COUNT(*) FROM buildertrend_staging_identity_relationships"
      )
    ).toBe(3)
    expect(
      scalar(
        database,
        "SELECT status FROM buildertrend_staging_identity_review_runs"
      )
    ).toBe("completed")
    expect(
      scalar(
        database,
        "SELECT SUM(portal_identity_allowed) FROM buildertrend_staging_identity_decisions"
      )
    ).toBe(0)
    expect(
      scalar(
        database,
        "SELECT SUM(grants_portal_access) FROM buildertrend_staging_identity_relationships"
      )
    ).toBe(0)

    expect(() =>
      database.exec(
        "UPDATE buildertrend_staging_identity_decisions SET review_status = 'rejected'"
      )
    ).toThrow("immutable")
    expect(() =>
      database.exec(
        "DELETE FROM buildertrend_staging_identity_relationships"
      )
    ).toThrow("cannot be deleted")
  })

  it("enforces exact source identities and reviewed relationship evidence in D1", async () => {
    const database = await createDatabase()
    const build = await buildBuildertrendIdentityReviewSql(
      "org-a",
      manifest()
    )
    database.exec(build.sql)

    try {
      database.exec(`
        INSERT INTO buildertrend_staging_identity_decisions (
          id, review_run_id, organization_id, source_record_id, source_key,
          source_identity_kind, source_identity_id, lifecycle_status,
          disposition, customer_provenance_kind, portal_identity_allowed,
          review_status, created_at
        ) VALUES (
          'forged-decision',
          'buildertrend:identity-run:org-a:identity-review-2026-07-31',
          'org-a', 'source-job-1001', 'job:1001', 'job', 'wrong-id',
          'active', 'unmatched', 'none', 0, 'needs_review',
          '2026-07-31T05:30:00.000Z'
        );
      `)
    } catch {
      // The database guard may abort the whole statement or report no change.
    }
    expect(
      scalar(
        database,
        "SELECT COUNT(*) FROM buildertrend_staging_identity_decisions WHERE id = 'forged-decision'"
      )
    ).toBe(0)

    database.exec(`
      INSERT INTO buildertrend_staging_identity_review_runs (
        id, organization_id, review_key, manifest_fingerprint, status,
        expected_decision_count, expected_relationship_count, reviewed_at,
        created_at
      ) VALUES (
        'manual-run', 'org-a', 'manual-review', 'manual-fingerprint',
        'in_progress', 2, 1, '2026-07-31T05:30:00.000Z',
        '2026-07-31T05:30:00.000Z'
      );
      INSERT INTO buildertrend_staging_identity_decisions (
        id, review_run_id, organization_id, source_record_id, source_key,
        source_identity_kind, source_identity_id, lifecycle_status,
        disposition, department_code, customer_provenance_kind,
        portal_identity_allowed, review_status, created_at
      ) VALUES
        (
          'manual-lead', 'manual-run', 'org-a', 'source-lead-2001',
          'lead:2001', 'lead', '2001', 'preconstruction', 'lead_only', 'D',
          'none', 0, 'approved', '2026-07-31T05:30:00.000Z'
        ),
        (
          'manual-job', 'manual-run', 'org-a', 'source-job-1001',
          'job:1001', 'job', '1001', 'active', 'unmatched', 'D',
          'none', 0, 'needs_review', '2026-07-31T05:30:00.000Z'
        );
    `)
    try {
      database.exec(`
        INSERT INTO buildertrend_staging_identity_relationships (
          id, review_run_id, organization_id, from_decision_id,
          to_decision_id, relationship_type, review_status,
          grants_portal_access, created_at
        ) VALUES (
          'unreviewed-transition', 'manual-run', 'org-a', 'manual-lead',
          'manual-job', 'department_transition', 'approved', 0,
          '2026-07-31T05:30:00.000Z'
        );
      `)
    } catch {
      // The database guard may abort the whole statement or report no change.
    }
    expect(
      scalar(
        database,
        "SELECT COUNT(*) FROM buildertrend_staging_identity_relationships WHERE id = 'unreviewed-transition'"
      )
    ).toBe(0)
  })

  it("keeps reused project numbers distinct by exact Buildertrend job ID", async () => {
    const database = await createDatabase()
    const build = await buildBuildertrendIdentityReviewSql(
      "org-a",
      manifest()
    )
    database.exec(build.sql)

    const rows: unknown = database
      .prepare(
        `SELECT
          source_identity_id AS sourceIdentityId,
          matched_project_id AS matchedProjectId
        FROM buildertrend_staging_identity_decisions
        WHERE source_identity_kind = 'job'
        ORDER BY source_identity_id`
      )
      .all()

    expect(rows).toEqual([
      { sourceIdentityId: "1001", matchedProjectId: "project-a" },
      {
        sourceIdentityId: "1002",
        matchedProjectId: "project-a-continuation",
      },
    ])
  })

  it("replays exactly and flags a changed manifest under the same review key", async () => {
    const database = await createDatabase()
    const first = await buildBuildertrendIdentityReviewSql(
      "org-a",
      manifest()
    )
    database.exec(first.sql)
    database.exec(first.sql)
    expect(
      scalar(
        database,
        "SELECT COUNT(*) FROM buildertrend_staging_identity_review_runs"
      )
    ).toBe(1)

    const changed = await buildBuildertrendIdentityReviewSql(
      "org-a",
      manifest({
        decisions: manifest().decisions.map((decision) =>
          decision.sourceKey === "job:1001"
            ? { ...decision, reviewNotes: "Changed after completion" }
            : decision
        ),
      })
    )
    database.exec(changed.sql)
    expect(
      scalar(
        database,
        "SELECT status FROM buildertrend_staging_identity_review_runs"
      )
    ).toBe("manifest_conflict")
    expect(
      scalar(
        database,
        "SELECT COUNT(*) FROM buildertrend_staging_identity_decisions"
      )
    ).toBe(3)
  })

  it("fails closed on cross-organization projects, customers, and reviewers", async () => {
    const projectDatabase = await createDatabase()
    const crossProject = await buildBuildertrendIdentityReviewSql(
      "org-a",
      manifest({
        reviewKey: "cross-project",
        decisions: manifest().decisions.map((decision) =>
          decision.sourceKey === "job:1001"
            ? { ...decision, matchedProjectId: "project-b" }
            : decision
        ),
      })
    )
    projectDatabase.exec(crossProject.sql)
    expect(
      scalar(
        projectDatabase,
        "SELECT status FROM buildertrend_staging_identity_review_runs"
      )
    ).toBe("in_progress")
    expect(
      scalar(
        projectDatabase,
        "SELECT COUNT(*) FROM buildertrend_staging_identity_decisions"
      )
    ).toBe(2)
    expect(
      scalar(
        projectDatabase,
        "SELECT COUNT(*) FROM buildertrend_staging_identity_decisions WHERE matched_project_id = 'project-b'"
      )
    ).toBe(0)

    const customerDatabase = await createDatabase()
    const crossCustomer = await buildBuildertrendIdentityReviewSql(
      "org-a",
      manifest({
        reviewKey: "cross-customer",
        decisions: manifest().decisions.map((decision) =>
          decision.sourceKey === "job:1001"
            ? {
                ...decision,
                customerProvenance: {
                  customerId: "pooled-b",
                  kind: "pooled_accounting",
                },
              }
            : decision
        ),
      })
    )
    customerDatabase.exec(crossCustomer.sql)
    expect(
      scalar(
        customerDatabase,
        "SELECT status FROM buildertrend_staging_identity_review_runs"
      )
    ).toBe("in_progress")
    expect(
      scalar(
        customerDatabase,
        "SELECT COUNT(*) FROM buildertrend_staging_identity_decisions WHERE customer_provenance_id = 'pooled-b'"
      )
    ).toBe(0)

    const reviewerDatabase = await createDatabase()
    const crossReviewer = await buildBuildertrendIdentityReviewSql(
      "org-a",
      manifest({
        reviewKey: "cross-reviewer",
        reviewedBy: "reviewer-b",
      })
    )
    try {
      reviewerDatabase.exec(crossReviewer.sql)
    } catch {
      // The scope trigger is expected to abort this review before persistence.
    }
    expect(
      scalar(
        reviewerDatabase,
        "SELECT COUNT(*) FROM buildertrend_staging_identity_review_runs"
      )
    ).toBe(0)
  })
})
