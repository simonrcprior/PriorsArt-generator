import { DatePolicy } from "../model/types";
export interface ExportProgressUpdate {
    stage: string;
    progress: number;
    detail?: string;
}
export interface ExportXlsxOptions {
    from: "xml" | "priorsart";
    inputFile: string;
    outputFile: string;
    datePolicy: DatePolicy;
    xmlConfigFile?: string;
    onProgress?: (update: ExportProgressUpdate) => void;
}
export interface ExportXlsxResult {
    outputFile: string;
    rowCount: number;
    qualitySummary: {
        warnings: number;
        errors: number;
        droppedRows: number;
        ambiguousDateCount: number;
        invalidDateCount: number;
        nestLevelCounts?: Record<string, number>;
    };
    sourceSummary: string;
}
export declare function exportFlattenedXlsx(options: ExportXlsxOptions): Promise<ExportXlsxResult>;
//# sourceMappingURL=exportXlsx.d.ts.map