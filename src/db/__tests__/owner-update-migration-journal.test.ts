import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const migrationDirectory = resolve(process.cwd(), "drizzle");

function readMigration(name: string): string {
  return readFileSync(resolve(migrationDirectory, name), "utf8");
}

describe("owner-update migrations after current main", () => {
  it("uses the next three migration slots without renaming historical files", () => {
    const names = [
      "0250_owner_update_write_fencing.sql",
      "0251_external_resource_grants.sql",
      "0252_owner_update_publish_attachment_atomicity.sql",
    ];

    expect(names.every((name) => existsSync(resolve(migrationDirectory, name)))).toBe(true);
    expect(existsSync(resolve(migrationDirectory, "0243_owner_update_write_fencing.sql"))).toBe(false);
    expect(existsSync(resolve(migrationDirectory, "0244_external_resource_grants.sql"))).toBe(false);
    expect(existsSync(resolve(migrationDirectory, "0245_owner_update_publish_attachment_atomicity.sql"))).toBe(false);
  });

  it("keeps the owner-update migration operations intact", () => {
    expect(readMigration("0250_owner_update_write_fencing.sql")).toContain("ADD `revision`");
    expect(readMigration("0251_external_resource_grants.sql")).toContain("CREATE TABLE `project_external_resource_grants`");
    expect(readMigration("0252_owner_update_publish_attachment_atomicity.sql")).toContain("owner_update_publish_attachment_approval");
  });
});
