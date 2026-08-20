export type PlanSwiftImportField =
  | "costCode"
  | "title"
  | "description"
  | "internalNotes"
  | "costType"
  | "quantity"
  | "unit"
  | "unitCost"
  | "markupPercentage"
  | "totalCost";

export type PlanSwiftColumnMappings = Readonly<
  Record<PlanSwiftImportField, number | null>
>;

export type PlanSwiftMappingFieldDefinition = {
  readonly key: PlanSwiftImportField;
  readonly label: string;
  readonly requirement: "required" | "conditional" | "optional";
};

export type PlanSwiftImportPreviewRow = {
  readonly rowNumber: number;
  readonly costCode: string;
  readonly description: string;
  readonly notes: string | null;
  readonly quantity: number | null;
  readonly unit: string | null;
  readonly unitCost: number | null;
  readonly markupPercentage: number;
  readonly amount: number;
  readonly issues: readonly string[];
};

export function planSwiftPreviewIssues(input: {
  readonly costCode: string;
  readonly description: string;
  readonly amount: number;
}): readonly string[] {
  const issues: string[] = [];
  if (!input.costCode.trim()) issues.push("Missing cost code");
  if (!input.description.trim()) issues.push("Missing title or description");
  if (!Number.isFinite(input.amount) || input.amount <= 0) {
    issues.push("Amount must be greater than zero");
  }
  return issues;
}
export const PLAN_SWIFT_MAPPING_FIELDS: readonly PlanSwiftMappingFieldDefinition[] = [
  { key: "costCode", label: "Cost code", requirement: "required" },
  {
    key: "title",
    label: "Estimate item / title",
    requirement: "conditional",
  },
  { key: "description", label: "Description", requirement: "conditional" },
  { key: "internalNotes", label: "Internal notes", requirement: "optional" },
  { key: "costType", label: "Cost type", requirement: "optional" },
  { key: "quantity", label: "Quantity", requirement: "conditional" },
  { key: "unit", label: "Unit", requirement: "optional" },
  { key: "unitCost", label: "Unit cost", requirement: "conditional" },
  {
    key: "markupPercentage",
    label: "Markup percentage",
    requirement: "optional",
  },
  { key: "totalCost", label: "Extended / total cost", requirement: "conditional" },
];

const HEADER_ALIASES: Readonly<Record<PlanSwiftImportField, readonly string[]>> = {
  costCode: ["cost code", "costcode", "csi code", "csi cost code", "item code"],
  title: ["title", "item", "item title", "name", "takeoff item"],
  description: ["description", "item description", "scope description"],
  internalNotes: ["internal notes", "notes", "note", "location", "area"],
  costType: ["cost type", "type", "resource type"],
  quantity: ["quantity", "qty", "takeoff quantity"],
  unit: ["unit", "uom", "unit of measure"],
  unitCost: ["unit cost", "cost per unit", "rate", "price"],
  markupPercentage: [
    "markup percentage",
    "markup percent",
    "markup %",
    "markup",
  ],
  totalCost: [
    "extended cost",
    "total cost",
    "line total",
    "extended price",
    "amount",
  ],
};

function emptyMappings(): Record<PlanSwiftImportField, number | null> {
  return {
    costCode: null,
    title: null,
    description: null,
    internalNotes: null,
    costType: null,
    quantity: null,
    unit: null,
    unitCost: null,
    markupPercentage: null,
    totalCost: null,
  };
}

function normalizedHeader(value: unknown): string {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replaceAll(/[_-]+/g, " ")
    .replaceAll(/\s+/g, " ");
}

function fieldForHeader(value: unknown): PlanSwiftImportField | null {
  const normalized = normalizedHeader(value);
  for (const field of PLAN_SWIFT_MAPPING_FIELDS) {
    if (HEADER_ALIASES[field.key].includes(normalized)) return field.key;
  }
  return null;
}

export function detectPlanSwiftHeaderRow(
  rows: ReadonlyArray<ReadonlyArray<unknown>>,
): number {
  let bestIndex = 0;
  let bestScore = -1;
  const searchLimit = Math.min(rows.length, 25);

  for (let index = 0; index < searchLimit; index += 1) {
    const row = rows[index] ?? [];
    const matched = new Set<PlanSwiftImportField>();
    for (const cell of row) {
      const field = fieldForHeader(cell);
      if (field) matched.add(field);
    }
    if (matched.size > bestScore) {
      bestIndex = index;
      bestScore = matched.size;
    }
  }

  return bestIndex;
}

export function autoMapPlanSwiftColumns(
  headers: ReadonlyArray<unknown>,
): PlanSwiftColumnMappings {
  const mappings = emptyMappings();
  headers.forEach((header, columnIndex) => {
    const field = fieldForHeader(header);
    if (field && mappings[field] === null) mappings[field] = columnIndex;
  });
  return mappings;
}

function cellValue(
  row: ReadonlyArray<unknown>,
  columnIndex: number | null,
): unknown {
  if (columnIndex === null) return null;
  return row[columnIndex] ?? null;
}

function textValue(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const trimmed = String(value).trim();
  return trimmed.length > 0 ? trimmed : null;
}

function numberValue(value: unknown): number | null {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : null;
  }
  if (typeof value !== "string") return null;

  const trimmed = value.trim();
  if (trimmed.length === 0) return null;
  const negative = trimmed.startsWith("(") && trimmed.endsWith(")");
  const cleaned = trimmed.replaceAll(/[$,%\s()]/g, "");
  const parsed = Number(cleaned);
  if (!Number.isFinite(parsed)) return null;
  return negative ? -parsed : parsed;
}

function roundCurrency(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

export function normalizePlanSwiftCostCode(value: unknown): string {
  const text = textValue(value);
  if (!text) return "";

  const groups = /^(\d{2})[\s.-]+(\d{2})[\s.-]+(\d{2})(?:\s*(?:-|–|—)\s*.*)?$/.exec(
    text,
  );
  if (groups?.[1] && groups[2] && groups[3]) {
    return `${groups[1]} ${groups[2]} ${groups[3]}`;
  }

  const labelSeparator = text.search(/\s(?:-|–|—)\s/);
  return (labelSeparator > 0 ? text.slice(0, labelSeparator) : text).trim();
}

function buildNotes(input: {
  readonly sourceDescription: string | null;
  readonly internalNotes: string | null;
  readonly costType: string | null;
  readonly quantity: number | null;
  readonly unit: string | null;
  readonly unitCost: number | null;
  readonly markupPercentage: number;
}): string | null {
  const notes: string[] = [];
  if (input.sourceDescription) notes.push(input.sourceDescription);
  if (
    input.internalNotes &&
    input.internalNotes !== input.sourceDescription
  ) {
    notes.push(input.internalNotes);
  }

  const pricing: string[] = [];
  if (input.costType) pricing.push(input.costType);
  if (input.quantity !== null) {
    pricing.push(
      `${input.quantity}${input.unit ? ` ${input.unit}` : ""}${
        input.unitCost !== null ? ` @ $${input.unitCost.toFixed(2)}` : ""
      }`,
    );
  }
  if (input.markupPercentage !== 0) {
    pricing.push(`${input.markupPercentage}% markup`);
  }
  if (pricing.length > 0) notes.push(`PlanSwift: ${pricing.join(" · ")}`);

  return notes.length > 0 ? notes.join("\n") : null;
}

function rowHasData(row: ReadonlyArray<unknown>): boolean {
  return row.some((value) => textValue(value) !== null);
}

export function normalizePlanSwiftRow(
  row: ReadonlyArray<unknown>,
  rowNumber: number,
  mappings: PlanSwiftColumnMappings,
): PlanSwiftImportPreviewRow | null {
  if (!rowHasData(row)) return null;

  const costCode = normalizePlanSwiftCostCode(
    cellValue(row, mappings.costCode),
  );
  const title = textValue(cellValue(row, mappings.title));
  const sourceDescription = textValue(cellValue(row, mappings.description));
  const description = title ?? sourceDescription ?? "";
  const internalNotes = textValue(cellValue(row, mappings.internalNotes));
  const costType = textValue(cellValue(row, mappings.costType));
  const quantity = numberValue(cellValue(row, mappings.quantity));
  const unit = textValue(cellValue(row, mappings.unit));
  const unitCost = numberValue(cellValue(row, mappings.unitCost));
  const markupPercentage =
    numberValue(cellValue(row, mappings.markupPercentage)) ?? 0;
  const mappedTotal = numberValue(cellValue(row, mappings.totalCost));
  const calculatedTotal =
    quantity !== null && unitCost !== null
      ? quantity * unitCost * (1 + markupPercentage / 100)
      : 0;
  const amount = roundCurrency(mappedTotal ?? calculatedTotal);
  const issues = planSwiftPreviewIssues({ costCode, description, amount });

  return {
    rowNumber,
    costCode,
    description,
    notes: buildNotes({
      sourceDescription,
      internalNotes,
      costType,
      quantity,
      unit,
      unitCost,
      markupPercentage,
    }),
    quantity,
    unit,
    unitCost,
    markupPercentage,
    amount,
    issues,
  };
}

export function normalizePlanSwiftRows(
  rows: ReadonlyArray<ReadonlyArray<unknown>>,
  headerRowIndex: number,
  mappings: PlanSwiftColumnMappings,
): readonly PlanSwiftImportPreviewRow[] {
  const normalized: PlanSwiftImportPreviewRow[] = [];
  for (let index = headerRowIndex + 1; index < rows.length; index += 1) {
    const row = rows[index];
    if (!row) continue;
    const parsed = normalizePlanSwiftRow(row, index + 1, mappings);
    if (parsed) normalized.push(parsed);
  }
  return normalized;
}

export function validatePlanSwiftMappings(
  mappings: PlanSwiftColumnMappings,
): readonly string[] {
  const issues: string[] = [];
  if (mappings.costCode === null) issues.push("Map a cost code column.");
  if (mappings.title === null && mappings.description === null) {
    issues.push("Map a title or description column.");
  }
  if (
    mappings.totalCost === null &&
    (mappings.quantity === null || mappings.unitCost === null)
  ) {
    issues.push("Map total cost, or map both quantity and unit cost.");
  }
  return issues;
}
