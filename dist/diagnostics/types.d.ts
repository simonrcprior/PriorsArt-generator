export type DiagnosticSeverity = "warning" | "error";
export interface DiagnosticIssue {
    code: string;
    message: string;
    severity: DiagnosticSeverity;
    dataset?: string;
    row?: number;
    field?: string;
}
export interface QualityReport {
    warnings: DiagnosticIssue[];
    errors: DiagnosticIssue[];
    droppedRows: number;
    ambiguousDateCount: number;
    invalidDateCount: number;
    nestLevelCounts: Record<string, number>;
}
//# sourceMappingURL=types.d.ts.map