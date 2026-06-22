import { DiagnosticCollector } from "../../diagnostics/collector";
import { CanonicalDatasets, DatePolicy } from "../../model/types";
interface XlsxReadResult {
    datasets: CanonicalDatasets;
    worksheetNames: string[];
}
export declare function readXlsxCanonical(inputFile: string, datePolicy: DatePolicy, diagnostics: DiagnosticCollector): XlsxReadResult;
export {};
//# sourceMappingURL=readXlsxCanonical.d.ts.map