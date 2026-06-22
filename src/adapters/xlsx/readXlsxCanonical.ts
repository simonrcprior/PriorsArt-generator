import * as XLSX from "xlsx";
import { DiagnosticCollector } from "../../diagnostics/collector";
import {
  Assembly,
  CanonicalDatasets,
  DatePolicy,
  Demand,
  Operation,
  PartCatalogItem,
  PeggingLink,
  SalesOrder,
  Supply,
} from "../../model/types";
import { parseDateWithPolicy } from "../../pipeline/datePolicy";

interface XlsxReadResult {
  datasets: CanonicalDatasets;
  worksheetNames: string[];
}

type SheetRow = Record<string, unknown>;

function readRows(workbook: XLSX.WorkBook, sheetName: string): SheetRow[] {
  const sheet = workbook.Sheets[sheetName];
  if (!sheet) {
    return [];
  }

  return XLSX.utils.sheet_to_json<SheetRow>(sheet, {
    defval: null,
    raw: true,
  });
}

function asRequiredString(value: unknown): string | undefined {
  if (typeof value === "string" && value.trim()) {
    return value.trim();
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    return String(value);
  }
  return undefined;
}

function asOptionalString(value: unknown): string | undefined {
  if (value === null || value === undefined) {
    return undefined;
  }
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed || undefined;
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    return String(value);
  }
  return undefined;
}

function asNumber(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string") {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }
  return undefined;
}

function asNullableString(value: unknown): string | null {
  const parsed = asOptionalString(value);
  return parsed ?? null;
}

function validateRequiredFields(
  required: Record<string, string | number | undefined>,
  diagnostics: DiagnosticCollector,
  dataset: string,
  rowNumber: number
): boolean {
  const missing = Object.entries(required)
    .filter(([, value]) => value === undefined || value === "")
    .map(([field]) => field);

  if (missing.length > 0) {
    diagnostics.error({
      code: "MISSING_REQUIRED_FIELD",
      message: `Missing required fields: ${missing.join(", ")}`,
      dataset,
      row: rowNumber,
    });
    diagnostics.incrementDroppedRows();
    return false;
  }

  return true;
}

export function readXlsxCanonical(
  inputFile: string,
  datePolicy: DatePolicy,
  diagnostics: DiagnosticCollector
): XlsxReadResult {
  const workbook = XLSX.readFile(inputFile, { cellDates: false });

  const salesOrders: SalesOrder[] = [];
  const assemblies: Assembly[] = [];
  const demands: Demand[] = [];
  const supplies: Supply[] = [];
  const operations: Operation[] = [];
  const peggingLinks: PeggingLink[] = [];
  const partCatalog: PartCatalogItem[] = [];

  for (const [index, row] of readRows(workbook, "salesOrders").entries()) {
    const rowNumber = index + 2;
    const id = asRequiredString(row.id);
    const orderNumber = asRequiredString(row.orderNumber);
    const partNumber = asRequiredString(row.partNumber);
    const quantity = asNumber(row.quantity);

    if (!validateRequiredFields({ id, orderNumber, partNumber, quantity }, diagnostics, "salesOrders", rowNumber)) {
      continue;
    }

    const dueDate = parseDateWithPolicy(row.dueDate, datePolicy.defaultDateOrder, diagnostics, {
      dataset: "salesOrders",
      row: rowNumber,
      field: "dueDate",
    }).isoDate;

    if (!dueDate) {
      diagnostics.incrementDroppedRows();
      continue;
    }

    salesOrders.push({
      id: id!,
      orderNumber: orderNumber!,
      partNumber: partNumber!,
      quantity: quantity!,
      dueDate,
    });
  }

  for (const [index, row] of readRows(workbook, "assemblies").entries()) {
    const rowNumber = index + 2;
    const id = asRequiredString(row.id);
    const partNumber = asRequiredString(row.partNumber);
    const orderId = asRequiredString(row.orderId);
    const quantity = asNumber(row.quantity);

    if (!validateRequiredFields({ id, partNumber, orderId, quantity }, diagnostics, "assemblies", rowNumber)) {
      continue;
    }

    assemblies.push({ id: id!, partNumber: partNumber!, orderId: orderId!, quantity: quantity! });
  }

  for (const [index, row] of readRows(workbook, "demands").entries()) {
    const rowNumber = index + 2;
    const id = asRequiredString(row.id);
    const partNumber = asRequiredString(row.partNumber);
    const quantity = asNumber(row.quantity);
    const sourceType = asRequiredString(row.sourceType) as Demand["sourceType"] | undefined;

    if (!validateRequiredFields({ id, partNumber, quantity, sourceType }, diagnostics, "demands", rowNumber)) {
      continue;
    }

    const dueDate = parseDateWithPolicy(row.dueDate, datePolicy.defaultDateOrder, diagnostics, {
      dataset: "demands",
      row: rowNumber,
      field: "dueDate",
    }).isoDate;

    if (!dueDate) {
      diagnostics.incrementDroppedRows();
      continue;
    }

    const sourceId = asOptionalString(row.sourceId);
    const demand: Demand = {
      id: id!,
      partNumber: partNumber!,
      quantity: quantity!,
      dueDate,
      sourceType: sourceType!,
    };
    if (sourceId !== undefined) {
      demand.sourceId = sourceId;
    }
    demands.push(demand);
  }

  for (const [index, row] of readRows(workbook, "supplies").entries()) {
    const rowNumber = index + 2;
    const id = asRequiredString(row.id);
    const partNumber = asRequiredString(row.partNumber);
    const quantity = asNumber(row.quantity);
    const supplyType = asRequiredString(row.supplyType) as Supply["supplyType"] | undefined;

    if (!validateRequiredFields({ id, partNumber, quantity, supplyType }, diagnostics, "supplies", rowNumber)) {
      continue;
    }

    const availableDate = parseDateWithPolicy(row.availableDate, datePolicy.defaultDateOrder, diagnostics, {
      dataset: "supplies",
      row: rowNumber,
      field: "availableDate",
    }).isoDate;

    if (!availableDate) {
      diagnostics.incrementDroppedRows();
      continue;
    }

    const sourceId = asOptionalString(row.sourceId);
    const supply: Supply = {
      id: id!,
      partNumber: partNumber!,
      quantity: quantity!,
      availableDate,
      supplyType: supplyType!,
    };
    if (sourceId !== undefined) {
      supply.sourceId = sourceId;
    }
    supplies.push(supply);
  }

  for (const [index, row] of readRows(workbook, "operations").entries()) {
    const rowNumber = index + 2;
    const id = asRequiredString(row.id);
    const assemblyId = asRequiredString(row.assemblyId);
    const operationCode = asRequiredString(row.operationCode);
    const workCenter = asRequiredString(row.workCenter);
    const hours = asNumber(row.hours);

    if (!validateRequiredFields({ id, assemblyId, operationCode, workCenter, hours }, diagnostics, "operations", rowNumber)) {
      continue;
    }

    operations.push({
      id: id!,
      assemblyId: assemblyId!,
      operationCode: operationCode!,
      workCenter: workCenter!,
      hours: hours!,
    });
  }

  for (const [index, row] of readRows(workbook, "peggingLinks").entries()) {
    const rowNumber = index + 2;
    const id = asRequiredString(row.id);
    const demandId = asRequiredString(row.demandId);
    const supplyId = asRequiredString(row.supplyId);
    const quantity = asNumber(row.quantity);

    if (!validateRequiredFields({ id, demandId, supplyId, quantity }, diagnostics, "peggingLinks", rowNumber)) {
      continue;
    }

    const nest = asNumber(row.nest);
    const resolvedNest = nest !== undefined && Number.isInteger(nest) && nest >= 1 ? nest : 1;
    const pathCell = asOptionalString(row.path);
    const parsedPath = pathCell
      ? pathCell
          .split(/[|,>]/)
          .map((entry) => entry.trim())
          .filter((entry) => entry.length > 0)
      : [];
    const path = parsedPath.length > 0 ? parsedPath : [id!];
    const duplicateReason = asOptionalString(row.duplicateReason);

    peggingLinks.push({
      id: id!,
      demandId: demandId!,
      supplyId: supplyId!,
      quantity: quantity!,
      nest: resolvedNest,
      nestText: asOptionalString(row.nestText) ?? ">".repeat(resolvedNest),
      parentLinkId: asNullableString(row.parentLinkId),
      parentDemandId: asNullableString(row.parentDemandId),
      parentSupplyId: asNullableString(row.parentSupplyId),
      path,
      duplicate: Boolean(row.duplicate),
      ...(duplicateReason ? { duplicateReason } : {}),
    });
  }

  for (const [index, row] of readRows(workbook, "partCatalog").entries()) {
    const rowNumber = index + 2;
    const partNumber = asRequiredString(row.partNumber);
    if (!validateRequiredFields({ partNumber }, diagnostics, "partCatalog", rowNumber)) {
      continue;
    }

    const description = asOptionalString(row.description);
    const uom = asOptionalString(row.uom);
    const part: PartCatalogItem = {
      partNumber: partNumber!,
    };
    if (description !== undefined) {
      part.description = description;
    }
    if (uom !== undefined) {
      part.uom = uom;
    }
    partCatalog.push(part);
  }

  return {
    datasets: {
      salesOrders,
      assemblies,
      demands,
      supplies,
      operations,
      peggingLinks,
      partCatalog,
    },
    worksheetNames: workbook.SheetNames,
  };
}
