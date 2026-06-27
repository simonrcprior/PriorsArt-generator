import { CanonicalDatasets } from "../model/types";
import { XmlSourceTables } from "../adapters/xml/readXmlCanonical";
export interface FlattenedXlsxProgressUpdate {
    stage: string;
    progress: number;
    detail?: string;
}
export type FlattenedXlsxProgressReporter = (update: FlattenedXlsxProgressUpdate) => void;
export interface ProcessedLayoutRow {
    LineID?: number;
    Company?: string;
    topPNum?: string;
    topOrderNum?: string;
    topLine?: string;
    topRel?: string;
    topQty?: number;
    topDate?: number | null;
    nest?: number;
    nestText?: string;
    thisPNum?: string;
    thisDesc?: string;
    thisOrderNum?: string;
    thisLine?: string;
    thisRel?: string;
    thisQty?: number;
    ThisOrderNum?: string | null | undefined;
    ThisLine?: string;
    ThisRel?: string | null | undefined;
    ThisQty?: number;
    thisPeggedQty?: number;
    thisDate?: number | null;
    thisType?: string;
    DemandSeq?: number | string;
    SupplySeq?: number | string;
    dmdDate?: number | null;
    rowsSince1?: number;
    duplicate?: boolean;
    myNestedBOM?: string;
    PORel_PromiseDt?: number | null;
    JobHead_CommitDate_c?: number | null | undefined;
    earliestN?: number | null;
    RemainingOps?: string | null | undefined;
    RemainingOpsh?: string | null | undefined;
    MinDue?: number | null | undefined;
    Warning?: string;
    myText1?: string;
    myText2?: string;
    myText3?: string;
    myText4?: string;
    myText5?: string;
    LeadFromTimePhase?: number;
    willShip?: number | null;
    willShipText?: string;
    OrderBy?: number | null;
}
export declare function writeFlattenedXlsx(outputFile: string, datasets: CanonicalDatasets, progress?: FlattenedXlsxProgressReporter): Promise<number>;
export declare function buildRowsFromXmlSource(tables: XmlSourceTables, progress?: FlattenedXlsxProgressReporter): ProcessedLayoutRow[];
export declare function writeFlattenedXlsxFromXmlSource(outputFile: string, tables: XmlSourceTables, progress?: FlattenedXlsxProgressReporter): Promise<{
    rowCount: number;
    outputFile: string;
}>;
//# sourceMappingURL=writeFlattenedXlsx.d.ts.map