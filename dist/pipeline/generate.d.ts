import { CanonicalPackage, DatePolicy } from "../model/types";
export interface GenerateOptions {
    inputFile: string;
    outputFile: string;
    datePolicy: DatePolicy;
    xmlConfigFile?: string;
}
export declare function generateFromXlsx(options: GenerateOptions): Promise<CanonicalPackage>;
export declare function generateFromXml(options: GenerateOptions): Promise<CanonicalPackage>;
//# sourceMappingURL=generate.d.ts.map