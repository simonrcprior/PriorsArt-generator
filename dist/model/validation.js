"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.validateCanonical = validateCanonical;
const zod_1 = require("zod");
const salesOrderSchema = zod_1.z.object({
    id: zod_1.z.string().min(1),
    orderNumber: zod_1.z.string().min(1),
    partNumber: zod_1.z.string().min(1),
    quantity: zod_1.z.number().nonnegative(),
    dueDate: zod_1.z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});
const assemblySchema = zod_1.z.object({
    id: zod_1.z.string().min(1),
    partNumber: zod_1.z.string().min(1),
    orderId: zod_1.z.string().min(1),
    quantity: zod_1.z.number().nonnegative(),
});
const demandSchema = zod_1.z.object({
    id: zod_1.z.string().min(1),
    partNumber: zod_1.z.string().min(1),
    quantity: zod_1.z.number().nonnegative(),
    dueDate: zod_1.z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    sourceType: zod_1.z.enum(["SO", "ASM", "MANUAL"]),
    sourceId: zod_1.z.string().min(1).optional(),
});
const supplySchema = zod_1.z.object({
    id: zod_1.z.string().min(1),
    partNumber: zod_1.z.string().min(1),
    quantity: zod_1.z.number().nonnegative(),
    availableDate: zod_1.z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    supplyType: zod_1.z.enum(["PO", "WO", "ON_HAND"]),
    sourceId: zod_1.z.string().min(1).optional(),
});
const operationSchema = zod_1.z.object({
    id: zod_1.z.string().min(1),
    assemblyId: zod_1.z.string().min(1),
    operationCode: zod_1.z.string().min(1),
    workCenter: zod_1.z.string().min(1),
    hours: zod_1.z.number().nonnegative(),
});
const peggingSchema = zod_1.z.object({
    id: zod_1.z.string().min(1),
    demandId: zod_1.z.string().min(1),
    supplyId: zod_1.z.string().min(1),
    quantity: zod_1.z.number().nonnegative(),
    nest: zod_1.z.number().int().min(1),
    nestText: zod_1.z.string().optional(),
    parentLinkId: zod_1.z.string().min(1).nullable(),
    parentDemandId: zod_1.z.string().min(1).nullable(),
    parentSupplyId: zod_1.z.string().min(1).nullable(),
    path: zod_1.z.array(zod_1.z.string().min(1)),
    duplicate: zod_1.z.boolean(),
    duplicateReason: zod_1.z.string().optional(),
});
function parseSalesOrderSourceId(sourceId) {
    if (!sourceId) {
        return { orderNum: "", line: "", rel: "" };
    }
    const match = sourceId.match(/^SO-(.+)-([^\-]+)-([^\-]+)$/);
    if (!match) {
        return { orderNum: sourceId, line: "", rel: "" };
    }
    return {
        orderNum: match[1] ?? "",
        line: match[2] ?? "",
        rel: match[3] ?? "",
    };
}
const partSchema = zod_1.z.object({
    partNumber: zod_1.z.string().min(1),
    description: zod_1.z.string().optional(),
    uom: zod_1.z.string().optional(),
});
function checkDuplicates(values, diagnostics, dataset, key) {
    const seen = new Set();
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
function validateCanonical(datasets, diagnostics) {
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
    const demandById = new Map(datasets.demands.map((row) => [row.id, row]));
    const supplyById = new Map(datasets.supplies.map((row) => [row.id, row]));
    const linkById = new Map(datasets.peggingLinks.map((row) => [row.id, row]));
    const nestLevelCounts = new Map();
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
        if (!Number.isInteger(row.nest) || row.nest < 1) {
            diagnostics.error({
                code: "PEGGING_NEST_INVALID",
                message: `Pegging link '${row.id}' has invalid nest '${String(row.nest)}'`,
                dataset: "peggingLinks",
            });
        }
        else {
            nestLevelCounts.set(row.nest, (nestLevelCounts.get(row.nest) ?? 0) + 1);
        }
        if (!Array.isArray(row.path) || row.path.length === 0) {
            diagnostics.error({
                code: "PEGGING_PATH_INVALID",
                message: `Pegging link '${row.id}' must include a non-empty path`,
                dataset: "peggingLinks",
            });
        }
        else {
            const last = row.path[row.path.length - 1];
            if (last !== row.id) {
                diagnostics.error({
                    code: "PEGGING_PATH_TAIL_MISMATCH",
                    message: `Pegging link '${row.id}' path must end with the link id`,
                    dataset: "peggingLinks",
                });
            }
            if (row.nest >= 1 && row.path.length !== row.nest) {
                diagnostics.error({
                    code: "PEGGING_PATH_NEST_MISMATCH",
                    message: `Pegging link '${row.id}' has nest=${row.nest} but path length=${row.path.length}`,
                    dataset: "peggingLinks",
                });
            }
        }
        if (row.parentLinkId) {
            const parent = linkById.get(row.parentLinkId);
            if (!parent) {
                diagnostics.error({
                    code: "FK_PEGGING_PARENT_LINK",
                    message: `Pegging link '${row.id}' references missing parentLinkId '${row.parentLinkId}'`,
                    dataset: "peggingLinks",
                });
            }
            else {
                if (row.parentDemandId !== parent.demandId) {
                    diagnostics.error({
                        code: "FK_PEGGING_PARENT_DEMAND",
                        message: `Pegging link '${row.id}' parentDemandId '${String(row.parentDemandId)}' does not match parent demand '${parent.demandId}'`,
                        dataset: "peggingLinks",
                    });
                }
                if (row.parentSupplyId !== parent.supplyId) {
                    diagnostics.error({
                        code: "FK_PEGGING_PARENT_SUPPLY",
                        message: `Pegging link '${row.id}' parentSupplyId '${String(row.parentSupplyId)}' does not match parent supply '${parent.supplyId}'`,
                        dataset: "peggingLinks",
                    });
                }
            }
        }
        else if (row.nest !== 1) {
            diagnostics.error({
                code: "PEGGING_ROOT_NEST_INVALID",
                message: `Pegging link '${row.id}' has no parentLinkId and must have nest=1`,
                dataset: "peggingLinks",
            });
        }
        const demand = demandById.get(row.demandId);
        if (row.nest === 1 && (!demand || demand.sourceType !== "SO" || !demand.sourceId)) {
            diagnostics.warn({
                code: "LOB_ROOT_NO_SO_ANCHOR",
                message: `Root pegging link '${row.id}' is not anchored to an SO demand source`,
                dataset: "peggingLinks",
            });
        }
        if (row.duplicate && (!row.duplicateReason || !row.duplicateReason.trim())) {
            diagnostics.error({
                code: "PEGGING_DUPLICATE_REASON_MISSING",
                message: `Pegging link '${row.id}' is marked duplicate but missing duplicateReason`,
                dataset: "peggingLinks",
            });
        }
        if (!row.duplicate && row.duplicateReason && row.duplicateReason.trim()) {
            diagnostics.warn({
                code: "PEGGING_DUPLICATE_REASON_IGNORED",
                message: `Pegging link '${row.id}' has duplicateReason but duplicate=false`,
                dataset: "peggingLinks",
            });
        }
    });
    const duplicateLikeGroups = new Map();
    for (const link of datasets.peggingLinks) {
        const demand = demandById.get(link.demandId);
        const supply = supplyById.get(link.supplyId);
        const so = parseSalesOrderSourceId(demand?.sourceId);
        const signature = [
            demand?.partNumber ?? "",
            so.orderNum,
            so.line,
            so.rel,
            String(link.nest),
            supply?.partNumber ?? "",
            supply?.availableDate ?? "",
            String(link.quantity),
        ].join("|");
        const group = duplicateLikeGroups.get(signature);
        if (group) {
            group.push(link);
        }
        else {
            duplicateLikeGroups.set(signature, [link]);
        }
    }
    for (const group of duplicateLikeGroups.values()) {
        if (group.length <= 1) {
            continue;
        }
        const flagged = group.some((row) => row.duplicate);
        if (!flagged) {
            diagnostics.error({
                code: "PEGGING_DUPLICATE_LIKE_UNFLAGGED",
                message: `Detected duplicate-like pegging group (${group.length} rows) without duplicate metadata`,
                dataset: "peggingLinks",
            });
        }
    }
    if (datasets.peggingLinks.length > 0) {
        const allNestOne = datasets.peggingLinks.every((row) => row.nest === 1);
        if (allNestOne) {
            diagnostics.error({
                code: "PEGGING_ALL_NEST_ONE",
                message: "All pegging links have nest=1. This indicates flattened hierarchy output and fails contract parity.",
                dataset: "peggingLinks",
            });
        }
        const allPathEmpty = datasets.peggingLinks.every((row) => !Array.isArray(row.path) || row.path.length === 0);
        if (allPathEmpty) {
            diagnostics.error({
                code: "PEGGING_ALL_PATH_EMPTY",
                message: "All pegging links have empty path. Hierarchy lineage is missing.",
                dataset: "peggingLinks",
            });
        }
        const allWithoutParent = datasets.peggingLinks.every((row) => !row.parentLinkId);
        if (allWithoutParent) {
            diagnostics.error({
                code: "PEGGING_ALL_NO_PARENT",
                message: "All pegging links have null parentLinkId. Hierarchy parent chain is missing.",
                dataset: "peggingLinks",
            });
        }
        const rootRows = datasets.peggingLinks.filter((row) => row.nest === 1);
        const rootMissingSoAnchor = rootRows.filter((row) => {
            const demand = demandById.get(row.demandId);
            return !demand || demand.sourceType !== "SO" || !demand.sourceId;
        }).length;
        if (rootMissingSoAnchor > 0) {
            const ratio = rootRows.length > 0 ? rootMissingSoAnchor / rootRows.length : 0;
            const message = `Detected ${rootMissingSoAnchor} root pegging rows without SO anchor out of ${rootRows.length} roots (${(ratio * 100).toFixed(1)}%).`;
            if (ratio >= 0.25) {
                diagnostics.error({
                    code: "LOB_ROOT_SO_ANCHOR_MISSING_HIGH",
                    message,
                    dataset: "peggingLinks",
                });
            }
            else {
                diagnostics.warn({
                    code: "LOB_ROOT_SO_ANCHOR_MISSING",
                    message,
                    dataset: "peggingLinks",
                });
            }
        }
    }
    diagnostics.setNestLevelCounts([...nestLevelCounts.entries()]
        .sort((a, b) => a[0] - b[0])
        .reduce((acc, [nest, count]) => {
        acc[String(nest)] = count;
        return acc;
    }, {}));
    datasets.demands.forEach((row) => {
        if (row.sourceType === "SO" && !row.sourceId) {
            diagnostics.error({
                code: "DEMAND_SO_SOURCE_MISSING",
                message: `Demand '${row.id}' has sourceType SO but empty sourceId`,
                dataset: "demands",
            });
        }
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
//# sourceMappingURL=validation.js.map