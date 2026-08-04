#!/usr/bin/env node

import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDirectory = fileURLToPath(new URL(".", import.meta.url));
const inventoryPath = resolve(
  scriptDirectory,
  "fixtures/buildertrend-active-template-capture-2026-07-31.json",
);
const workplanPath = resolve(
  scriptDirectory,
  "fixtures/buildertrend-template-capture-workplan-2026-08-03.json",
);
const expectedTotals = {
  tasks: 739,
  scheduleItems: 163,
  selections: 155,
  bidPackages: 30,
};
const moduleKeys = Object.keys(expectedTotals);
const validStatuses = new Set([
  "pending",
  "in_progress",
  "completed",
  "completed_with_exceptions",
  "blocked",
]);

/**
 * @param {string} path
 * @returns {Promise<unknown>}
 */
async function loadJson(path) {
  return JSON.parse(await readFile(path, "utf8"));
}

/**
 * @param {unknown} value
 * @param {string} message
 */
function requireCondition(value, message) {
  if (!value) {
    throw new Error(message);
  }
}

/**
 * @param {unknown} value
 * @returns {value is Record<string, unknown>}
 */
function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * @param {Record<string, unknown>} counts
 * @param {string} label
 * @returns {number}
 */
function validateModuleCounts(counts, label) {
  const keys = Object.keys(counts).sort();
  const expectedKeys = moduleKeys
    .filter((key) => Object.hasOwn(counts, key))
    .sort();

  requireCondition(
    JSON.stringify(keys) === JSON.stringify(expectedKeys),
    `${label} has unsupported module count keys`,
  );

  return keys.reduce((total, key) => {
    const count = counts[key];
    requireCondition(
      typeof count === "number" && Number.isInteger(count) && count >= 0,
      `${label} has an invalid ${key} count`,
    );
    return total + count;
  }, 0);
}

/**
 * @param {Record<string, unknown>} actual
 * @param {Record<string, unknown>} expected
 * @param {string} label
 */
function requireExactCounts(actual, expected, label) {
  requireCondition(
    JSON.stringify(actual) === JSON.stringify(expected),
    `${label} module counts do not match the reviewed inventory`,
  );
}

try {
  const inventory = await loadJson(inventoryPath);
  const workplan = await loadJson(workplanPath);

  requireCondition(isRecord(inventory), "Inventory must be an object");
  requireCondition(isRecord(workplan), "Workplan must be an object");
  requireCondition(
    Array.isArray(inventory.templates),
    "Inventory must contain a templates array",
  );
  requireCondition(
    Array.isArray(workplan.templates),
    "Workplan must contain a templates array",
  );
  requireCondition(
    workplan.scope && isRecord(workplan.scope),
    "Workplan must contain scope",
  );
  requireCondition(
    workplan.aggregateTotals && isRecord(workplan.aggregateTotals),
    "Workplan must contain aggregateTotals",
  );
  requireCondition(
    workplan.scope.archivedTemplatesExcluded === 27 &&
      workplan.scope.archivedTemplatesIncluded === 0,
    "Workplan must record 27 excluded archived templates and include none",
  );
  requireCondition(
    typeof workplan.status === "string" && validStatuses.has(workplan.status),
    "Workplan has an invalid status",
  );

  const inventoryById = new Map();
  for (const template of inventory.templates) {
    requireCondition(isRecord(template), "Inventory contains an invalid template");
    const { sourceTemplateId } = template;
    requireCondition(
      typeof sourceTemplateId === "string" && sourceTemplateId.length > 0,
      "Inventory contains a template without a sourceTemplateId",
    );
    requireCondition(
      !inventoryById.has(sourceTemplateId),
      `Inventory has a duplicate sourceTemplateId: ${sourceTemplateId}`,
    );
    inventoryById.set(sourceTemplateId, template);
  }

  const seenIds = new Set();
  const computedTotals = Object.fromEntries(moduleKeys.map((key) => [key, 0]));
  for (const template of workplan.templates) {
    requireCondition(isRecord(template), "Workplan contains an invalid template");
    const { sourceTemplateId, temporaryBuildertrendTargetName, status, exceptions } =
      template;
    requireCondition(
      typeof sourceTemplateId === "string" && inventoryById.has(sourceTemplateId),
      `Workplan references an archived or unknown sourceTemplateId: ${String(sourceTemplateId)}`,
    );
    requireCondition(
      !seenIds.has(sourceTemplateId),
      `Workplan has a duplicate sourceTemplateId: ${sourceTemplateId}`,
    );
    seenIds.add(sourceTemplateId);
    requireCondition(
      typeof temporaryBuildertrendTargetName === "string" &&
        temporaryBuildertrendTargetName.trim() === temporaryBuildertrendTargetName &&
        temporaryBuildertrendTargetName.length > 0 &&
        temporaryBuildertrendTargetName.length <= 50 &&
        !/[\r\n\t]/.test(temporaryBuildertrendTargetName),
      `Workplan has an unsafe temporary target name for ${sourceTemplateId}`,
    );
    requireCondition(
      typeof status === "string" && validStatuses.has(status),
      `Workplan has an invalid status for ${sourceTemplateId}`,
    );
    requireCondition(
      Array.isArray(exceptions),
      `Workplan exceptions must be an array for ${sourceTemplateId}`,
    );
    requireCondition(
      status !== "completed_with_exceptions" || exceptions.length > 0,
      `completed_with_exceptions requires at least one exception for ${sourceTemplateId}`,
    );
    requireCondition(
      isRecord(template.moduleCounts),
      `Workplan is missing moduleCounts for ${sourceTemplateId}`,
    );

    const inventoryTemplate = inventoryById.get(sourceTemplateId);
    if (!inventoryTemplate || !isRecord(inventoryTemplate.moduleCounts)) {
      throw new Error(`Inventory is missing moduleCounts for ${sourceTemplateId}`);
    }
    validateModuleCounts(template.moduleCounts, `Workplan ${sourceTemplateId}`);
    requireExactCounts(
      template.moduleCounts,
      inventoryTemplate.moduleCounts,
      `Workplan ${sourceTemplateId}`,
    );
    for (const key of moduleKeys) {
      computedTotals[key] += template.moduleCounts[key] ?? 0;
    }
  }

  requireCondition(
    seenIds.size === inventoryById.size,
    `Workplan is missing ${inventoryById.size - seenIds.size} active source template(s)`,
  );
  for (const [key, expected] of Object.entries(expectedTotals)) {
    requireCondition(
      computedTotals[key] === expected &&
        workplan.aggregateTotals[key] === expected,
      `Aggregate ${key} total must equal ${expected}`,
    );
  }

  console.log(
    `Workplan valid: ${seenIds.size} active templates; ${computedTotals.tasks} tasks, ${computedTotals.scheduleItems} schedule items, ${computedTotals.selections} selections, ${computedTotals.bidPackages} bid packages.`,
  );
} catch (error) {
  console.error(
    `Workplan validation failed: ${error instanceof Error ? error.message : String(error)}`,
  );
  process.exitCode = 1;
}
