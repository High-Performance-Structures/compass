import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const migrationDirectory = resolve(process.cwd(), "drizzle");

function readMigration(name: string): string {
  return readFileSync(resolve(migrationDirectory, name), "utf8");
}

describe("owner-update migrations after current main", () => {
  it("uses the next five migration slots without renaming historical files", () => {
    const names = [
      "0251_owner_update_write_fencing.sql",
      "0252_external_resource_grants.sql",
      "0253_owner_update_publish_attachment_atomicity.sql",
      "0254_owner_update_attachment_grant_lifecycle.sql",
      "0255_owner_update_attachment_taxonomy_repair.sql",
    ];

    expect(names.every((name) => existsSync(resolve(migrationDirectory, name)))).toBe(true);
    expect(existsSync(resolve(migrationDirectory, "0250_project_calendars.sql"))).toBe(false);
    expect(existsSync(resolve(migrationDirectory, "0243_owner_update_write_fencing.sql"))).toBe(false);
    expect(existsSync(resolve(migrationDirectory, "0244_external_resource_grants.sql"))).toBe(false);
    expect(existsSync(resolve(migrationDirectory, "0245_owner_update_publish_attachment_atomicity.sql"))).toBe(false);
  });

  it("keeps the owner-update migration operations intact", () => {
    expect(readMigration("0251_owner_update_write_fencing.sql")).toContain("ADD `revision`");
    expect(readMigration("0252_external_resource_grants.sql")).toContain("CREATE TABLE `project_external_resource_grants`");
    expect(readMigration("0253_owner_update_publish_attachment_atomicity.sql")).toContain("owner_update_publish_attachment_approval");
    expect(readMigration("0254_owner_update_attachment_grant_lifecycle.sql")).toContain("source_owner_update_id");
    expect(readMigration("0255_owner_update_attachment_taxonomy_repair.sql")).toContain("selected_documents");
  });
});
