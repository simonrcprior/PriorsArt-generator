import { z } from "zod";
import { CanonicalDatasets } from "./types";
import { DiagnosticCollector } from "../diagnostics/collector";

const salesOrderSchema = z.object({
  id: z.string().min(1),
  orderNumber: z.string().min(1),
  partNumber: z.string().min(1),
  quantity: z.number().nonnegative(),
  dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});

const assemblySchema = z.object({
  id: z.string().min(1),
  partNumber: z.string().min(1),
  orderId: z.string().min(1),
  quantity: z.number().nonnegative(),
});

const demandSchema = z.object({
  id: z.string().min(1),
  partNumber: z.string().min(1),
  quantity: z.number().nonnegative(),
  dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  sourceType: z.enum(["SO", "ASM", "MANUAL"]),
  sourceId: z.string().min(1).optional(),
});

const supplySchema = z.object({
  id: z.string().min(1),
  partNumber: z.string().min(1),
  quantity: z.number().nonnegative(),
  availableDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  supplyType: z.enum(["PO", "WO", "ON_HAND"]),
  sourceId: z.string().min(1).optional(),
});

const operationSchema = z.object({
  id: z.string().min(1),
  assemblyId: z.string().min(1),
  operationCode: z.string().min(1),
  workCenter: z.string().min(1),
  hours: z.number().nonnegative(),
});

const peggingSchema = z.object({
  id: z.string().min(1),
  demandId: z.string().min(1),
  supplyId: z.string().min(1),
  quantity: z.number().nonnegative(),
});

const partSchema = z.object({
  partNumber: z.string().min(1),
  description: z.string().optional(),
  uom: z.string().optional(),
});

function checkDuplicates(
  values: string[],
  diagnostics: DiagnosticCollector,
  dataset: string,
  key: string
): void {
  const seen = new Set<string>();
  for (const value of values) {
    if (seen.has(value)) {
      diagnostics.error({
        code: "DUPLICATE_ID",
        message: `Duplicate ${key} '${value}' in ${dataset}`,
        dataset,
        field: key,
      });
      continue;
    }
    seen.add(value);
  }
}

export function validateCanonical(datasets: CanonicalDatasets, diagnostics: DiagnosticCollector): void {
  datasets.salesOrders.forEach((row, idx) => {
    const parsed = salesOrderSchema.safeParse(row);
    if (!parsed.success) {
      diagnostics.error({
        code: "VALIDATION_SALES_ORDER",
        message: parsed.error.issues.map((i) => i.message).join("; "),
        dataset: "salesOrders",
        row: idx + 2,
      });
    }
  });

  datasets.assemblies.forEach((row, idx) => {
    const parsed = assemblySchema.safeParse(row);
    if (!parsed.success) {
      diagnostics.error({
        code: "VALIDATION_ASSEMBLY",
        message: parsed.error.issues.map((i) => i.message).join("; "),
        dataset: "assemblies",
        row: idx + 2,
      });
    }
  });

  datasets.demands.forEach((row, idx) => {
    const parsed = demandSchema.safeParse(row);
    if (!parsed.success) {
      diagnostics.error({
        code: "VALIDATION_DEMAND",
        message: parsed.error.issues.map((i) => i.message).join("; "),
        dataset: "demands",
        row: idx + 2,
      });
    }
  });

  datasets.supplies.forEach((row, idx) => {
    const parsed = supplySchema.safeParse(row);
    if (!parsed.success) {
      diagnostics.error({
        code: "VALIDATION_SUPPLY",
        message: parsed.error.issues.map((i) => i.message).join("; "),
        dataset: "supplies",
        row: idx + 2,
      });
    }
  });

  datasets.operations.forEach((row, idx) => {
    const parsed = operationSchema.safeParse(row);
    if (!parsed.success) {
      diagnostics.error({
        code: "VALIDATION_OPERATION",
        message: parsed.error.issues.map((i) => i.message).join("; "),
        dataset: "operations",
        row: idx + 2,
      });
    }
  });

  datasets.peggingLinks.forEach((row, idx) => {
    const parsed = peggingSchema.safeParse(row);
    if (!parsed.success) {
      diagnostics.error({
        code: "VALIDATION_PEGGING",
        message: parsed.error.issues.map((i) => i.message).join("; "),
        dataset: "peggingLinks",
        row: idx + 2,
      });
    }
  });

  datasets.partCatalog.forEach((row, idx) => {
    const parsed = partSchema.safeParse(row);
    if (!parsed.success) {
      diagnostics.error({
        code: "VALIDATION_PART",
        message: parsed.error.issues.map((i) => i.message).join("; "),
        dataset: "partCatalog",
        row: idx + 2,
      });
    }
  });

  checkDuplicates(datasets.salesOrders.map((r) => r.id), diagnostics, "salesOrders", "id");
  checkDuplicates(datasets.assemblies.map((r) => r.id), diagnostics, "assemblies", "id");
  checkDuplicates(datasets.demands.map((r) => r.id), diagnostics, "demands", "id");
  checkDuplicates(datasets.supplies.map((r) => r.id), diagnostics, "supplies", "id");
  checkDuplicates(datasets.operations.map((r) => r.id), diagnostics, "operations", "id");
  checkDuplicates(datasets.peggingLinks.map((r) => r.id), diagnostics, "peggingLinks", "id");
  checkDuplicates(datasets.partCatalog.map((r) => r.partNumber), diagnostics, "partCatalog", "partNumber");

  const salesOrderIds = new Set(datasets.salesOrders.map((r) => r.id));
  const assemblyIds = new Set(datasets.assemblies.map((r) => r.id));
  const demandIds = new Set(datasets.demands.map((r) => r.id));
  const supplyIds = new Set(datasets.supplies.map((r) => r.id));

  datasets.assemblies.forEach((row) => {
    if (!salesOrderIds.has(row.orderId)) {
      diagnostics.error({
        code: "FK_ASSEMBLY_ORDER",
        message: `Assembly '${row.id}' references missing salesOrder '${row.orderId}'`,
        dataset: "assemblies",
      });
    }
  });

  datasets.operations.forEach((row) => {
    if (!assemblyIds.has(row.assemblyId)) {
      diagnostics.error({
        code: "FK_OPERATION_ASSEMBLY",
        message: `Operation '${row.id}' references missing assembly '${row.assemblyId}'`,
        dataset: "operations",
      });
    }
  });

  datasets.peggingLinks.forEach((row) => {
    if (!demandIds.has(row.demandId)) {
      diagnostics.error({
        code: "FK_PEGGING_DEMAND",
        message: `Pegging link '${row.id}' references missing demand '${row.demandId}'`,
        dataset: "peggingLinks",
      });
    }
    if (!supplyIds.has(row.supplyId)) {
      diagnostics.error({
        code: "FK_PEGGING_SUPPLY",
        message: `Pegging link '${row.id}' references missing supply '${row.supplyId}'`,
        dataset: "peggingLinks",
      });
    }
  });

  datasets.demands.forEach((row) => {
    if (row.sourceType === "SO" && row.sourceId && !salesOrderIds.has(row.sourceId)) {
      diagnostics.error({
        code: "FK_DEMAND_SO",
        message: `Demand '${row.id}' references missing salesOrder '${row.sourceId}'`,
        dataset: "demands",
      });
    }
    if (row.sourceType === "ASM" && row.sourceId && !assemblyIds.has(row.sourceId)) {
      diagnostics.error({
        code: "FK_DEMAND_ASM",
        message: `Demand '${row.id}' references missing assembly '${row.sourceId}'`,
        dataset: "demands",
      });
    }
  });
}
