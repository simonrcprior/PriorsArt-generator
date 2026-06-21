import fs from "node:fs/promises";
import path from "node:path";
import { XMLParser } from "fast-xml-parser";
import { DiagnosticCollector } from "../../diagnostics/collector";
import {
  Assembly,
  CanonicalDatasets,
  DatePolicy,
  Demand,
  Operation,
  PartCatalogItem,
  PeggingLink,
  SalesOrder,
  Supply,
} from "../../model/types";
import { parseDateWithPolicy } from "../../pipeline/datePolicy";

interface XmlReadResult {
  datasets: CanonicalDatasets;
  fileNames: string[];
}

export type XmlRow = Record<string, unknown>;
export type XmlFileKey = "demands" | "jobs" | "links" | "poDetails" | "salesOrders" | "supplies" | "partDescriptions";
type XmlFileMap = Record<XmlFileKey, string>;

export interface XmlSourceTables {
  basePath: string;
  rowsByFile: Record<XmlFileKey, XmlRow[]>;
  fileNames: string[];
}

const XML_FILE_KEYS: XmlFileKey[] = [
  "demands",
  "jobs",
  "links",
  "poDetails",
  "salesOrders",
  "supplies",
  "partDescriptions",
];
const DEFAULT_XML_FILE_MAP: XmlFileMap = {
  demands: "PEGDMDMST.xml",
  jobs: "PEGJOBINFOSP2.xml",
  links: "PEGLINK.xml",
  poDetails: "PEGPODETAIL.xml",
  salesOrders: "PEGSALESORDER3.xml",
  supplies: "PEGSUPMST.xml",
  partDescriptions: "Time Phase Material Requirement_447293.xml",
};

interface XmlInputManifest {
  basePath?: string;
  files?: Partial<XmlFileMap>;
}

const parser = new XMLParser({
  ignoreAttributes: false,
  parseTagValue: false,
  trimValues: true,
});

function asString(value: unknown): string | undefined {
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : undefined;
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    return String(value);
  }
  return undefined;
}

function asNumber(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
}

function normalizeXmlDate(value: unknown): unknown {
  const stringValue = asString(value);
  if (!stringValue) {
    return value;
  }

  if (/^\d{4}-\d{2}-\d{2}T/.test(stringValue)) {
    return stringValue.slice(0, 10);
  }

  return value;
}

function mapSupplyTypeToCanonical(value: string | undefined): Supply["supplyType"] {
  const t = (value ?? "").toUpperCase();
  if (t === "P") {
    return "PO";
  }
  if (t === "W") {
    return "ON_HAND";
  }
  return "WO";
}

function collectResultsNodes(node: unknown, acc: XmlRow[]): void {
  if (!node || typeof node !== "object") {
    return;
  }

  if (Array.isArray(node)) {
    node.forEach((item) => collectResultsNodes(item, acc));
    return;
  }

  const record = node as Record<string, unknown>;

  if (record.Results) {
    const resultsNode = record.Results;
    if (Array.isArray(resultsNode)) {
      for (const entry of resultsNode) {
        if (entry && typeof entry === "object") {
          acc.push(entry as XmlRow);
        }
      }
    } else if (resultsNode && typeof resultsNode === "object") {
      acc.push(resultsNode as XmlRow);
    }
  }

  for (const value of Object.values(record)) {
    collectResultsNodes(value, acc);
  }
}

async function readResultsFromXml(filePath: string): Promise<XmlRow[]> {
  const xml = await fs.readFile(filePath, "utf8");
  const parsed = parser.parse(xml);
  const results: XmlRow[] = [];
  collectResultsNodes(parsed, results);
  return results;
}

function collectPartDescriptionNodes(node: unknown, acc: XmlRow[]): void {
  if (!node || typeof node !== "object") {
    return;
  }

  if (Array.isArray(node)) {
    node.forEach((item) => collectPartDescriptionNodes(item, acc));
    return;
  }

  const record = node as Record<string, unknown>;
  const partNum = asString(record["@_txtPartNum"] ?? record["txtPartNum"]);
  const partDescription = asString(record["@_txtPartDescription"] ?? record["txtPartDescription"]);
  const partLead = asNumber(record["@_txtCalc_DspLeadTime"] ?? record["txtCalc_DspLeadTime"] ?? record["@_txtCalc_DspLeadTime2"] ?? record["txtCalc_DspLeadTime2"]);

  if (partNum && (partDescription || partLead !== undefined)) {
    acc.push({
      PartNum: partNum,
      PartDescription: partDescription,
      PartLead: partLead,
    });
  }

  for (const value of Object.values(record)) {
    collectPartDescriptionNodes(value, acc);
  }
}

async function readPartDescriptionsFromTimePhaseXml(filePath: string): Promise<XmlRow[]> {
  const xml = await fs.readFile(filePath, "utf8");
  const parsed = parser.parse(xml);
  const results: XmlRow[] = [];
  collectPartDescriptionNodes(parsed, results);
  return results;
}

function isXmlFileKey(value: string): value is XmlFileKey {
  return XML_FILE_KEYS.includes(value as XmlFileKey);
}

function getDefaultBasePath(inputPath: string): string {
  const ext = path.extname(inputPath).toLowerCase();
  if (ext === ".xml" || ext === ".json") {
    return path.dirname(inputPath);
  }
  return inputPath;
}

async function resolveXmlSourceConfig(
  inputPath: string,
  diagnostics: DiagnosticCollector,
  xmlConfigPath?: string
): Promise<{ basePath: string; fileMap: XmlFileMap }> {
  const configPath = xmlConfigPath ?? (path.extname(inputPath).toLowerCase() === ".json" ? inputPath : undefined);

  if (!configPath) {
    return {
      basePath: getDefaultBasePath(inputPath),
      fileMap: { ...DEFAULT_XML_FILE_MAP },
    };
  }

  let manifestRaw: unknown;
  try {
    const text = await fs.readFile(configPath, "utf8");
    manifestRaw = JSON.parse(text) as unknown;
  } catch (error) {
    diagnostics.error({
      code: "XML_CONFIG_READ_FAILED",
      message: `Failed to read XML config '${configPath}': ${error instanceof Error ? error.message : String(error)}`,
      dataset: "manifest",
    });
    return {
      basePath: getDefaultBasePath(inputPath),
      fileMap: { ...DEFAULT_XML_FILE_MAP },
    };
  }

  const manifest = manifestRaw as XmlInputManifest;
  const resolvedBasePath = manifest.basePath
    ? path.resolve(path.dirname(configPath), manifest.basePath)
    : getDefaultBasePath(inputPath);

  const fileMap: XmlFileMap = { ...DEFAULT_XML_FILE_MAP };

  if (manifest.files && typeof manifest.files === "object") {
    for (const [key, value] of Object.entries(manifest.files)) {
      if (!isXmlFileKey(key)) {
        diagnostics.warn({
          code: "XML_CONFIG_UNKNOWN_KEY",
          message: `Ignoring unknown XML config key '${key}'`,
          dataset: "manifest",
        });
        continue;
      }

      if (typeof value !== "string" || !value.trim()) {
        diagnostics.warn({
          code: "XML_CONFIG_INVALID_VALUE",
          message: `Invalid XML config value for key '${key}', keeping default '${fileMap[key]}'`,
          dataset: "manifest",
        });
        continue;
      }

      fileMap[key] = value;
    }
  }

  return {
    basePath: resolvedBasePath,
    fileMap,
  };
}

export async function readXmlCanonical(
  inputPath: string,
  datePolicy: DatePolicy,
  diagnostics: DiagnosticCollector,
  xmlConfigPath?: string
): Promise<XmlReadResult> {
  const sourceTables = await readXmlSourceTables(inputPath, diagnostics, xmlConfigPath);
  const rowsByFile = sourceTables.rowsByFile;

  const salesOrderMap = new Map<string, SalesOrder>();
  const assemblyMap = new Map<string, Assembly>();
  const operationMap = new Map<string, Operation>();
  const demandMap = new Map<string, Demand>();
  const supplyMap = new Map<string, Supply>();
  const peggingMap = new Map<string, PeggingLink>();
  const partMap = new Map<string, PartCatalogItem>();

  const today = new Date().toISOString().slice(0, 10);

  const salesRows = rowsByFile.salesOrders;
  salesRows.forEach((row, index) => {
    const orderNum = asString(row.OrderRel_OrderNum);
    const orderLine = asString(row.OrderRel_OrderLine) ?? "0";
    const orderRel = asString(row.OrderRel_OrderRelNum) ?? "0";
    const partNumber = asString(row.OrderDtl_PartNum);
    const quantity = asNumber(row.Calculated_BackOrder) ?? asNumber(row.PegDmdMst_DemandQty);

    if (!orderNum || !partNumber || quantity === undefined) {
      diagnostics.warn({
        code: "XML_SALES_ROW_SKIPPED",
        message: "Skipped sales row due to missing order number, part number, or quantity",
        dataset: "salesOrders",
        row: index + 1,
      });
      diagnostics.incrementDroppedRows();
      return;
    }

    const dueDate = parseDateWithPolicy(normalizeXmlDate(row.OrderRel_ReqDate), datePolicy.defaultDateOrder, diagnostics, {
      dataset: "salesOrders",
      row: index + 1,
      field: "OrderRel_ReqDate",
    }).isoDate;

    if (!dueDate) {
      diagnostics.incrementDroppedRows();
      return;
    }

    const id = `SO-${orderNum}-${orderLine}-${orderRel}`;
    if (!salesOrderMap.has(id)) {
      salesOrderMap.set(id, {
        id,
        orderNumber: orderNum,
        partNumber,
        quantity,
        dueDate,
      });
    }

    if (!partMap.has(partNumber)) {
      partMap.set(partNumber, { partNumber });
    }
  });

  const jobRows = rowsByFile.jobs;
  jobRows.forEach((row, index) => {
    const jobNum = asString(row.Calculated_jobhead_jobnum) || asString(row.JobHead_JobNum);
    const partNumber = asString(row.JobHead_PartNum);

    if (!jobNum || !partNumber) {
      return;
    }

    const assemblyId = `ASM-${jobNum}`;
    if (!assemblyMap.has(assemblyId)) {
      assemblyMap.set(assemblyId, {
        id: assemblyId,
        partNumber,
        orderId: "SO-UNKNOWN",
        quantity: asNumber(row.JobOper_RunQty) ?? 0,
      });
    }

    const opSeq = asString(row.JobOper_OprSeq);
    const opCode = asString(row.JobOper_OpCode);
    if (opSeq && opCode) {
      const opId = `OP-${jobNum}-${opSeq}`;
      if (!operationMap.has(opId)) {
        operationMap.set(opId, {
          id: opId,
          assemblyId,
          operationCode: opCode,
          workCenter: asString(row.JobHead_Plant) ?? "UNKNOWN",
          hours: asNumber(row.Calculated_RemainingEST) ?? asNumber(row.JobOper_EstProdHours) ?? 0,
        });
      }
    }

    if (!partMap.has(partNumber)) {
      partMap.set(partNumber, { partNumber });
    }

    if (index === 0 && !salesOrderMap.has("SO-UNKNOWN")) {
      salesOrderMap.set("SO-UNKNOWN", {
        id: "SO-UNKNOWN",
        orderNumber: "UNKNOWN",
        partNumber,
        quantity: 0,
        dueDate: today,
      });
    }
  });

  const demandRows = rowsByFile.demands;
  demandRows.forEach((row, index) => {
    const demandSeq = asString(row.PegDmdMst_DemandSeq);
    const partNumber = asString(row.PegDmdMst_PartNum);
    const quantity = asNumber(row.PegDmdMst_DemandQty);

    if (!demandSeq || !partNumber || quantity === undefined) {
      diagnostics.warn({
        code: "XML_DEMAND_ROW_SKIPPED",
        message: "Skipped demand row due to missing demand sequence, part number, or quantity",
        dataset: "demands",
        row: index + 1,
      });
      diagnostics.incrementDroppedRows();
      return;
    }

    const dueDate = parseDateWithPolicy(
      normalizeXmlDate(row.PegDmdMst_DemandDate),
      datePolicy.defaultDateOrder,
      diagnostics,
      {
        dataset: "demands",
        row: index + 1,
        field: "PegDmdMst_DemandDate",
      }
    ).isoDate;

    if (!dueDate) {
      diagnostics.incrementDroppedRows();
      return;
    }

    const id = `DEM-${demandSeq}`;
    const demandOrdNum = asString(row.PegDmdMst_DemandOrdNum);
    const demandOrdLine = asString(row.PegDmdMst_DemandOrdLine) ?? "0";
    const demandOrdRel = asString(row.PegDmdMst_DemandOrdRel) ?? "0";

    let sourceType: Demand["sourceType"] = "MANUAL";
    let sourceId: string | undefined;
    if (demandOrdNum) {
      sourceType = "SO";
      sourceId = `SO-${demandOrdNum}-${demandOrdLine}-${demandOrdRel}`;
      if (!salesOrderMap.has(sourceId)) {
        salesOrderMap.set(sourceId, {
          id: sourceId,
          orderNumber: demandOrdNum,
          partNumber,
          quantity,
          dueDate,
        });
      }
    } else if (asString(row.PegDmdMst_DemandType) === "J") {
      sourceType = "ASM";
    }

    const demand: Demand = {
      id,
      partNumber,
      quantity,
      dueDate,
      sourceType,
    };

    if (sourceId !== undefined) {
      demand.sourceId = sourceId;
    }

    demandMap.set(id, demand);

    if (!partMap.has(partNumber)) {
      partMap.set(partNumber, { partNumber });
    }
  });

  const linkRows = rowsByFile.links;
  const supplyRows = rowsByFile.supplies;

  supplyRows.forEach((row, index) => {
    const supplySeq = asString(row.PegSupMst_SupplySeq);
    const partNumber = asString(row.PegSupMst_PartNum);
    const quantity = asNumber(row.PegSupMst_SupplyQty);

    if (!supplySeq || !partNumber || quantity === undefined) {
      diagnostics.warn({
        code: "XML_SUPPLY_ROW_SKIPPED",
        message: "Skipped supply row due to missing supply sequence, part number, or quantity",
        dataset: "supplies",
        row: index + 1,
      });
      diagnostics.incrementDroppedRows();
      return;
    }

    const availableDate = parseDateWithPolicy(
      normalizeXmlDate(row.PegSupMst_SupplyDate),
      datePolicy.defaultDateOrder,
      diagnostics,
      {
        dataset: "supplies",
        row: index + 1,
        field: "PegSupMst_SupplyDate",
      }
    ).isoDate;

    if (!availableDate) {
      diagnostics.incrementDroppedRows();
      return;
    }

    const id = `SUP-${supplySeq}`;
    const supplyOrdNum = asString(row.PegSupMst_SupplyOrdNum) ?? "";
    const supplyOrdLine = asString(row.PegSupMst_SupplyOrdLine) ?? "0";
    const supplyOrdRel = asString(row.PegSupMst_SupplyOrdRel) ?? "0";
    const sourceId = `${supplyOrdNum}-${supplyOrdLine}-${supplyOrdRel}`;
    const reportDateRaw = asString(row.Calculated_ReportDate ?? row.PegSupMst_ReportDate);
    const reportDate = reportDateRaw ? reportDateRaw.replace(/\//g, "-").slice(0, 10) : undefined;

    if (!supplyMap.has(id)) {
      const supply: Supply = {
        id,
        partNumber,
        quantity,
        availableDate,
        supplyType: mapSupplyTypeToCanonical(asString(row.PegSupMst_SupplyType)),
      };
      if (reportDate) {
        supply.reportDate = reportDate;
      }
      if (supplyOrdNum) {
        supply.sourceId = sourceId;
      }
      supplyMap.set(id, supply);
    }

    if (!partMap.has(partNumber)) {
      partMap.set(partNumber, { partNumber });
    }
  });

  linkRows.forEach((row, index) => {
    const pegNum = asString(row.PegLink_PegNum);
    const demandSeq = asString(row.PegLink_DemandSeq);
    const supplySeq = asString(row.PegLink_SupplySeq);
    const partNumber = asString(row.PegLink_PartNum);
    const quantity = asNumber(row.PegLink_PeggedQty);

    if (!pegNum || !demandSeq || !supplySeq || !partNumber || quantity === undefined) {
      diagnostics.warn({
        code: "XML_LINK_ROW_SKIPPED",
        message: "Skipped link row due to missing keys",
        dataset: "peggingLinks",
        row: index + 1,
      });
      diagnostics.incrementDroppedRows();
      return;
    }

    const demandId = `DEM-${demandSeq}`;
    const supplyId = `SUP-${supplySeq}`;
    const linkId = `PEG-${pegNum}`;

    if (!demandMap.has(demandId)) {
      demandMap.set(demandId, {
        id: demandId,
        partNumber,
        quantity,
        dueDate: today,
        sourceType: "MANUAL",
      });
      diagnostics.warn({
        code: "XML_DEMAND_SYNTHETIC",
        message: `Created synthetic demand '${demandId}' from PEGLINK because PEGDMDMST row was missing`,
        dataset: "demands",
      });
    }

    const existingSupply = supplyMap.get(supplyId);
    if (!existingSupply) {
      supplyMap.set(supplyId, {
        id: supplyId,
        partNumber,
        quantity,
        availableDate: today,
        supplyType: "WO",
        sourceId: supplySeq,
      });
    }

    if (!peggingMap.has(linkId)) {
      peggingMap.set(linkId, {
        id: linkId,
        demandId,
        supplyId,
        quantity,
      });
    }

    if (!partMap.has(partNumber)) {
      partMap.set(partNumber, { partNumber });
    }
  });

  const poRows = rowsByFile.poDetails;
  poRows.forEach((row, index) => {
    const poNum = asString(row.PORel_PONum);
    const poLine = asString(row.PORel_POLine) ?? "0";
    const poRel = asString(row.PORel_PORelNum) ?? "0";
    const partNumber = asString(row.PODetail_PartNum);
    const quantity = asNumber(row.Calculated_openqty) ?? asNumber(row.PORel_RelQty);

    if (!poNum || !partNumber || quantity === undefined) {
      diagnostics.warn({
        code: "XML_PO_ROW_SKIPPED",
        message: "Skipped PO row due to missing PO number, part number, or quantity",
        dataset: "supplies",
        row: index + 1,
      });
      diagnostics.incrementDroppedRows();
      return;
    }

    const availableDate = parseDateWithPolicy(
      normalizeXmlDate(row.PORel_PromiseDt ?? row.PORel_DueDate ?? row.POHeader_OrderDate),
      datePolicy.defaultDateOrder,
      diagnostics,
      {
        dataset: "supplies",
        row: index + 1,
        field: "PORel_PromiseDt",
      }
    ).isoDate;

    if (!availableDate) {
      diagnostics.incrementDroppedRows();
      return;
    }

    const id = `PO-${poNum}-${poLine}-${poRel}`;
    if (!supplyMap.has(id)) {
      const sourceId = `${poNum}-${poLine}-${poRel}`;
      supplyMap.set(id, {
        id,
        partNumber,
        quantity,
        availableDate,
        supplyType: "PO",
        sourceId,
      });
    }

    const existingPart = partMap.get(partNumber);
    if (!existingPart) {
      const nextPart: PartCatalogItem = { partNumber };
      const description = asString(row.PODetail_LineDesc);
      if (description !== undefined) {
        nextPart.description = description;
      }
      partMap.set(partNumber, nextPart);
    }
  });

  const descriptionRows = rowsByFile.partDescriptions;
  descriptionRows.forEach((row) => {
    const partNumber = asString(row.PartNum);
    const description = asString(row.PartDescription);
    const lead = asNumber(row.PartLead);
    if (!partNumber || !description) {
      if (!partNumber || lead === undefined) {
        return;
      }
    }

    const existing = partMap.get(partNumber);
    if (!existing) {
      const nextPart: PartCatalogItem = { partNumber };
      if (description !== undefined) {
        nextPart.description = description;
      }
      if (lead !== undefined) {
        nextPart.lead = lead;
      }
      partMap.set(partNumber, nextPart);
      return;
    }

    if (!existing.description && description !== undefined) {
      existing.description = description;
    }
    if (existing.lead === undefined && lead !== undefined) {
      existing.lead = lead;
    }
  });

  const datasets: CanonicalDatasets = {
    salesOrders: [...salesOrderMap.values()],
    assemblies: [...assemblyMap.values()],
    demands: [...demandMap.values()],
    supplies: [...supplyMap.values()],
    operations: [...operationMap.values()],
    peggingLinks: [...peggingMap.values()],
    partCatalog: [...partMap.values()],
  };

  return {
    datasets,
    fileNames: sourceTables.fileNames,
  };
}

export async function readXmlSourceTables(
  inputPath: string,
  diagnostics: DiagnosticCollector,
  xmlConfigPath?: string
): Promise<XmlSourceTables> {
  const { basePath, fileMap } = await resolveXmlSourceConfig(inputPath, diagnostics, xmlConfigPath);

  const loadedFiles: string[] = [];
  const rowsByFile: Record<XmlFileKey, XmlRow[]> = {
    demands: [],
    jobs: [],
    links: [],
    poDetails: [],
    salesOrders: [],
    supplies: [],
    partDescriptions: [],
  };

  for (const key of XML_FILE_KEYS) {
    const fileName = fileMap[key];
    const filePath = path.isAbsolute(fileName) ? fileName : path.join(basePath, fileName);

    try {
      await fs.access(filePath);
    } catch {
      diagnostics.warn({
        code: "XML_FILE_MISSING",
        message: `Missing XML file for '${key}': '${fileName}' in '${basePath}'`,
        dataset: "manifest",
      });
      rowsByFile[key] = [];
      continue;
    }

    try {
      rowsByFile[key] =
        key === "partDescriptions"
          ? await readPartDescriptionsFromTimePhaseXml(filePath)
          : await readResultsFromXml(filePath);
      loadedFiles.push(fileName);
    } catch (error) {
      diagnostics.error({
        code: "XML_FILE_PARSE_FAILED",
        message: `Failed to parse XML file for '${key}' (${fileName}): ${error instanceof Error ? error.message : String(error)}`,
        dataset: "manifest",
      });
      rowsByFile[key] = [];
    }
  }

  return {
    basePath,
    rowsByFile,
    fileNames: loadedFiles,
  };
}
