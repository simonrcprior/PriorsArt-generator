"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.parseDateWithPolicy = parseDateWithPolicy;
const ISO_DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/;
const SLASH_DATE_REGEX = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/;
function toIso(year, month, day) {
    const candidate = new Date(Date.UTC(year, month - 1, day));
    if (candidate.getUTCFullYear() !== year ||
        candidate.getUTCMonth() !== month - 1 ||
        candidate.getUTCDate() !== day) {
        return undefined;
    }
    const mm = `${month}`.padStart(2, "0");
    const dd = `${day}`.padStart(2, "0");
    return `${year}-${mm}-${dd}`;
}
function excelSerialToIso(serial) {
    if (!Number.isFinite(serial) || serial <= 0) {
        return undefined;
    }
    // Excel's day 1 is 1899-12-31 with a known leap-year bug around 1900.
    const wholeDays = Math.floor(serial);
    const base = Date.UTC(1899, 11, 30);
    const millis = wholeDays * 24 * 60 * 60 * 1000;
    const date = new Date(base + millis);
    const year = date.getUTCFullYear();
    const month = date.getUTCMonth() + 1;
    const day = date.getUTCDate();
    return toIso(year, month, day);
}
function parseDateWithPolicy(value, defaultDateOrder, diagnostics, context) {
    if (typeof value === "number") {
        const isoFromSerial = excelSerialToIso(value);
        if (!isoFromSerial) {
            diagnostics.incrementInvalidDate();
            diagnostics.error({
                code: "DATE_INVALID_SERIAL",
                message: `Invalid Excel serial date: ${value}`,
                dataset: context.dataset,
                row: context.row,
                field: context.field,
            });
            return {};
        }
        return { isoDate: isoFromSerial };
    }
    if (typeof value !== "string") {
        diagnostics.incrementInvalidDate();
        diagnostics.error({
            code: "DATE_INVALID_TYPE",
            message: "Date value is not a string or number",
            dataset: context.dataset,
            row: context.row,
            field: context.field,
        });
        return {};
    }
    const trimmed = value.trim();
    if (!trimmed) {
        diagnostics.incrementInvalidDate();
        diagnostics.error({
            code: "DATE_EMPTY",
            message: "Date value is empty",
            dataset: context.dataset,
            row: context.row,
            field: context.field,
        });
        return {};
    }
    if (ISO_DATE_REGEX.test(trimmed)) {
        const parts = trimmed.split("-");
        const yyyy = Number(parts[0]);
        const mm = Number(parts[1]);
        const dd = Number(parts[2]);
        if (!Number.isFinite(yyyy) || !Number.isFinite(mm) || !Number.isFinite(dd)) {
            diagnostics.incrementInvalidDate();
            diagnostics.error({
                code: "DATE_INVALID_ISO",
                message: `Invalid ISO date: ${trimmed}`,
                dataset: context.dataset,
                row: context.row,
                field: context.field,
            });
            return {};
        }
        const iso = toIso(yyyy, mm, dd);
        if (!iso) {
            diagnostics.incrementInvalidDate();
            diagnostics.error({
                code: "DATE_INVALID_ISO",
                message: `Invalid ISO date: ${trimmed}`,
                dataset: context.dataset,
                row: context.row,
                field: context.field,
            });
            return {};
        }
        return { isoDate: iso };
    }
    const slashMatch = trimmed.match(SLASH_DATE_REGEX);
    if (!slashMatch) {
        diagnostics.incrementInvalidDate();
        diagnostics.error({
            code: "DATE_UNSUPPORTED_FORMAT",
            message: `Unsupported date format: ${trimmed}`,
            dataset: context.dataset,
            row: context.row,
            field: context.field,
        });
        return {};
    }
    const first = Number(slashMatch[1]);
    const second = Number(slashMatch[2]);
    const year = Number(slashMatch[3]);
    const isAmbiguous = first <= 12 && second <= 12 && first !== second;
    if (isAmbiguous) {
        diagnostics.incrementAmbiguousDate();
        diagnostics.warn({
            code: "DATE_AMBIGUOUS_RESOLVED",
            message: `Ambiguous date '${trimmed}' resolved with policy ${defaultDateOrder}`,
            dataset: context.dataset,
            row: context.row,
            field: context.field,
        });
    }
    let month;
    let day;
    if (defaultDateOrder === "MDY") {
        month = first;
        day = second;
    }
    else if (defaultDateOrder === "DMY") {
        day = first;
        month = second;
    }
    else {
        diagnostics.incrementInvalidDate();
        diagnostics.error({
            code: "DATE_POLICY_MISMATCH",
            message: `Date policy ${defaultDateOrder} does not support slash format input '${trimmed}'`,
            dataset: context.dataset,
            row: context.row,
            field: context.field,
        });
        return {};
    }
    const iso = toIso(year, month, day);
    if (!iso) {
        diagnostics.incrementInvalidDate();
        diagnostics.error({
            code: "DATE_INVALID_VALUE",
            message: `Invalid date value: ${trimmed}`,
            dataset: context.dataset,
            row: context.row,
            field: context.field,
        });
        return {};
    }
    return { isoDate: iso };
}
//# sourceMappingURL=datePolicy.js.map