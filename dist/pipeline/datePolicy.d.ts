import { DateOrder } from "../model/types";
import { DiagnosticCollector } from "../diagnostics/collector";
export interface DateParseResult {
    isoDate?: string;
}
export declare function parseDateWithPolicy(value: unknown, defaultDateOrder: DateOrder, diagnostics: DiagnosticCollector, context: {
    dataset: string;
    row: number;
    field: string;
}): DateParseResult;
//# sourceMappingURL=datePolicy.d.ts.map