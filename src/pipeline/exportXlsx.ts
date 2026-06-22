import path from "node:path";
import { readXmlCanonical, readXmlSourceTables } from "../adapters/xml/readXmlCanonical";
import { DiagnosticCollector } from "../diagnostics/collector";
import { DatePolicy } from "../model/types";
import { validateCanonical } from "../model/validation";
import { readPriorsartPackage } from "../package/readPriorsartPackage";
import { writeFlattenedXlsx, writeFlattenedXlsxFromXmlSource } from "../export/writeFlattenedXlsx";

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

export async function exportFlattenedXlsx(options: ExportXlsxOptions): Promise<ExportXlsxResult> {
  if (path.extname(options.outputFile).toLowerCase() !== ".xlsx") {
    throw new Error("Output file must use the .xlsx extension");
  }

  if (options.from === "xml") {
    const diagnostics = new DiagnosticCollector();
    options.onProgress?.({ stage: "Reading XML source tables", progress: 35 });
    const tables = await readXmlSourceTables(options.inputFile, diagnostics, options.xmlConfigFile);

    options.onProgress?.({ stage: "Reading XML canonical data", progress: 45 });
    const { datasets, fileNames } = await readXmlCanonical(options.inputFile, options.datePolicy, diagnostics, options.xmlConfigFile);

    options.onProgress?.({ stage: "Validating canonical data", progress: 55 });
    validateCanonical(datasets, diagnostics);

    options.onProgress?.({ stage: "Writing XLSX workbook", progress: 70 });
    const result = await writeFlattenedXlsxFromXmlSource(options.outputFile, tables, options.onProgress);

    const quality = diagnostics.toQualityReport();
    return {
      outputFile: result.outputFile,
      rowCount: result.rowCount,
      qualitySummary: {
        warnings: quality.warnings.length,
        errors: quality.errors.length,
        droppedRows: quality.droppedRows,
        ambiguousDateCount: quality.ambiguousDateCount,
        invalidDateCount: quality.invalidDateCount,
        nestLevelCounts: quality.nestLevelCounts,
      },
      sourceSummary: `xml:${fileNames.join(",")}`,
    };
  }

  const pkg = await readPriorsartPackage(options.inputFile);
  options.onProgress?.({ stage: "Writing workbook", progress: 70 });
  const rowCount = await writeFlattenedXlsx(options.outputFile, pkg.datasets, options.onProgress);

  return {
    outputFile: options.outputFile,
    rowCount,
    qualitySummary: pkg.manifest.qualitySummary,
    sourceSummary: "priorsart",
  };
}
