"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.DiagnosticCollector = void 0;
class DiagnosticCollector {
    constructor() {
        this.warnings = [];
        this.errors = [];
        this.droppedRows = 0;
        this.ambiguousDateCount = 0;
        this.invalidDateCount = 0;
        this.nestLevelCounts = {};
    }
    warn(issue) {
        this.warnings.push({ ...issue, severity: "warning" });
    }
    error(issue) {
        this.errors.push({ ...issue, severity: "error" });
    }
    incrementDroppedRows(count = 1) {
        this.droppedRows += count;
    }
    incrementAmbiguousDate(count = 1) {
        this.ambiguousDateCount += count;
    }
    incrementInvalidDate(count = 1) {
        this.invalidDateCount += count;
    }
    setNestLevelCounts(counts) {
        this.nestLevelCounts = { ...counts };
    }
    toQualityReport() {
        return {
            warnings: this.warnings,
            errors: this.errors,
            droppedRows: this.droppedRows,
            ambiguousDateCount: this.ambiguousDateCount,
            invalidDateCount: this.invalidDateCount,
            nestLevelCounts: { ...this.nestLevelCounts },
        };
    }
}
exports.DiagnosticCollector = DiagnosticCollector;
//# sourceMappingURL=collector.js.map