import { DiagnosticIssue, QualityReport } from "./types";
export declare class DiagnosticCollector {
    private readonly warnings;
    private readonly errors;
    private droppedRows;
    private ambiguousDateCount;
    private invalidDateCount;
    private nestLevelCounts;
    warn(issue: Omit<DiagnosticIssue, "severity">): void;
    error(issue: Omit<DiagnosticIssue, "severity">): void;
    incrementDroppedRows(count?: number): void;
    incrementAmbiguousDate(count?: number): void;
    incrementInvalidDate(count?: number): void;
    setNestLevelCounts(counts: Record<string, number>): void;
    toQualityReport(): QualityReport;
}
//# sourceMappingURL=collector.d.ts.map