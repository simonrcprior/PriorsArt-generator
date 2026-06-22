import path from "node:path";
import { readXlsxCanonical } from "../adapters/xlsx/readXlsxCanonical";
import { readXmlCanonical } from "../adapters/xml/readXmlCanonical";
import { DiagnosticCollector } from "../diagnostics/collector";
import {
  CanonicalDatasets,
  CanonicalIndexes,
  CanonicalPackage,
  DatePolicy,
  PriorsartManifest,
  SourceMetadata,
} from "../model/types";
import { validateCanonical } from "../model/validation";
import { writePriorsartPackage } from "../package/writePriorsartPackage";

function buildIndexes(datasets: CanonicalDatasets): CanonicalIndexes {
  return {
    salesOrdersById: datasets.salesOrders.map((r) => r.id),
    assembliesById: datasets.assemblies.map((r) => r.id),
    demandsById: datasets.demands.map((r) => r.id),
    suppliesById: datasets.supplies.map((r) => r.id),
    operationsById: datasets.operations.map((r) => r.id),
    peggingLinksById: datasets.peggingLinks.map((r) => r.id),
    partNumbers: datasets.partCatalog.map((r) => r.partNumber),
  };
}

function countDatasets(datasets: CanonicalDatasets): PriorsartManifest["counts"] {
  return {
    salesOrders: datasets.salesOrders.length,
    assemblies: datasets.assemblies.length,
    demands: datasets.demands.length,
    supplies: datasets.supplies.length,
    operations: datasets.operations.length,
    peggingLinks: datasets.peggingLinks.length,
    partCatalog: datasets.partCatalog.length,
  };
}

export interface GenerateOptions {
  inputFile: string;
  outputFile: string;
  datePolicy: DatePolicy;
  xmlConfigFile?: string;
}

async function finalizePackage(
  datasets: CanonicalDatasets,
  source: SourceMetadata,
  options: GenerateOptions,
  diagnostics: DiagnosticCollector
): Promise<CanonicalPackage> {
  validateCanonical(datasets, diagnostics);

  const quality = diagnostics.toQualityReport();
  const manifest: PriorsartManifest = {
    packageVersion: "1.0.0",
    schemaVersion: "3",
    generatedAt: new Date().toISOString(),
    source,
    datePolicy: options.datePolicy,
    counts: countDatasets(datasets),
    qualitySummary: {
      warnings: quality.warnings.length,
      errors: quality.errors.length,
      droppedRows: quality.droppedRows,
      ambiguousDateCount: quality.ambiguousDateCount,
      invalidDateCount: quality.invalidDateCount,
      nestLevelCounts: quality.nestLevelCounts,
    },
  };

  const pkg: CanonicalPackage = {
    manifest,
    datasets,
    indexes: buildIndexes(datasets),
    quality,
  };

  await writePriorsartPackage(options.outputFile, pkg);
  return pkg;
}

export async function generateFromXlsx(options: GenerateOptions): Promise<CanonicalPackage> {
  const diagnostics = new DiagnosticCollector();
  const { datasets, worksheetNames } = readXlsxCanonical(options.inputFile, options.datePolicy, diagnostics);

  return finalizePackage(
    datasets,
    {
      type: "xlsx",
      inputFile: path.basename(options.inputFile),
      worksheetNames,
    },
    options,
    diagnostics
  );
}

export async function generateFromXml(options: GenerateOptions): Promise<CanonicalPackage> {
  const diagnostics = new DiagnosticCollector();
  const { datasets, fileNames } = await readXmlCanonical(
    options.inputFile,
    options.datePolicy,
    diagnostics,
    options.xmlConfigFile
  );

  return finalizePackage(
    datasets,
    {
      type: "xml",
      inputPath: options.inputFile,
      fileNames,
      ...(options.xmlConfigFile ? { configFile: options.xmlConfigFile } : {}),
    },
    options,
    diagnostics
  );
}
