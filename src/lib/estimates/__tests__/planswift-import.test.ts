import { describe, expect, it } from "vitest";

import {
  autoMapPlanSwiftColumns,
  detectPlanSwiftHeaderRow,
  normalizePlanSwiftRows,
  validatePlanSwiftMappings,
} from "@/lib/estimates/planswift-import";

const headers = [
  "Cost Code",
  "Title",
  "Description",
  "Internal Notes",
  "Cost Type",
  "Quantity",
  "Unit",
  "Unit Cost",
  "Markup Percentage",
];

describe("PlanSwift estimate import", () => {
  it("detects the sample header and maps its columns", () => {
    const rows = [["PlanSwift Takeoff"], [], headers];
    const headerRowIndex = detectPlanSwiftHeaderRow(rows);
    const mappings = autoMapPlanSwiftColumns(rows[headerRowIndex] ?? []);

    expect(headerRowIndex).toBe(2);
    expect(mappings).toMatchObject({
      costCode: 0,
      title: 1,
      description: 2,
      internalNotes: 3,
      costType: 4,
      quantity: 5,
      unit: 6,
      unitCost: 7,
      markupPercentage: 8,
      totalCost: null,
    });
    expect(validatePlanSwiftMappings(mappings)).toEqual([]);
  });

  it("normalizes a PlanSwift row and calculates marked-up extended cost", () => {
    const rows = [
      headers,
      [
        "01 71 13 - Mobilization",
        "Footer Labor Mileage",
        null,
        "Lower Level Continuous Footer",
        "Labor",
        189.75,
        "Man-Hour",
        10,
        26,
      ],
    ];
    const mappings = autoMapPlanSwiftColumns(headers);
    const result = normalizePlanSwiftRows(rows, 0, mappings);

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      rowNumber: 2,
      costCode: "01 71 13",
      description: "Footer Labor Mileage",
      quantity: 189.75,
      unit: "Man-Hour",
      unitCost: 10,
      markupPercentage: 26,
      amount: 2390.85,
      issues: [],
    });
    expect(result[0]?.notes).toContain("Lower Level Continuous Footer");
    expect(result[0]?.notes).toContain("189.75 Man-Hour @ $10.00");
  });

  it("surfaces invalid takeoff rows for review instead of importing silently", () => {
    const rows = [
      headers,
      [null, "Door Install Labor (Priced per EA)", null, null, "Labor", 5, "EA", 0, 0],
    ];
    const result = normalizePlanSwiftRows(
      rows,
      0,
      autoMapPlanSwiftColumns(headers),
    );

    expect(result[0]?.issues).toEqual([
      "Missing cost code",
      "Amount must be greater than zero",
    ]);
  });

  it("uses a mapped extended cost instead of recalculating quantity and rate", () => {
    const extendedHeaders = [...headers, "Extended Cost"];
    const rows = [
      extendedHeaders,
      [
        "03-11-13 - Forming Boards",
        "Hem Fir 2x10x16",
        "Spot footing form boards",
        null,
        "Material",
        10,
        "EA",
        23.53,
        26,
        "$250.00",
      ],
    ];
    const result = normalizePlanSwiftRows(
      rows,
      0,
      autoMapPlanSwiftColumns(extendedHeaders),
    );

    expect(result[0]?.costCode).toBe("03 11 13");
    expect(result[0]?.amount).toBe(250);
  });
});
