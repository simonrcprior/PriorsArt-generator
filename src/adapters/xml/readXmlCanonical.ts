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
  sourceTables: XmlSourceTables;
}

interface LinkHierarchyInfo {
  nest: number;
  nestText: string;
  parentLinkId: string | null;
  parentDemandId: string | null;
  parentSupplyId: string | null;
  path: string[];
}

interface XmlLinkRowInfo {
  linkId: string;
  pegNum: string;
  demandSeq: string;
  supplySeq: string;
  demandId: string;
  supplyId: string;
  quantity: number;
  partNumber: string;
}

interface DemandHierarchyMeta {
  demandSeq: string;
  demandType: string;
  demandOrdNum: string;
}

interface SupplyHierarchyMeta {
  supplySeq: string;
  supplyType: string;
  supplyOrdNum: string;
}

interface JobSupplySummary {
  commitDate?: string;
  minDue?: string;
  remainingOps: string;
  remainingOpsh: string;
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

function compareTokens(a: string, b: string): number {
  const aNum = Number(a);
  const bNum = Number(b);
  const aIsNum = Number.isFinite(aNum);
  const bIsNum = Number.isFinite(bNum);
  if (aIsNum && bIsNum) {
    return aNum - bNum;
  }
  return a.localeCompare(b);
}

function parseSalesOrderSourceId(sourceId?: string): { orderNum: string; line: string; rel: string } {
  if (!sourceId) {
    return { orderNum: "", line: "", rel: "" };
  }

  const match = sourceId.match(/^SO-(.+)-([^\-]+)-([^\-]+)$/);
  if (!match) {
    return { orderNum: sourceId, line: "", rel: "" };
  }

  return {
    orderNum: match[1] ?? "",
    line: match[2] ?? "",
    rel: match[3] ?? "",
  };
}

function supplyOrderKey(orderNum: string, orderLine: string, orderRel: string): string {
  return `${orderNum}|${orderLine}|${orderRel}`;
}

function buildLinkHierarchy(
  links: XmlLinkRowInfo[],
  demandMetaBySeq: Map<string, DemandHierarchyMeta>,
  demandSeqsByOrderNum: Map<string, string[]>,
  supplyMetaBySeq: Map<string, SupplyHierarchyMeta>
): Map<string, LinkHierarchyInfo> {
  const linksByDemandSeq = new Map<string, XmlLinkRowInfo[]>();
  for (const link of links) {
    const group = linksByDemandSeq.get(link.demandSeq);
    if (group) {
      group.push(link);
    } else {
      linksByDemandSeq.set(link.demandSeq, [link]);
    }
  }

  for (const group of linksByDemandSeq.values()) {
    group.sort((a, b) => {
      const peg = compareTokens(a.pegNum, b.pegNum);
      if (peg !== 0) {
        return peg;
      }
      const sup = compareTokens(a.supplySeq, b.supplySeq);
      if (sup !== 0) {
        return sup;
      }
      return a.linkId.localeCompare(b.linkId);
    });
  }

  const rootDemandSeqs = [...new Set(
    [...demandMetaBySeq.values()]
      .filter((meta) => meta.demandType === "S")
      .map((meta) => meta.demandSeq)
  )].sort(compareTokens);

  const hierarchyByLinkId = new Map<string, LinkHierarchyInfo>();

  const assignHierarchy = (
    link: XmlLinkRowInfo,
    nest: number,
    parentLinkId: string | null,
    parentDemandId: string | null,
    parentSupplyId: string | null,
    parentPath: string[]
  ): void => {
    if (hierarchyByLinkId.has(link.linkId)) {
      return;
    }

    const path = [...parentPath, link.linkId];
    hierarchyByLinkId.set(link.linkId, {
      nest,
      nestText: ">".repeat(nest),
      parentLinkId,
      parentDemandId,
      parentSupplyId,
      path,
    });
  };

  const walk = (
    demandSeq: string,
    nest: number,
    parentLinkId: string | null,
    parentDemandId: string | null,
    parentSupplyId: string | null,
    parentPath: string[],
    visitedDemandSeqs: Set<string>
  ): void => {
    if (nest > 50) {
      return;
    }

    const linksForDemand = linksByDemandSeq.get(demandSeq) ?? [];
    const currentDemand = demandMetaBySeq.get(demandSeq);

    for (const link of linksForDemand) {
      assignHierarchy(link, nest, parentLinkId, parentDemandId, parentSupplyId, parentPath);

      const supplyMeta = supplyMetaBySeq.get(link.supplySeq);
      const downstreamDemand = demandMetaBySeq.get(link.supplySeq);
      const fallbackOrderNum = supplyMeta?.supplyType === "J" ? downstreamDemand?.demandOrdNum ?? "" : "";
      const effectiveSupplyOrdNum = (supplyMeta?.supplyOrdNum ?? "") || fallbackOrderNum;
      const parentDemandOrdNum = currentDemand?.demandOrdNum ?? "";
      const recursionAllowed =
        supplyMeta?.supplyType === "J" &&
        effectiveSupplyOrdNum.length > 0 &&
        effectiveSupplyOrdNum !== parentDemandOrdNum;

      if (!recursionAllowed) {
        continue;
      }

      const candidateSeqs = (demandSeqsByOrderNum.get(effectiveSupplyOrdNum) ?? [])
        .filter((seq) => (demandMetaBySeq.get(seq)?.demandOrdNum ?? "").length > 0)
        .sort(compareTokens);

      for (const childSeq of candidateSeqs) {
        if (childSeq === demandSeq || visitedDemandSeqs.has(childSeq)) {
          continue;
        }

        visitedDemandSeqs.add(childSeq);
        walk(
          childSeq,
          nest + 1,
          link.linkId,
          link.demandId,
          link.supplyId,
          [...parentPath, link.linkId],
          visitedDemandSeqs
        );
        visitedDemandSeqs.delete(childSeq);
      }
    }
  };

  for (const demandSeq of rootDemandSeqs) {
    walk(demandSeq, 1, null, null, null, [], new Set([demandSeq]));
  }

  return hierarchyByLinkId;
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
  const demandMetaBySeq = new Map<string, DemandHierarchyMeta>();
  const demandSeqsByOrderNum = new Map<string, string[]>();
  const supplyMetaBySeq = new Map<string, SupplyHierarchyMeta>();
  const xmlLinkInfos: XmlLinkRowInfo[] = [];

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
    const company = asString(row.PegDmdMst_Company) ?? "";
    const plant = asString(row.PegDmdMst_Plant) ?? "";
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

    const demandType = asString(row.PegDmdMst_DemandType) ?? "";
    demandMetaBySeq.set(demandSeq, {
      demandSeq,
      demandType,
      demandOrdNum: demandOrdNum ?? "",
    });
    if (demandOrdNum) {
      const existing = demandSeqsByOrderNum.get(demandOrdNum);
      if (existing) {
        if (!existing.includes(demandSeq)) {
          existing.push(demandSeq);
        }
      } else {
        demandSeqsByOrderNum.set(demandOrdNum, [demandSeq]);
      }
    }

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
      ...(company ? { company } : {}),
      ...(plant ? { plant } : {}),
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
  const poRows = rowsByFile.poDetails;
  const poByOrderKey = new Map<string, XmlRow>();
  for (const row of poRows) {
    const poNum = asString(row.PORel_PONum) ?? "";
    const poLine = asString(row.PORel_POLine) ?? "0";
    const poRel = asString(row.PORel_PORelNum) ?? "0";
    if (!poNum) {
      continue;
    }
    poByOrderKey.set(supplyOrderKey(poNum, poLine, poRel), row);
  }

  const jobRowsForSummary = rowsByFile.jobs;
  const jobRowsByKey = new Map<string, XmlRow[]>();
  for (const row of jobRowsForSummary) {
    const company = asString(row.JobHead_Company) ?? "";
    const plant = asString(row.JobHead_Plant) ?? "";
    const jobNum = asString(row.Calculated_jobhead_jobnum) || asString(row.JobHead_JobNum);
    if (!jobNum) {
      continue;
    }
    const key = `${company}|${plant}|${jobNum}`;
    const existing = jobRowsByKey.get(key);
    if (existing) {
      existing.push(row);
    } else {
      jobRowsByKey.set(key, [row]);
    }
  }

  const jobSummaryByKey = new Map<string, JobSupplySummary>();
  for (const [key, rows] of jobRowsByKey.entries()) {
    const openRows = rows.filter((row) => (asString(row.JobOper_OpComplete) ?? "").toLowerCase() !== "true");
    const minDue = openRows
      .map((row, index) =>
        parseDateWithPolicy(normalizeXmlDate(row.JobOper_DueDate), datePolicy.defaultDateOrder, diagnostics, {
          dataset: "supplies",
          row: index + 1,
          field: "JobOper_DueDate",
        }).isoDate
      )
      .filter((value): value is string => Boolean(value))
      .sort()[0];

    const commitDate = rows
      .map((row, index) =>
        parseDateWithPolicy(normalizeXmlDate(row.JobHead_CommitDate_c), datePolicy.defaultDateOrder, diagnostics, {
          dataset: "supplies",
          row: index + 1,
          field: "JobHead_CommitDate_c",
        }).isoDate
      )
      .filter((value): value is string => Boolean(value))
      .sort()[0];

    const remainingOps = openRows
      .map((row) => `${asString(row.JobOper_OprSeq) ?? ""}>${asString(row.JobOper_OpCode) ?? ""} Due: ${asString(normalizeXmlDate(row.JobOper_DueDate)) ?? ""}`)
      .join("\n");
    const remainingOpsh = openRows
      .map(
        (row) =>
          `${asString(row.JobOper_OprSeq) ?? ""}>${asString(row.JobOper_OpCode) ?? ""} Due: ${asString(normalizeXmlDate(row.JobOper_DueDate)) ?? ""} SetH: ${asString(
            row.JobOper_EstSetHours
          ) ?? ""} RunH: ${asString(row.JobOper_EstProdHours) ?? ""}`
      )
      .join("\n");

    const summary: JobSupplySummary = {
      remainingOps,
      remainingOpsh,
      ...(commitDate ? { commitDate } : {}),
      ...(minDue ? { minDue } : {}),
    };
    jobSummaryByKey.set(key, summary);
  }

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
    const company = asString(row.PegSupMst_Company) ?? "";
    const plant = asString(row.PegSupMst_Plant) ?? "";
    const supplyOrdNum = asString(row.PegSupMst_SupplyOrdNum) ?? "";
    const supplyOrdLine = asString(row.PegSupMst_SupplyOrdLine) ?? "0";
    const supplyOrdRel = asString(row.PegSupMst_SupplyOrdRel) ?? "0";
    const sourceId = `${supplyOrdNum}-${supplyOrdLine}-${supplyOrdRel}`;
    const reportDateRaw = asString(row.Calculated_ReportDate ?? row.PegSupMst_ReportDate);
    const reportDate = reportDateRaw ? reportDateRaw.replace(/\//g, "-").slice(0, 10) : undefined;
    const poRow = poByOrderKey.get(supplyOrderKey(supplyOrdNum, supplyOrdLine, supplyOrdRel));
    const promiseDate = parseDateWithPolicy(
      normalizeXmlDate(poRow?.PORel_PromiseDt ?? poRow?.PORel_DueDate ?? poRow?.POHeader_OrderDate),
      datePolicy.defaultDateOrder,
      diagnostics,
      {
        dataset: "supplies",
        row: index + 1,
        field: "PORel_PromiseDt",
      }
    ).isoDate;
    const jobSummary = jobSummaryByKey.get(`${company}|${plant}|${supplyOrdNum}`);

    const rawSupplyType = asString(row.PegSupMst_SupplyType) ?? "";
    supplyMetaBySeq.set(supplySeq, {
      supplySeq,
      supplyType: rawSupplyType,
      supplyOrdNum,
    });

    if (!supplyMap.has(id)) {
      const supply: Supply = {
        id,
        ...(company ? { company } : {}),
        ...(plant ? { plant } : {}),
        partNumber,
        quantity,
        availableDate,
        supplyType: mapSupplyTypeToCanonical(rawSupplyType),
      };
      if (reportDate) {
        supply.reportDate = reportDate;
      }
      if (supplyOrdNum) {
        supply.sourceId = sourceId;
      }
      if (promiseDate) {
        supply.promiseDate = promiseDate;
      }
      if (jobSummary?.commitDate) {
        supply.commitDate = jobSummary.commitDate;
      }
      if (jobSummary?.minDue) {
        supply.minDue = jobSummary.minDue;
      }
      if (jobSummary?.remainingOps) {
        supply.remainingOps = jobSummary.remainingOps;
      }
      if (jobSummary?.remainingOpsh) {
        supply.remainingOpsh = jobSummary.remainingOpsh;
      }
      const vendorName = asString(poRow?.Vendor_Name);
      if (vendorName) {
        supply.vendorName = vendorName;
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
      const company = asString(row.PegLink_Company) ?? "";
      const plant = asString(row.PegLink_Plant) ?? "";
      demandMap.set(demandId, {
        id: demandId,
        ...(company ? { company } : {}),
        ...(plant ? { plant } : {}),
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
      const company = asString(row.PegLink_Company) ?? "";
      const plant = asString(row.PegLink_Plant) ?? "";
      supplyMap.set(supplyId, {
        id: supplyId,
        ...(company ? { company } : {}),
        ...(plant ? { plant } : {}),
        partNumber,
        quantity,
        availableDate: today,
        supplyType: "WO",
        sourceId: supplySeq,
      });
    }

    if (!peggingMap.has(linkId)) {
      xmlLinkInfos.push({
        linkId,
        pegNum,
        demandSeq,
        supplySeq,
        demandId,
        supplyId,
        quantity,
        partNumber,
      });
      peggingMap.set(linkId, {
        id: linkId,
        demandId,
        supplyId,
        quantity,
        nest: 1,
        nestText: ">",
        parentLinkId: null,
        parentDemandId: null,
        parentSupplyId: null,
        path: [linkId],
        duplicate: false,
      });
    }

    if (!partMap.has(partNumber)) {
      partMap.set(partNumber, { partNumber });
    }
  });

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
      const vendorName = asString(row.Vendor_Name);
      const company = asString(row.PORel_Company) ?? "";
      const plant = asString(row.PORel_Plant) ?? "";
      supplyMap.set(id, {
        id,
        ...(company ? { company } : {}),
        ...(plant ? { plant } : {}),
        partNumber,
        quantity,
        availableDate,
        supplyType: "PO",
        sourceId,
        promiseDate: availableDate,
        ...(vendorName ? { vendorName } : {}),
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

  const hierarchyByLinkId = buildLinkHierarchy(xmlLinkInfos, demandMetaBySeq, demandSeqsByOrderNum, supplyMetaBySeq);
  for (const linkInfo of xmlLinkInfos) {
    const existing = peggingMap.get(linkInfo.linkId);
    if (!existing) {
      continue;
    }
    const hierarchy = hierarchyByLinkId.get(linkInfo.linkId);
    if (!hierarchy) {
      diagnostics.warn({
        code: "XML_LINK_DROPPED_UNANCHORED",
        message: `Dropped link '${linkInfo.linkId}' because it was not reachable from an SO-rooted demand chain`,
        dataset: "peggingLinks",
      });
      diagnostics.incrementDroppedRows();
      peggingMap.delete(linkInfo.linkId);
      continue;
    }
    peggingMap.set(linkInfo.linkId, {
      ...existing,
      nest: hierarchy.nest,
      nestText: hierarchy.nestText,
      parentLinkId: hierarchy.parentLinkId,
      parentDemandId: hierarchy.parentDemandId,
      parentSupplyId: hierarchy.parentSupplyId,
      path: hierarchy.path,
      duplicate: false,
    });
  }

  // Propagate SO anchor source through hierarchy where child demands do not carry it explicitly.
  const linksByNest = [...peggingMap.values()].sort((a, b) => a.nest - b.nest || compareTokens(a.id, b.id));
  const linkById = new Map(linksByNest.map((link) => [link.id, link]));
  for (const link of linksByNest) {
    const demand = demandMap.get(link.demandId);
    if (!demand) {
      continue;
    }
    if (demand.sourceType === "SO" && demand.sourceId) {
      continue;
    }
    if (!link.parentLinkId) {
      continue;
    }
    const parent = linkById.get(link.parentLinkId);
    if (!parent) {
      continue;
    }
    const parentDemand = demandMap.get(parent.demandId);
    if (parentDemand?.sourceType === "SO" && parentDemand.sourceId) {
      demand.sourceType = "SO";
      demand.sourceId = parentDemand.sourceId;
    }
  }

  // Drop roots that still cannot be anchored to a sales order (parity with XML XLSX LOB behavior).
  const droppedRootIds = new Set<string>();
  for (const link of [...peggingMap.values()]) {
    if (link.nest !== 1) {
      continue;
    }
    const demand = demandMap.get(link.demandId);
    if (demand?.sourceType === "SO" && demand.sourceId) {
      continue;
    }
    droppedRootIds.add(link.id);
    diagnostics.warn({
      code: "XML_LINK_DROPPED_NO_SO_ANCHOR",
      message: `Dropped root link '${link.id}' because demand '${link.demandId}' has no SO anchor`,
      dataset: "peggingLinks",
    });
    diagnostics.incrementDroppedRows();
  }

  if (droppedRootIds.size > 0) {
    for (const link of [...peggingMap.values()]) {
      const rootId = link.path[0];
      if (rootId && droppedRootIds.has(rootId)) {
        peggingMap.delete(link.id);
      }
    }
  }

  // Tag duplicate-like multiplicity explicitly for contract consumers.
  const duplicateGroups = new Map<string, PeggingLink[]>();
  for (const link of peggingMap.values()) {
    const demand = demandMap.get(link.demandId);
    const supply = supplyMap.get(link.supplyId);
    const so = parseSalesOrderSourceId(demand?.sourceId);
    const signature = [
      demand?.partNumber ?? "",
      so.orderNum,
      so.line,
      so.rel,
      String(link.nest),
      supply?.partNumber ?? "",
      supply?.availableDate ?? "",
      String(link.quantity),
    ].join("|");
    const group = duplicateGroups.get(signature);
    if (group) {
      group.push(link);
    } else {
      duplicateGroups.set(signature, [link]);
    }
  }

  for (const group of duplicateGroups.values()) {
    const isDuplicateGroup = group.length > 1;
    for (const link of group) {
      link.duplicate = isDuplicateGroup;
      if (isDuplicateGroup) {
        link.duplicateReason = "lob-signature-collision";
      } else {
        delete link.duplicateReason;
      }
      peggingMap.set(link.id, link);
    }
  }

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
    sourceTables,
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
