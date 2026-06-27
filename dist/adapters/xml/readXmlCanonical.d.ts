import { DiagnosticCollector } from "../../diagnostics/collector";
import { CanonicalDatasets, DatePolicy } from "../../model/types";
interface XmlReadResult {
    datasets: CanonicalDatasets;
    fileNames: string[];
    sourceTables: XmlSourceTables;
}
export type XmlRow = Record<string, unknown>;
export type XmlFileKey = "demands" | "jobs" | "links" | "poDetails" | "supplies" | "partDescriptions";
export interface XmlSourceTables {
    basePath: string;
    rowsByFile: Record<XmlFileKey, XmlRow[]>;
    fileNames: string[];
}
export declare function readXmlCanonical(inputPath: string, datePolicy: DatePolicy, diagnostics: DiagnosticCollector, xmlConfigPath?: string): Promise<XmlReadResult>;
export declare function readXmlSourceTables(inputPath: string, diagnostics: DiagnosticCollector, xmlConfigPath?: string): Promise<XmlSourceTables>;
export {};
//# sourceMappingURL=readXmlCanonical.d.ts.map