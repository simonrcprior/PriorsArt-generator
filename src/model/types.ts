import { QualityReport } from "../diagnostics/types";

export type DateOrder = "MDY" | "DMY" | "YMD";

export interface DatePolicy {
  defaultDateOrder: DateOrder;
}

export interface SalesOrder {
  id: string;
  orderNumber: string;
  partNumber: string;
  quantity: number;
  dueDate: string;
}

export interface Assembly {
  id: string;
  partNumber: string;
  orderId: string;
  quantity: number;
}

export interface Demand {
  id: string;
  partNumber: string;
  quantity: number;
  dueDate: string;
  sourceType: "SO" | "ASM" | "MANUAL";
  sourceId?: string;
}

export interface Supply {
  id: string;
  partNumber: string;
  quantity: number;
  availableDate: string;
  supplyType: "PO" | "WO" | "ON_HAND";
  reportDate?: string;
  sourceId?: string;
}

export interface Operation {
  id: string;
  assemblyId: string;
  operationCode: string;
  workCenter: string;
  hours: number;
}

export interface PeggingLink {
  id: string;
  demandId: string;
  supplyId: string;
  quantity: number;
}

export interface PartCatalogItem {
  partNumber: string;
  description?: string;
  uom?: string;
  lead?: number;
}

export interface CanonicalDatasets {
  salesOrders: SalesOrder[];
  assemblies: Assembly[];
  demands: Demand[];
  supplies: Supply[];
  operations: Operation[];
  peggingLinks: PeggingLink[];
  partCatalog: PartCatalogItem[];
}

export interface CanonicalIndexes {
  salesOrdersById: string[];
  assembliesById: string[];
  demandsById: string[];
  suppliesById: string[];
  operationsById: string[];
  peggingLinksById: string[];
  partNumbers: string[];
}

export interface XlsxSourceMetadata {
  type: "xlsx";
  inputFile: string;
  worksheetNames: string[];
}

export interface XmlSourceMetadata {
  type: "xml";
  inputPath: string;
  fileNames: string[];
  configFile?: string;
}

export type SourceMetadata = XlsxSourceMetadata | XmlSourceMetadata;

export interface PriorsartManifest {
  packageVersion: "1.0.0";
  schemaVersion: "1";
  generatedAt: string;
  source: SourceMetadata;
  datePolicy: DatePolicy;
  counts: Record<keyof CanonicalDatasets, number>;
  qualitySummary: {
    warnings: number;
    errors: number;
    droppedRows: number;
    ambiguousDateCount: number;
    invalidDateCount: number;
  };
}

export interface CanonicalPackage {
  manifest: PriorsartManifest;
  datasets: CanonicalDatasets;
  indexes: CanonicalIndexes;
  quality: QualityReport;
}
