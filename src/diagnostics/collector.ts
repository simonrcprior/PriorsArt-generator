import { DiagnosticIssue, QualityReport } from "./types";

export class DiagnosticCollector {
  private readonly warnings: DiagnosticIssue[] = [];
  private readonly errors: DiagnosticIssue[] = [];
  private droppedRows = 0;
  private ambiguousDateCount = 0;
  private invalidDateCount = 0;
  private nestLevelCounts: Record<string, number> = {};

  warn(issue: Omit<DiagnosticIssue, "severity">): void {
    this.warnings.push({ ...issue, severity: "warning" });
  }

  error(issue: Omit<DiagnosticIssue, "severity">): void {
    this.errors.push({ ...issue, severity: "error" });
  }

  incrementDroppedRows(count = 1): void {
    this.droppedRows += count;
  }

  incrementAmbiguousDate(count = 1): void {
    this.ambiguousDateCount += count;
  }

  incrementInvalidDate(count = 1): void {
    this.invalidDateCount += count;
  }

  setNestLevelCounts(counts: Record<string, number>): void {
    this.nestLevelCounts = { ...counts };
  }

  toQualityReport(): QualityReport {
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
