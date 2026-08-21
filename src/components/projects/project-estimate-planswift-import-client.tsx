"use client";

import * as React from "react";
import {
  IconAlertTriangle,
  IconArrowLeft,
  IconArrowRight,
  IconFileSpreadsheet,
  IconUpload,
} from "@tabler/icons-react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import {
  importPlanSwiftEstimateLines,
  type ProjectEstimateCostCodeOption,
} from "@/app/actions/project-estimates";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  autoMapPlanSwiftColumns,
  detectPlanSwiftHeaderRow,
  normalizePlanSwiftRows,
  PLAN_SWIFT_MAPPING_FIELDS,
  planSwiftPreviewIssues,
  type PlanSwiftColumnMappings,
  type PlanSwiftImportField,
  type PlanSwiftImportPreviewRow,
  validatePlanSwiftMappings,
} from "@/lib/estimates/planswift-import";

const MAX_WORKBOOK_BYTES = 10 * 1024 * 1024;
const MAX_WORKSHEET_ROWS = 2_000;
const MAX_WORKSHEET_COLUMNS = 200;
const EMPTY_ROWS: ReadonlyArray<ReadonlyArray<unknown>> = [];

type ParsedSheet = {
  readonly name: string;
  readonly rows: ReadonlyArray<ReadonlyArray<unknown>>;
};

type ParsedWorkbook = {
  readonly fileName: string;
  readonly sheets: readonly ParsedSheet[];
};

type EditablePreviewRow = {
  readonly costCode: string;
  readonly description: string;
  readonly quantity: string;
  readonly unit: string;
  readonly unitCost: string;
  readonly markupPercentage: string;
  readonly amount: string;
};

type ImportStep = "upload" | "mapping" | "review";

function money(value: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 2,
  }).format(value);
}

function fileExtension(fileName: string): string {
  const dot = fileName.lastIndexOf(".");
  return dot >= 0 ? fileName.slice(dot).toLowerCase() : "";
}

function selectedSheet(
  workbook: ParsedWorkbook | null,
  sheetName: string,
): ParsedSheet | null {
  return workbook?.sheets.find((sheet) => sheet.name === sheetName) ?? null;
}

function sourceHeaders(
  sheet: ParsedSheet | null,
  headerRowIndex: number,
): readonly string[] {
  const row = sheet?.rows[headerRowIndex] ?? [];
  return row.map((value, index) => {
    const label = String(value ?? "").trim();
    return label || `Column ${index + 1}`;
  });
}

function mappingDescription(
  field: PlanSwiftImportField,
  requirement: string,
): string {
  if (requirement === "required") return "Required";
  if (field === "title" || field === "description") {
    return "Map at least one title or description field";
  }
  if (requirement === "conditional") {
    return "Map total cost or both quantity and unit cost";
  }
  return "Optional";
}

function applyEdits(
  row: PlanSwiftImportPreviewRow,
  edit: EditablePreviewRow | undefined,
): PlanSwiftImportPreviewRow {
  if (!edit) return row;
  const amount = Number(edit.amount);
  const quantity = edit.quantity.trim() ? Number(edit.quantity) : null;
  const unitCost = edit.unitCost.trim() ? Number(edit.unitCost) : null;
  const markupPercentage = Number(edit.markupPercentage) || 0;
  return {
    ...row,
    costCode: edit.costCode,
    description: edit.description,
    quantity,
    unit: edit.unit.trim() || null,
    unitCost,
    markupPercentage,
    amount,
    issues: planSwiftPreviewIssues({
      costCode: edit.costCode,
      description: edit.description,
      amount,
    }),
  };
}

export function ProjectEstimatePlanSwiftImportClient({
  projectId,
  estimateId,
  costCodes,
  existingLineCount,
}: {
  readonly projectId: string;
  readonly estimateId: string;
  readonly costCodes: readonly ProjectEstimateCostCodeOption[];
  readonly existingLineCount: number;
}): React.ReactElement {
  const router = useRouter();
  const importInFlight = React.useRef(false);
  const [open, setOpen] = React.useState(false);
  const [step, setStep] = React.useState<ImportStep>("upload");
  const [reading, setReading] = React.useState(false);
  const [importing, setImporting] = React.useState(false);
  const [workbook, setWorkbook] = React.useState<ParsedWorkbook | null>(null);
  const [sheetName, setSheetName] = React.useState("");
  const [headerRowIndex, setHeaderRowIndex] = React.useState(0);
  const [mappings, setMappings] = React.useState<PlanSwiftColumnMappings>(() =>
    autoMapPlanSwiftColumns([]),
  );
  const [edits, setEdits] = React.useState<
    Readonly<Record<number, EditablePreviewRow>>
  >({});
  const [excludedRows, setExcludedRows] = React.useState<ReadonlySet<number>>(
    new Set(),
  );
  const [replaceExistingPlanSwiftLines, setReplaceExistingPlanSwiftLines] =
    React.useState(false);

  const sheet = selectedSheet(workbook, sheetName);
  const sheetRows = sheet?.rows ?? EMPTY_ROWS;
  const headers = sourceHeaders(sheet, headerRowIndex);
  const mappingIssues = validatePlanSwiftMappings(mappings);
  const parsedRows = normalizePlanSwiftRows(
    sheetRows,
    headerRowIndex,
    mappings,
  );
  const reviewedRows = parsedRows.map((row) =>
    applyEdits(row, edits[row.rowNumber]),
  );
  const selectedRows = reviewedRows.filter(
    (row) => row.issues.length === 0 && !excludedRows.has(row.rowNumber),
  );
  const selectedTotal = selectedRows.reduce((sum, row) => sum + row.amount, 0);
  const rejectedCount = reviewedRows.filter(
    (row) => row.issues.length > 0,
  ).length;
  const knownCostCodes = new Set(costCodes.map((option) => option.value));
  const costCodeOptions = new Map(
    costCodes.map((option) => [option.value, option]),
  );
  const unmatchedCostCodeCount = selectedRows.filter(
    (row) => !knownCostCodes.has(row.costCode),
  ).length;

  function reset(): void {
    setStep("upload");
    setWorkbook(null);
    setSheetName("");
    setHeaderRowIndex(0);
    setMappings(autoMapPlanSwiftColumns([]));
    setEdits({});
    setExcludedRows(new Set());
    setReplaceExistingPlanSwiftLines(false);
  }

  function configureSheet(nextSheet: ParsedSheet): void {
    const detectedHeader = detectPlanSwiftHeaderRow(nextSheet.rows);
    setSheetName(nextSheet.name);
    setHeaderRowIndex(detectedHeader);
    setMappings(
      autoMapPlanSwiftColumns(nextSheet.rows[detectedHeader] ?? []),
    );
    setEdits({});
    setExcludedRows(new Set());
  }

  async function readWorkbook(file: File): Promise<void> {
    const extension = fileExtension(file.name);
    if (extension !== ".xls" && extension !== ".xlsx") {
      toast.error("Choose a PlanSwift .xls or .xlsx workbook.");
      return;
    }
    if (file.size > MAX_WORKBOOK_BYTES) {
      toast.error("Choose a workbook smaller than 10 MB.");
      return;
    }

    setReading(true);
    try {
      const XLSX = await import("xlsx");
      const bytes = await file.arrayBuffer();
      const parsed = XLSX.read(bytes, {
        type: "array",
        cellDates: false,
        dense: true,
      });
      const sheets: ParsedSheet[] = [];

      for (const name of parsed.SheetNames) {
        const worksheet = parsed.Sheets[name];
        if (!worksheet) continue;
        const range = worksheet["!ref"]
          ? XLSX.utils.decode_range(worksheet["!ref"])
          : null;
        if (
          range &&
          (range.e.r - range.s.r + 1 > MAX_WORKSHEET_ROWS ||
            range.e.c - range.s.c + 1 > MAX_WORKSHEET_COLUMNS)
        ) {
          throw new Error(
            `${name} exceeds the 2,000-row or 200-column import limit.`,
          );
        }
        const rawRows = XLSX.utils.sheet_to_json<unknown[]>(worksheet, {
          header: 1,
          // Formatted values preserve Excel percentage semantics (for example,
          // a stored 0.26 displayed as 26%) while the parser still normalizes
          // currency and numeric strings.
          raw: false,
          defval: null,
          blankrows: false,
        });
        sheets.push({
          name,
          rows: rawRows.map((row) => (Array.isArray(row) ? row : [])),
        });
      }

      if (sheets.length === 0) {
        throw new Error("The workbook does not contain a readable worksheet.");
      }
      const nextWorkbook = { fileName: file.name, sheets };
      setWorkbook(nextWorkbook);
      configureSheet(sheets[0]);
      setStep("mapping");
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : "The PlanSwift workbook could not be read.",
      );
    } finally {
      setReading(false);
    }
  }

  function changeSheet(nextSheetName: string): void {
    const nextSheet = workbook?.sheets.find(
      (candidate) => candidate.name === nextSheetName,
    );
    if (nextSheet) configureSheet(nextSheet);
  }

  function changeHeaderRow(nextRowNumber: number): void {
    if (!sheet) return;
    const nextIndex = Math.max(
      0,
      Math.min(sheet.rows.length - 1, nextRowNumber - 1),
    );
    setHeaderRowIndex(nextIndex);
    setMappings(autoMapPlanSwiftColumns(sheet.rows[nextIndex] ?? []));
    setEdits({});
    setExcludedRows(new Set());
  }

  function changeMapping(
    field: PlanSwiftImportField,
    value: string,
  ): void {
    const columnIndex = value === "unmapped" ? null : Number(value);
    setMappings((current) => ({ ...current, [field]: columnIndex }));
    setEdits({});
    setExcludedRows(new Set());
  }

  function changeRow(
    rowNumber: number,
    field: keyof EditablePreviewRow,
    value: string,
  ): void {
    setEdits((current) => {
      const parsedRow = parsedRows.find((row) => row.rowNumber === rowNumber);
      const currentRow =
        current[rowNumber] ??
        (parsedRow
          ? {
              costCode: parsedRow.costCode,
              description: parsedRow.description,
              quantity:
                parsedRow.quantity === null ? "" : String(parsedRow.quantity),
              unit: parsedRow.unit ?? "",
              unitCost:
                parsedRow.unitCost === null ? "" : String(parsedRow.unitCost),
              markupPercentage: String(parsedRow.markupPercentage),
              amount: parsedRow.amount > 0 ? String(parsedRow.amount) : "",
            }
          : null);
      if (!currentRow) return current;
      const nextRow = { ...currentRow, [field]: value };
      if (
        field === "quantity" ||
        field === "unitCost" ||
        field === "markupPercentage"
      ) {
        const quantity = Number(nextRow.quantity);
        const unitCost = Number(nextRow.unitCost);
        const markup = Number(nextRow.markupPercentage) || 0;
        if (quantity > 0 && unitCost > 0) {
          nextRow.amount = String(
            Math.round(quantity * unitCost * (1 + markup / 100) * 100) / 100,
          );
        }
      }
      if (field === "amount") {
        const amount = Number(nextRow.amount);
        const quantity = Number(nextRow.quantity) || 1;
        const markup = Number(nextRow.markupPercentage) || 0;
        if (amount > 0) {
          nextRow.unitCost = String(
            Math.round((amount / quantity / (1 + markup / 100)) * 100) / 100,
          );
        }
      }
      return {
        ...current,
        [rowNumber]: nextRow,
      };
    });
  }

  function toggleRow(rowNumber: number, included: boolean): void {
    setExcludedRows((current) => {
      const next = new Set(current);
      if (included) next.delete(rowNumber);
      else next.add(rowNumber);
      return next;
    });
  }

  async function confirmImport(): Promise<void> {
    if (
      !workbook ||
      !sheet ||
      selectedRows.length === 0 ||
      importInFlight.current
    ) {
      return;
    }
    importInFlight.current = true;
    setImporting(true);
    try {
      const result = await importPlanSwiftEstimateLines(projectId, estimateId, {
        sourceFileName: workbook.fileName,
        sourceSheetName: sheet.name,
        replaceExistingPlanSwiftLines,
        lines: selectedRows.map((row) => ({
          rowNumber: row.rowNumber,
          costCode: row.costCode,
          description: row.description,
          notes: row.notes,
          quantity: row.quantity,
          unit: row.unit,
          unitCost: row.unitCost,
          markupPercentage: row.markupPercentage,
          amount: row.amount,
        })),
      });

      if (!result.success) {
        toast.error(result.error);
        return;
      }

      toast.success(
        `Imported ${result.lineCount} PlanSwift items totaling ${money(result.totalCents / 100)}.`,
      );
      setOpen(false);
      reset();
      router.refresh();
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : "The PlanSwift import could not be completed.",
      );
    } finally {
      importInFlight.current = false;
      setImporting(false);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (importing && !nextOpen) return;
        setOpen(nextOpen);
        if (!nextOpen && !importing) reset();
      }}
    >
      <DialogTrigger asChild>
        <Button type="button" variant="outline" size="sm">
          <IconFileSpreadsheet className="size-4" />
          Import PlanSwift
        </Button>
      </DialogTrigger>
      <DialogContent
        showCloseButton={!importing}
        className="flex max-h-[92vh] max-w-[min(96vw,1100px)] flex-col gap-0 overflow-hidden p-0 sm:max-w-[min(96vw,1100px)]"
      >
        <DialogHeader className="border-b px-5 py-4">
          <DialogTitle>Import PlanSwift Takeoff</DialogTitle>
          <DialogDescription>
            Upload, map, and review the workbook before adding internal draft
            lines to this project estimate.
          </DialogDescription>
        </DialogHeader>

        <div className="flex items-center gap-2 border-b bg-muted/30 px-5 py-2 text-xs text-muted-foreground">
          <span className={step === "upload" ? "font-semibold text-foreground" : ""}>
            1. Upload
          </span>
          <IconArrowRight className="size-3" />
          <span className={step === "mapping" ? "font-semibold text-foreground" : ""}>
            2. Map columns
          </span>
          <IconArrowRight className="size-3" />
          <span className={step === "review" ? "font-semibold text-foreground" : ""}>
            3. Review & import
          </span>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto p-5">
          {step === "upload" && (
            <div className="mx-auto max-w-2xl space-y-4 py-8">
              <label className="flex cursor-pointer flex-col items-center gap-3 border border-dashed p-10 text-center hover:bg-muted/30">
                <IconUpload className="size-8 text-muted-foreground" />
                <span className="font-medium">
                  {reading ? "Reading workbook..." : "Choose PlanSwift workbook"}
                </span>
                <span className="text-sm text-muted-foreground">
                  Legacy .xls and current .xlsx files up to 10 MB are supported.
                </span>
                <Input
                  type="file"
                  accept=".xls,.xlsx,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                  className="sr-only"
                  disabled={reading}
                  onChange={(event) => {
                    const file = event.currentTarget.files?.item(0);
                    if (file) void readWorkbook(file);
                    event.currentTarget.value = "";
                  }}
                />
              </label>
              <Alert>
                <IconAlertTriangle />
                <AlertTitle>No estimate changes are made during upload.</AlertTitle>
                <AlertDescription>
                  The workbook is read in your browser. Only rows selected on
                  the final review screen are sent to Compass.
                </AlertDescription>
              </Alert>
            </div>
          )}

          {step === "mapping" && workbook && sheet && (
            <div className="space-y-5">
              <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_140px]">
                <label className="space-y-1.5 text-sm">
                  <span className="font-medium">Worksheet</span>
                  <Select value={sheetName} onValueChange={changeSheet}>
                    <SelectTrigger className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {workbook.sheets.map((candidate) => (
                        <SelectItem key={candidate.name} value={candidate.name}>
                          {candidate.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </label>
                <label className="space-y-1.5 text-sm">
                  <span className="font-medium">Header row</span>
                  <Input
                    type="number"
                    min="1"
                    max={sheet.rows.length}
                    value={headerRowIndex + 1}
                    onChange={(event) =>
                      changeHeaderRow(Number(event.target.value))
                    }
                  />
                </label>
              </div>

              <div className="border">
                <div className="grid grid-cols-[minmax(180px,1fr)_minmax(220px,1.3fr)] border-b bg-muted/40 px-3 py-2 text-xs font-medium text-muted-foreground">
                  <span>Compass field</span>
                  <span>Workbook column</span>
                </div>
                {PLAN_SWIFT_MAPPING_FIELDS.map((field) => (
                  <div
                    key={field.key}
                    className="grid grid-cols-[minmax(180px,1fr)_minmax(220px,1.3fr)] items-center gap-3 border-b px-3 py-2 last:border-b-0"
                  >
                    <div>
                      <p className="text-sm font-medium">{field.label}</p>
                      <p className="text-xs text-muted-foreground">
                        {mappingDescription(field.key, field.requirement)}
                      </p>
                    </div>
                    <Select
                      value={
                        mappings[field.key] === null
                          ? "unmapped"
                          : String(mappings[field.key])
                      }
                      onValueChange={(value) =>
                        changeMapping(field.key, value)
                      }
                    >
                      <SelectTrigger className="w-full">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="unmapped">Not mapped</SelectItem>
                        {headers.map((header, columnIndex) => (
                          <SelectItem
                            key={`${columnIndex}-${header}`}
                            value={String(columnIndex)}
                          >
                            {header}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                ))}
              </div>

              {mappingIssues.length > 0 && (
                <Alert variant="destructive">
                  <IconAlertTriangle />
                  <AlertTitle>Complete the required mappings</AlertTitle>
                  <AlertDescription>{mappingIssues.join(" ")}</AlertDescription>
                </Alert>
              )}

              <div className="grid gap-3 sm:grid-cols-3">
                <div className="border p-3">
                  <p className="text-xs text-muted-foreground">Detected rows</p>
                  <p className="mt-1 text-lg font-semibold">{reviewedRows.length}</p>
                </div>
                <div className="border p-3">
                  <p className="text-xs text-muted-foreground">Ready rows</p>
                  <p className="mt-1 text-lg font-semibold">
                    {reviewedRows.length - rejectedCount}
                  </p>
                </div>
                <div className="border p-3">
                  <p className="text-xs text-muted-foreground">Rows needing review</p>
                  <p className="mt-1 text-lg font-semibold">{rejectedCount}</p>
                </div>
              </div>
            </div>
          )}

          {step === "review" && workbook && sheet && (
            <div className="space-y-4">
              {existingLineCount > 0 && (
                <Alert>
                  <IconAlertTriangle />
                  <AlertTitle>This estimate already has draft lines.</AlertTitle>
                  <AlertDescription>
                    Choose whether to append these rows or replace only the
                    estimate lines previously imported from PlanSwift. Manual
                    estimate lines are never removed by this option.
                  </AlertDescription>
                  <label className="mt-3 flex items-center gap-2 text-sm">
                    <Checkbox
                      checked={replaceExistingPlanSwiftLines}
                      onCheckedChange={(checked) =>
                        setReplaceExistingPlanSwiftLines(checked === true)
                      }
                    />
                    Replace prior PlanSwift-imported lines
                  </label>
                </Alert>
              )}
              {unmatchedCostCodeCount > 0 && (
                <Alert>
                  <IconAlertTriangle />
                  <AlertTitle>
                    {unmatchedCostCodeCount} selected cost codes need mapping.
                  </AlertTitle>
                  <AlertDescription>
                    Edit each highlighted value to an active estimate cost code
                    before importing.
                  </AlertDescription>
                </Alert>
              )}

              <div className="flex flex-wrap items-end justify-between gap-3">
                <div>
                  <p className="font-medium">{workbook.fileName}</p>
                  <p className="text-sm text-muted-foreground">
                    {sheet.name} · {selectedRows.length} selected · {rejectedCount}{" "}
                    needing review
                  </p>
                </div>
                <div className="text-right">
                  <p className="text-xs text-muted-foreground">Selected total</p>
                  <p className="text-xl font-semibold">{money(selectedTotal)}</p>
                </div>
              </div>

              <div className="overflow-x-auto border">
                <table className="w-full min-w-[1320px] text-sm">
                  <thead className="sticky top-0 z-10 bg-muted">
                    <tr>
                      <th className="w-16 px-2 py-2 text-center font-medium">Use</th>
                      <th className="w-16 px-2 py-2 text-left font-medium">Row</th>
                      <th className="w-44 px-2 py-2 text-left font-medium">Cost code</th>
                      <th className="w-44 px-2 py-2 text-left font-medium">Division</th>
                      <th className="px-2 py-2 text-left font-medium">Description</th>
                      <th className="w-28 px-2 py-2 text-right font-medium">Quantity</th>
                      <th className="w-28 px-2 py-2 text-left font-medium">Unit</th>
                      <th className="w-32 px-2 py-2 text-right font-medium">Unit cost</th>
                      <th className="w-40 px-2 py-2 text-right font-medium">Amount</th>
                      <th className="w-56 px-2 py-2 text-left font-medium">Review</th>
                    </tr>
                  </thead>
                  <tbody>
                    {reviewedRows.map((row) => {
                      const included = !excludedRows.has(row.rowNumber);
                      const knownCode =
                        knownCostCodes.has(row.costCode);
                      const costCodeOption = costCodeOptions.get(row.costCode);
                      return (
                        <tr key={row.rowNumber} className="border-t align-top">
                          <td className="px-2 py-2 text-center">
                            <Checkbox
                              checked={included && row.issues.length === 0}
                              disabled={row.issues.length > 0}
                              onCheckedChange={(checked) =>
                                toggleRow(row.rowNumber, checked === true)
                              }
                              aria-label={`Include source row ${row.rowNumber}`}
                            />
                          </td>
                          <td className="px-2 py-3 text-muted-foreground">
                            {row.rowNumber}
                          </td>
                          <td className="px-2 py-2">
                            <Input
                              list="planswift-cost-code-options"
                              value={row.costCode}
                              onChange={(event) =>
                                changeRow(
                                  row.rowNumber,
                                  "costCode",
                                  event.target.value,
                                )
                              }
                              aria-invalid={!row.costCode}
                            />
                            {!knownCode && row.costCode && (
                              <p className="mt-1 text-xs text-amber-700 dark:text-amber-400">
                                Map to an active cost code
                              </p>
                            )}
                          </td>
                          <td className="px-2 py-3 text-xs">
                            {costCodeOption
                              ? `${costCodeOption.divisionCode} · ${costCodeOption.divisionName}`
                              : "Select a mapped cost code"}
                          </td>
                          <td className="px-2 py-2">
                            <Input
                              value={row.description}
                              onChange={(event) =>
                                changeRow(
                                  row.rowNumber,
                                  "description",
                                  event.target.value,
                                )
                              }
                              aria-invalid={!row.description}
                            />
                            {row.notes && (
                              <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">
                                {row.notes}
                              </p>
                            )}
                          </td>
                          <td className="px-2 py-2">
                            <Input
                              type="number"
                              inputMode="decimal"
                              min="0.0001"
                              step="any"
                              className="text-right"
                              value={row.quantity === null ? "" : String(row.quantity)}
                              onChange={(event) =>
                                changeRow(row.rowNumber, "quantity", event.target.value)
                              }
                            />
                          </td>
                          <td className="px-2 py-2">
                            <Input
                              value={row.unit ?? ""}
                              onChange={(event) =>
                                changeRow(row.rowNumber, "unit", event.target.value)
                              }
                            />
                          </td>
                          <td className="px-2 py-2">
                            <Input
                              type="number"
                              inputMode="decimal"
                              min="0.01"
                              step="0.01"
                              className="text-right"
                              value={row.unitCost === null ? "" : String(row.unitCost)}
                              onChange={(event) =>
                                changeRow(row.rowNumber, "unitCost", event.target.value)
                              }
                            />
                          </td>
                          <td className="px-2 py-2">
                            <Input
                              type="number"
                              inputMode="decimal"
                              min="0.01"
                              step="0.01"
                              className="text-right"
                              value={row.amount > 0 ? String(row.amount) : ""}
                              onChange={(event) =>
                                changeRow(
                                  row.rowNumber,
                                  "amount",
                                  event.target.value,
                                )
                              }
                              aria-invalid={row.amount <= 0}
                            />
                          </td>
                          <td className="px-2 py-3 text-xs">
                            {row.issues.length > 0 ? (
                              <span className="text-destructive">
                                {row.issues.join("; ")}
                              </span>
                            ) : !knownCode ? (
                              <span className="text-amber-700 dark:text-amber-400">
                                Map cost code or exclude
                              </span>
                            ) : included ? (
                              <span className="text-emerald-700 dark:text-emerald-400">
                                Ready to import
                              </span>
                            ) : (
                              <span className="text-muted-foreground">Excluded</span>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              <datalist id="planswift-cost-code-options">
                {costCodes.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </datalist>
            </div>
          )}
        </div>

        {step !== "upload" && (
          <DialogFooter className="border-t px-5 py-4">
            <Button
              type="button"
              variant="outline"
              disabled={importing}
              onClick={() => setStep(step === "review" ? "mapping" : "upload")}
            >
              <IconArrowLeft className="size-4" />
              Back
            </Button>
            {step === "mapping" ? (
              <Button
                type="button"
                disabled={mappingIssues.length > 0 || reviewedRows.length === 0}
                onClick={() => setStep("review")}
              >
                Review rows
                <IconArrowRight className="size-4" />
              </Button>
            ) : (
              <Button
                type="button"
                disabled={
                  importing ||
                  selectedRows.length === 0 ||
                  unmatchedCostCodeCount > 0
                }
                onClick={() => void confirmImport()}
              >
                {importing
                  ? "Importing..."
                  : `Import ${selectedRows.length} items`}
              </Button>
            )}
          </DialogFooter>
        )}
      </DialogContent>
    </Dialog>
  );
}
