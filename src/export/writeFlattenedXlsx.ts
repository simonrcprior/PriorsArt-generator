import fs from "node:fs/promises";
import path from "node:path";
import * as XLSX from "xlsx";
import { CanonicalDatasets } from "../model/types";
import { XmlRow, XmlSourceTables } from "../adapters/xml/readXmlCanonical";

export interface FlattenedXlsxProgressUpdate {
  stage: string;
  progress: number;
  detail?: string;
}

export type FlattenedXlsxProgressReporter = (update: FlattenedXlsxProgressUpdate) => void;

function reportProgress(
  progress: FlattenedXlsxProgressReporter | undefined,
  stage: string,
  progressValue: number,
  detail?: string
): void {
  if (!progress) {
    return;
  }

  const update: FlattenedXlsxProgressUpdate = {
    stage,
    progress: Math.max(0, Math.min(100, progressValue)),
  };

  if (detail !== undefined) {
    update.detail = detail;
  }

  progress(update);
}

interface ProcessedLayoutRow {
  LineID: number;
  Company: string;
  topPNum: string;
  topOrderNum: string;
  topLine: string;
  topRel: string;
  topQty: number;
  topDate: number | null;
  nest: number;
  nestText: string;
  thisPNum: string;
  thisDesc: string;
  ThisOrderNum: string;
  ThisLine: string;
  ThisRel: string;
  ThisQty: number;
  thisPeggedQty: number;
  thisDate: number | null;
  thisType: string;
  DemandSeq: number | string;
  SupplySeq: number | string;
  dmdDate: number | null;
  rowsSince1: number;
  duplicate: boolean;
  PORel_PromiseDt: number | null;
  JobHead_CommitDate_c: number | null;
  earliestN: number | null;
  RemainingOps: string;
  RemainingOpsh: string;
  MinDue: number;
  Warning: string;
  myText1: string;
  myText2: string;
  myText3: string;
  myText4: string;
  myText5: string;
  LeadFromTimePhase: number;
  willShip: number | null;
  willShipText: string;
  OrderBy: number | null;
}

const LAYOUT_COLUMNS: Array<keyof ProcessedLayoutRow> = [
  "LineID",
  "Company",
  "topPNum",
  "topOrderNum",
  "topLine",
  "topRel",
  "topQty",
  "topDate",
  "nest",
  "nestText",
  "thisPNum",
  "thisDesc",
  "ThisOrderNum",
  "ThisLine",
  "ThisRel",
  "ThisQty",
  "thisPeggedQty",
  "thisDate",
  "thisType",
  "DemandSeq",
  "SupplySeq",
  "dmdDate",
  "rowsSince1",
  "duplicate",
  "PORel_PromiseDt",
  "JobHead_CommitDate_c",
  "earliestN",
  "RemainingOps",
  "RemainingOpsh",
  "MinDue",
  "Warning",
  "myText1",
  "myText2",
  "myText3",
  "myText4",
  "myText5",
  "LeadFromTimePhase",
  "willShip",
  "willShipText",
  "OrderBy",
];

function isoToExcelSerial(isoDate?: string): number | null {
  if (!isoDate) {
    return null;
  }

  const parsed = new Date(`${isoDate}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime())) {
    return null;
  }

  const excelEpoch = Date.UTC(1899, 11, 30);
  return Math.floor((parsed.getTime() - excelEpoch) / (24 * 60 * 60 * 1000));
}

function parseSalesOrderIdentity(id?: string): { orderNum: string; line: string; rel: string } {
  if (!id) {
    return { orderNum: "", line: "", rel: "" };
  }

  const match = id.match(/^SO-(.+)-([^\-]+)-([^\-]+)$/);
  if (!match) {
    return { orderNum: id, line: "", rel: "" };
  }

  return {
    orderNum: match[1] ?? "",
    line: match[2] ?? "",
    rel: match[3] ?? "",
  };
}

function parseSupplyIdentity(sourceId?: string): { orderNum: string; line: string; rel: string } {
  if (!sourceId) {
    return { orderNum: "", line: "0", rel: "0" };
  }

  const parts = sourceId.split("-");
  if (parts.length >= 3) {
    return {
      orderNum: parts[0] ?? "",
      line: parts[1] ?? "0",
      rel: parts[2] ?? "0",
    };
  }

  return { orderNum: sourceId, line: "0", rel: "0" };
}

function parseSeqFromId(id: string, prefix: string): number | string {
  const cleaned = id.replace(`${prefix}-`, "");
  const asNum = Number(cleaned);
  return Number.isFinite(asNum) ? asNum : cleaned;
}

function mapSupplyType(supplyType?: string): string {
  if (supplyType === "WO") {
    return "J";
  }
  if (supplyType === "ON_HAND") {
    return "W";
  }
  if (supplyType === "PO") {
    return "P";
  }
  return "N";
}

function asString(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    return String(value);
  }
  return "";
}

function asNumber(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}

function normalizeJoinPart(value: string): string {
  return value.trim().toUpperCase();
}

function xmlDateToIso(value: unknown): string {
  const raw = asString(value).trim();
  if (!raw) {
    return "";
  }
  return raw.includes("T") ? raw.slice(0, 10) : raw;
}

function getMaxDate(values: Array<number | null>): number | null {
  const filtered = values.filter((v): v is number => v !== null);
  if (filtered.length === 0) {
    return null;
  }
  return Math.max(...filtered);
}

function getMinDate(values: Array<number | null>): number | null {
  const filtered = values.filter((v): v is number => v !== null);
  if (filtered.length === 0) {
    return null;
  }
  return Math.min(...filtered);
}

interface JobSummary {
  commitDate: number | null;
  remainingOps: string;
  remainingOpsh: string;
  minDue: number | null;
}

interface SupplyInfo {
  company: string;
  plant: string;
  supplySeq: string;
  partNum: string;
  supplyType: string;
  supplyOrdNum: string;
  supplyOrdLine: string;
  supplyOrdRel: string;
  supplyQty: number;
  supplyDate: number | null;
}

interface DemandInfo {
  demandSeq: string;
  company: string;
  plant: string;
  demandType: string;
  demandOrdNum: string;
  demandOrdLine: string;
  demandOrdRel: string;
  partNum: string;
  demandQty: number;
  demandDate: number | null;
}

interface LinkInfo {
  company: string;
  plant: string;
  demandSeq: string;
  supplySeq: string;
  peggedQty: number;
  partNum: string;
}

function companyPlantSeqKey(company: string, plant: string, seq: string): string {
  return `${normalizeJoinPart(company)}|${normalizeJoinPart(plant)}|${seq.trim()}`;
}

function companyPlantOrderKey(company: string, plant: string, orderNum: string): string {
  return `${normalizeJoinPart(company)}|${normalizeJoinPart(plant)}|${orderNum.trim()}`;
}

function companyDisplayLabel(company: string, plant: string): string {
  if (company && plant) {
    return `${company}-${plant}`;
  }
  return company;
}

function makeWarning(topDate: number, dueDate: number, promiseDate: number, commitDate: number, minDue: number, reportDate: number): string {
  let warning = false;

  if (minDue > 0 && dueDate > topDate) {
    warning = true;
  }
  if (minDue > 0 && promiseDate > topDate) {
    warning = true;
  }
  if (minDue > 0 && commitDate > topDate) {
    warning = true;
  }
  if (minDue > 0 && minDue + 28 < reportDate) {
    warning = true;
  }
  if (minDue > 0 && reportDate > topDate) {
    warning = true;
  }

  return warning ? "Y" : "";
}

function text1(thisType: string, warning: string): string {
  let value = "Y";
  if (thisType === "W") {
    value = "G";
  }
  if (warning === "Y") {
    value = "A";
  }
  return value;
}

function appendTextLine(value: string, include: boolean = true): string {
  if (!include) {
    return "";
  }
  const trimmed = value.trim();
  if (!trimmed) {
    return "";
  }
  return `\n${trimmed}`;
}

function formatExcelSerialDate(serial: number | null): string {
  if (serial === null) {
    return "";
  }

  const wholeDays = Math.floor(serial);
  const base = Date.UTC(1899, 11, 30);
  const date = new Date(base + wholeDays * 24 * 60 * 60 * 1000);
  if (Number.isNaN(date.getTime())) {
    return "";
  }

  const day = `${date.getUTCDate()}`.padStart(2, "0");
  const month = date.toLocaleString("en-US", { month: "short", timeZone: "UTC" });
  const year = date.getUTCFullYear();
  return `${day}-${month}-${year}`;
}

function formatDateSegment(label: string, serial: number | null): string {
  if (serial === null) {
    return "";
  }
  return ` / ${label}:${formatExcelSerialDate(serial)}`;
}

function buildMyText2(
  thisType: string,
  thisOrderNum: string,
  thisLine: string,
  thisRel: string,
  thisPeggedQty: number,
  thisQty: number,
  thisDate: number | null,
  promiseDate: number | null,
  commitDate: number | null,
  earliestN: number | null
): string {
  if (thisType === "J") {
    const dueSegment = thisDate !== null ? ` / Due:${formatExcelSerialDate(thisDate)}` : "";
    const commitSegment = formatDateSegment("Commit", commitDate);
    return thisOrderNum ? `${thisType} /${thisOrderNum}${dueSegment}${commitSegment}` : `${thisType}${dueSegment}${commitSegment}`;
  }

  return `${thisType} /${thisOrderNum} /${thisLine} /${thisRel} /${thisPeggedQty} /${thisQty} / Due:${formatExcelSerialDate(thisDate)}${formatDateSegment(
    "Promise",
    promiseDate
  )}${formatDateSegment("Commit", commitDate)}${formatDateSegment("EarliestN", earliestN)}`;
}

function buildRowsFromXmlSource(tables: XmlSourceTables, progress?: FlattenedXlsxProgressReporter): ProcessedLayoutRow[] {
  reportProgress(progress, "Preparing XML workbook rows", 20);

  const demandRows = tables.rowsByFile.demands;
  const linkRows = tables.rowsByFile.links;
  const supplyRows = tables.rowsByFile.supplies;
  const poRows = tables.rowsByFile.poDetails;
  const jobRows = tables.rowsByFile.jobs;
  const descriptionRows = tables.rowsByFile.partDescriptions;

  const maxWDate = getMaxDate(
    supplyRows
      .filter((row) => asString(row.PegSupMst_SupplyType) === "W")
      .map((row) => isoToExcelSerial(xmlDateToIso(row.Calculated_ReportDate ?? row.PegSupMst_ReportDate ?? row.PegSupMst_SupplyDate)))
  );

  const partDescriptionByPartNum = new Map<string, string>();
  const partLeadByPartNum = new Map<string, number>();
  for (const row of descriptionRows) {
    const partNum = asString(row.PartNum);
    const description = asString(row.PartDescription);
    const lead = asNumber(row.PartLead);
    if (!partNum || !description) {
      if (!partNum || lead === undefined) {
        continue;
      }
    }
    if (partNum && lead !== undefined && !partLeadByPartNum.has(partNum)) {
      partLeadByPartNum.set(partNum, lead);
    }
    if (!partNum || !description) {
      continue;
    }
    if (!partDescriptionByPartNum.has(partNum)) {
      partDescriptionByPartNum.set(partNum, description);
    }
  }

  const linksByDemandSeq = new Map<string, LinkInfo[]>();
  for (const row of linkRows) {
    const link: LinkInfo = {
      company: asString(row.PegLink_Company),
      plant: asString(row.PegLink_Plant),
      demandSeq: asString(row.PegLink_DemandSeq),
      supplySeq: asString(row.PegLink_SupplySeq),
      peggedQty: asNumber(row.PegLink_PeggedQty),
      partNum: asString(row.PegLink_PartNum),
    };
    if (!link.company || !link.plant || !link.demandSeq || !link.supplySeq) {
      continue;
    }
    const existing = linksByDemandSeq.get(companyPlantSeqKey(link.company, link.plant, link.demandSeq)) ?? [];
    existing.push(link);
    linksByDemandSeq.set(companyPlantSeqKey(link.company, link.plant, link.demandSeq), existing);
  }

  const demandBySeq = new Map<string, DemandInfo>();
  const demandSeqsByOrderNum = new Map<string, string[]>();
  for (const row of demandRows) {
    const demand: DemandInfo = {
      demandSeq: asString(row.PegDmdMst_DemandSeq),
      company: asString(row.PegDmdMst_Company),
      plant: asString(row.PegDmdMst_Plant),
      demandType: asString(row.PegDmdMst_DemandType),
      demandOrdNum: asString(row.PegDmdMst_DemandOrdNum),
      demandOrdLine: asString(row.PegDmdMst_DemandOrdLine),
      demandOrdRel: asString(row.PegDmdMst_DemandOrdRel),
      partNum: asString(row.PegDmdMst_PartNum),
      demandQty: asNumber(row.PegDmdMst_DemandQty),
      demandDate: isoToExcelSerial(xmlDateToIso(row.PegDmdMst_DemandDate)),
    };
    if (!demand.demandSeq) {
      continue;
    }
    demandBySeq.set(companyPlantSeqKey(demand.company, demand.plant, demand.demandSeq), demand);
    if (demand.demandOrdNum) {
      const existing = demandSeqsByOrderNum.get(companyPlantOrderKey(demand.company, demand.plant, demand.demandOrdNum)) ?? [];
      existing.push(demand.demandSeq);
      demandSeqsByOrderNum.set(companyPlantOrderKey(demand.company, demand.plant, demand.demandOrdNum), existing);
    }
  }

  const poByOrderKey = new Map<string, XmlRow>();
  for (const row of poRows) {
    const key = `${normalizeJoinPart(asString(row.PORel_Company))}|${normalizeJoinPart(asString(row.PORel_Plant))}|${asString(row.PORel_PONum).trim()}|${asString(row.PORel_POLine).trim()}|${asString(row.PORel_PORelNum).trim()}`;
    poByOrderKey.set(key, row);
  }

  const jobsByOrderNum = new Map<string, JobSummary>();
  const jobRowsByNum = new Map<string, XmlRow[]>();
  for (const row of jobRows) {
    const company = asString(row.JobHead_Company);
    const plant = asString(row.JobHead_Plant);
    const jobNum = asString(row.Calculated_jobhead_jobnum) || asString(row.JobHead_JobNum);
    if (!company || !plant || !jobNum) {
      continue;
    }
    const existing = jobRowsByNum.get(companyPlantOrderKey(company, plant, jobNum)) ?? [];
    existing.push(row);
    jobRowsByNum.set(companyPlantOrderKey(company, plant, jobNum), existing);
  }
  for (const [jobKey, rows] of jobRowsByNum.entries()) {
    const openRows = rows.filter((r) => asString(r.JobOper_OpComplete).toLowerCase() !== "true");
    const minDue = getMinDate(openRows.map((r) => isoToExcelSerial(xmlDateToIso(r.JobOper_DueDate))));
    const commitDate = getMinDate(rows.map((r) => isoToExcelSerial(xmlDateToIso(r.JobHead_CommitDate_c))));

    const remainingOps = openRows
      .map((r) => `${asString(r.JobOper_OprSeq)}>${asString(r.JobOper_OpCode)} Due: ${xmlDateToIso(r.JobOper_DueDate)}`)
      .join("\n");
    const remainingOpsh = openRows
      .map(
        (r) =>
          `${asString(r.JobOper_OprSeq)}>${asString(r.JobOper_OpCode)} Due: ${xmlDateToIso(r.JobOper_DueDate)} SetH: ${asString(
            r.JobOper_EstSetHours
          )} RunH: ${asString(r.JobOper_EstProdHours)}`
      )
      .join("\n");

    jobsByOrderNum.set(jobKey, {
      commitDate,
      remainingOps,
      remainingOpsh,
      minDue,
    });
  }

  const supplyBySeq = new Map<string, SupplyInfo>();
  for (const row of supplyRows) {
    const company = asString(row.PegSupMst_Company);
    const plant = asString(row.PegSupMst_Plant);
    const supplySeq = asString(row.PegSupMst_SupplySeq);
    if (!company || !plant || !supplySeq) {
      continue;
    }

    const supplyType = asString(row.PegSupMst_SupplyType);
    const supplyOrdNum = asString(row.PegSupMst_SupplyOrdNum);
    const supplyOrdLine = asString(row.PegSupMst_SupplyOrdLine);
    const supplyOrdRel = asString(row.PegSupMst_SupplyOrdRel);
    const partNum = asString(row.PegSupMst_PartNum);
    const supplyQty = asNumber(row.PegSupMst_SupplyQty);

    let supplyDate: number | null = isoToExcelSerial(xmlDateToIso(row.PegSupMst_SupplyDate));
    if (supplyType === "P") {
      const poKey = `${supplyOrdNum}-${supplyOrdLine}-${supplyOrdRel}`;
      const po = poByOrderKey.get(poKey);
      if (po) {
        supplyDate =
          isoToExcelSerial(xmlDateToIso(po.PORel_PromiseDt)) ||
          isoToExcelSerial(xmlDateToIso(po.PORel_DueDate)) ||
          isoToExcelSerial(xmlDateToIso(po.POHeader_OrderDate));
      }
    }

    const jobSummary = jobsByOrderNum.get(companyPlantOrderKey(company, plant, supplyOrdNum));
    if (supplyDate === null && jobSummary?.commitDate !== undefined) {
      supplyDate = jobSummary.commitDate;
    }

    supplyBySeq.set(companyPlantSeqKey(company, plant, supplySeq), {
      company,
      plant,
      supplySeq,
      partNum,
      supplyType,
      supplyOrdNum,
      supplyOrdLine,
      supplyOrdRel,
      supplyQty,
      supplyDate,
    });
  }

  const seenNested = new Set<string>();
  const output: ProcessedLayoutRow[] = [];
  let stopExpansion = false;
  const MAX_ROWS = 200000;

  function reportRowProgress(): void {
    if (!progress || output.length === 0 || output.length % 2500 !== 0) {
      return;
    }
    reportProgress(progress, "Building XML rows", 60 + Math.min(30, Math.floor(output.length / 2500) * 2), `${output.length} rows`);
  }

  function addDemandRecursive(
    top: {
      company: string;
      plant: string;
      topPNum: string;
      topOrderNum: string;
      topLine: string;
      topRel: string;
      topQty: number;
      topDate: number | null;
    },
    demandSeq: string,
    nesting: number,
    state: { rowsSince1: number },
    prevNestedBOM: string,
    visitedDemandSeqs: Set<string>
  ): void {
    if (stopExpansion) {
      return;
    }
    if (nesting > 50) {
      return;
    }

    const links = linksByDemandSeq.get(companyPlantSeqKey(top.company, top.plant, demandSeq)) ?? [];
    const demand = demandBySeq.get(companyPlantSeqKey(top.company, top.plant, demandSeq));
    for (const link of links) {
      state.rowsSince1 += 1;

      const supply =
        supplyBySeq.get(companyPlantSeqKey(top.company, top.plant, link.supplySeq)) ??
        ({
          company: top.company,
          plant: top.plant,
          supplySeq: link.supplySeq,
          partNum: link.partNum,
          supplyType: "W",
          supplyOrdNum: "",
          supplyOrdLine: "",
          supplyOrdRel: "",
          supplyQty: link.peggedQty,
          supplyDate: demand?.demandDate ?? null,
        } satisfies SupplyInfo);

      const downstreamDemand = demandBySeq.get(companyPlantSeqKey(top.company, top.plant, supply.supplySeq));
      const fallbackOrderNum = supply.supplyType === "J" ? downstreamDemand?.demandOrdNum ?? "" : "";
      const fallbackLine = supply.supplyType === "J" ? downstreamDemand?.demandOrdLine ?? "" : "";
      const fallbackRel = supply.supplyType === "J" ? downstreamDemand?.demandOrdRel ?? "" : "";
      const effectiveSupplyOrdNum = supply.supplyOrdNum || fallbackOrderNum;
      const effectiveSupplyLine = supply.supplyOrdLine || fallbackLine;
      const effectiveSupplyRel = supply.supplyOrdRel || fallbackRel;
      const displayOrderNum = effectiveSupplyOrdNum;
      const displayLine = displayOrderNum ? effectiveSupplyLine : "";
      const displayRel = displayOrderNum ? effectiveSupplyRel : "";

      const nestedBOM = `${prevNestedBOM}>${supply.partNum}`;
      const duplicate = seenNested.has(`${top.topOrderNum}|${top.topLine}|${top.topRel}|${nestedBOM}`);
      seenNested.add(`${top.topOrderNum}|${top.topLine}|${top.topRel}|${nestedBOM}`);

      const promiseDate = supply.supplyType === "P" ? supply.supplyDate : null;
      const job = jobsByOrderNum.get(companyPlantOrderKey(top.company, top.plant, effectiveSupplyOrdNum));
      const commitDate = supply.supplyType === "J" ? job?.commitDate ?? supply.supplyDate : null;
      const minDue = job?.minDue ?? supply.supplyDate;
      const leadFromTimePhase = partLeadByPartNum.get(supply.partNum) ?? 0;
      const earliestN = supply.supplyType === "N" && maxWDate !== null ? maxWDate - Math.trunc((-7 / 5) * leadFromTimePhase) : null;
      const warning = makeWarning(top.topDate ?? 0, supply.supplyDate ?? 0, promiseDate ?? 0, commitDate ?? 0, minDue ?? 0, maxWDate ?? 0);
      const poKey = `${normalizeJoinPart(top.company)}|${normalizeJoinPart(top.plant)}|${effectiveSupplyOrdNum.trim()}|${effectiveSupplyLine.trim()}|${effectiveSupplyRel.trim()}`;
      const po = poByOrderKey.get(poKey);
      const vendorName = asString(po?.Vendor_Name);

      const willShip = getMaxDate([supply.supplyDate, promiseDate, commitDate, minDue, earliestN]);
      const myText2 = buildMyText2(
        supply.supplyType,
        displayOrderNum,
        displayLine,
        displayRel,
        link.peggedQty,
        supply.supplyQty,
        supply.supplyDate,
        promiseDate,
        commitDate,
        earliestN
      );
      const myText3 = `${myText2}${appendTextLine(job?.remainingOps ?? "", !displayOrderNum.startsWith("UNF"))}`;
      const myText4 = `${myText2}${appendTextLine(vendorName)}${appendTextLine(job?.remainingOps ?? "")}`;
      const myText5 = `${myText2}${appendTextLine(vendorName)}${appendTextLine(job?.remainingOpsh ?? "")}`;

      output.push({
        LineID: 0,
        Company: companyDisplayLabel(top.company, top.plant),
        topPNum: top.topPNum,
        topOrderNum: top.topOrderNum,
        topLine: top.topLine,
        topRel: top.topRel,
        topQty: top.topQty,
        topDate: top.topDate,
        nest: nesting,
        nestText: ">".repeat(nesting),
        thisPNum: supply.partNum,
        thisDesc: partDescriptionByPartNum.get(supply.partNum) ?? "",
        ThisOrderNum: displayOrderNum,
        ThisLine: displayLine,
        ThisRel: displayRel,
        ThisQty: supply.supplyQty,
        thisPeggedQty: link.peggedQty,
        thisDate: supply.supplyDate,
        thisType: supply.supplyType,
        DemandSeq: parseSeqFromId(demandSeq, "DEM"),
        SupplySeq: parseSeqFromId(supply.supplySeq, "SUP"),
        dmdDate: demand?.demandDate ?? null,
        rowsSince1: state.rowsSince1,
        duplicate,
        PORel_PromiseDt: promiseDate,
        JobHead_CommitDate_c: commitDate,
        earliestN,
        RemainingOps: job?.remainingOps ?? "",
        RemainingOpsh: job?.remainingOpsh ?? "",
        MinDue: minDue ?? 0,
        Warning: warning,
        myText1: text1(supply.supplyType, warning),
        myText2,
        myText3,
        myText4,
        myText5,
        LeadFromTimePhase: leadFromTimePhase,
        willShip,
        willShipText: "Latest of due, PO promise, WO commit, earliestN or maxW",
        OrderBy: supply.supplyDate !== null ? supply.supplyDate - leadFromTimePhase : null,
      });
      reportRowProgress();

      if (output.length >= MAX_ROWS) {
        stopExpansion = true;
        return;
      }

      const childCandidates = new Set<string>();

      // Access behavior: recurse by matching supply order number to downstream demand order number.
      const parentDemandOrdNum = demand?.demandOrdNum ?? "";
      const recursionAllowed =
        supply.supplyType === "J" &&
        effectiveSupplyOrdNum.length > 0 &&
        effectiveSupplyOrdNum !== parentDemandOrdNum;

      if (recursionAllowed) {
        const byOrderNum = demandSeqsByOrderNum.get(companyPlantOrderKey(top.company, top.plant, effectiveSupplyOrdNum)) ?? [];
        for (const seq of byOrderNum) {
          const childDemand = demandBySeq.get(companyPlantSeqKey(top.company, top.plant, seq));
          if (!childDemand?.demandOrdNum) {
            continue;
          }
          childCandidates.add(seq);
        }
      }

      for (const childSeq of childCandidates) {
        if (!childSeq || childSeq === demandSeq) {
          continue;
        }
        if (visitedDemandSeqs.has(childSeq)) {
          continue;
        }

        visitedDemandSeqs.add(childSeq);
        addDemandRecursive(top, childSeq, nesting + 1, state, nestedBOM, visitedDemandSeqs);
        visitedDemandSeqs.delete(childSeq);
      }
    }
  }

  const rootDemands = Array.from(demandBySeq.values()).filter((d) => d.demandType === "S");
  for (const root of rootDemands) {
    const state = { rowsSince1: 0 };
    addDemandRecursive(
      {
        company: root.company,
        plant: root.plant,
        topPNum: root.partNum,
        topOrderNum: root.demandOrdNum,
        topLine: root.demandOrdLine,
        topRel: root.demandOrdRel,
        topQty: root.demandQty,
        topDate: root.demandDate,
      },
      root.demandSeq,
      1,
      state,
      root.company,
      new Set([root.demandSeq])
    );
  }

  const startLine = 1;
  for (let i = 0; i < output.length; i += 1) {
    const row = output[i];
    if (!row) {
      continue;
    }
    row.LineID = startLine + i;
  }

  return output;
}

function buildRows(datasets: CanonicalDatasets, progress?: FlattenedXlsxProgressReporter): ProcessedLayoutRow[] {
  reportProgress(progress, "Preparing workbook rows", 20);

  const demandMap = new Map(datasets.demands.map((row) => [row.id, row]));
  const supplyMap = new Map(datasets.supplies.map((row) => [row.id, row]));
  const salesOrderMap = new Map(datasets.salesOrders.map((row) => [row.id, row]));
  const partMap = new Map(datasets.partCatalog.map((row) => [row.partNumber, row]));

  const maxWDate = getMaxDate(
    datasets.supplies
      .filter((row) => row.supplyType === "ON_HAND")
      .map((row) => isoToExcelSerial(row.reportDate ?? row.availableDate))
  );

  const rows: ProcessedLayoutRow[] = [];
  const startLineId = 1;

  function reportRowProgress(): void {
    if (!progress || rows.length === 0 || rows.length % 2500 !== 0) {
      return;
    }
    reportProgress(progress, "Building workbook rows", 60 + Math.min(30, Math.floor(rows.length / 2500) * 2), `${rows.length} rows`);
  }

  for (const [i, link] of datasets.peggingLinks.entries()) {
    const demand = demandMap.get(link.demandId);
    const supply = supplyMap.get(link.supplyId);
    const salesOrder = demand?.sourceType === "SO" && demand.sourceId ? salesOrderMap.get(demand.sourceId) : undefined;
    const partNumber = demand?.partNumber ?? supply?.partNumber ?? "";
    const partDescription = partMap.get(partNumber)?.description ?? "";

    const topDate = isoToExcelSerial(salesOrder?.dueDate ?? demand?.dueDate);
    const thisDate = isoToExcelSerial(supply?.availableDate ?? demand?.dueDate);
    const dmdDate = isoToExcelSerial(demand?.dueDate);

    const salesIdentity = parseSalesOrderIdentity(salesOrder?.id ?? demand?.sourceId);
    const supplyIdentity = parseSupplyIdentity(supply?.sourceId);

    const leadFromTimePhase = partMap.get(partNumber)?.lead ?? 0;
    const earliestN = supply?.supplyType === "ON_HAND" && maxWDate !== null ? maxWDate - Math.trunc((-7 / 5) * leadFromTimePhase) : null;
    const willShip = topDate ?? thisDate ?? dmdDate;

    rows.push({
      LineID: startLineId + i,
      Company: "CompanyXYZ",
      topPNum: salesOrder?.partNumber ?? partNumber,
      topOrderNum: salesOrder?.orderNumber ?? salesIdentity.orderNum,
      topLine: salesIdentity.line,
      topRel: salesIdentity.rel,
      topQty: salesOrder?.quantity ?? demand?.quantity ?? 0,
      topDate,
      nest: 1,
      nestText: ">",
      thisPNum: partNumber,
      thisDesc: partDescription,
      ThisOrderNum: supplyIdentity.orderNum,
      ThisLine: supplyIdentity.line,
      ThisRel: supplyIdentity.rel,
      ThisQty: supply?.quantity ?? 0,
      thisPeggedQty: link.quantity,
      thisDate,
      thisType: mapSupplyType(supply?.supplyType),
      DemandSeq: parseSeqFromId(link.demandId, "DEM"),
      SupplySeq: parseSeqFromId(link.supplyId, "SUP"),
      dmdDate,
      rowsSince1: i + 1,
      duplicate: false,
      PORel_PromiseDt: supply?.supplyType === "PO" ? thisDate : null,
      JobHead_CommitDate_c: supply?.supplyType === "WO" ? thisDate : null,
      earliestN,
      RemainingOps: "",
      RemainingOpsh: "",
      MinDue: 0,
      Warning: "",
      myText1: `${supply?.supplyType ?? ""} /${supplyIdentity.orderNum} /${supplyIdentity.line} /${supplyIdentity.rel} /${link.quantity}`,
      myText2: `${demand?.sourceType ?? ""} /${salesIdentity.orderNum} /${salesIdentity.line} /${salesIdentity.rel}`,
      myText3: link.id,
      myText4: link.demandId,
      myText5: link.supplyId,
      LeadFromTimePhase: leadFromTimePhase,
      willShip,
      willShipText: "Latest of due, PO promise, WO commit, earliestN or maxW",
      OrderBy: thisDate !== null ? thisDate - leadFromTimePhase : null,
    });
    reportRowProgress();
  }

  return rows;
}

export async function writeFlattenedXlsx(
  outputFile: string,
  datasets: CanonicalDatasets,
  progress?: FlattenedXlsxProgressReporter
): Promise<number> {
  const workbook = XLSX.utils.book_new();

  reportProgress(progress, "Starting workbook export", 10);
  const rows = buildRows(datasets, progress);
  reportProgress(progress, "Writing workbook file", 95, `${rows.length} rows`);
  const sheet = XLSX.utils.json_to_sheet(rows, { header: LAYOUT_COLUMNS });
  XLSX.utils.book_append_sheet(workbook, sheet, "tblPeggingPlus2");

  await fs.mkdir(path.dirname(outputFile), { recursive: true });
  XLSX.writeFile(workbook, outputFile);
  reportProgress(progress, "Workbook export complete", 100, `${rows.length} rows`);
  return rows.length;
}

export async function writeFlattenedXlsxFromXmlSource(
  outputFile: string,
  sourceTables: XmlSourceTables,
  fallbackDatasets: CanonicalDatasets,
  progress?: FlattenedXlsxProgressReporter
): Promise<number> {
  const workbook = XLSX.utils.book_new();
  reportProgress(progress, "Starting XML export", 10);
  const recursiveRows = buildRowsFromXmlSource(sourceTables, progress);
  const rows = recursiveRows.length > 0 ? recursiveRows : buildRows(fallbackDatasets);

  reportProgress(progress, "Writing workbook file", 95, `${rows.length} rows`);

  const sheet = XLSX.utils.json_to_sheet(rows, { header: LAYOUT_COLUMNS });
  XLSX.utils.book_append_sheet(workbook, sheet, "tblPeggingPlus2");

  await fs.mkdir(path.dirname(outputFile), { recursive: true });
  XLSX.writeFile(workbook, outputFile);
  reportProgress(progress, "Workbook export complete", 100, `${rows.length} rows`);
  return rows.length;
}
