"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.writeFlattenedXlsx = writeFlattenedXlsx;
exports.buildRowsFromXmlSource = buildRowsFromXmlSource;
exports.writeFlattenedXlsxFromXmlSource = writeFlattenedXlsxFromXmlSource;
const promises_1 = __importDefault(require("node:fs/promises"));
const node_path_1 = __importDefault(require("node:path"));
const XLSX = __importStar(require("xlsx"));
function reportProgress(progress, stage, progressValue, detail) {
    if (!progress) {
        return;
    }
    const update = {
        stage,
        progress: Math.max(0, Math.min(100, progressValue)),
    };
    if (detail !== undefined) {
        update.detail = detail;
    }
    progress(update);
}
const LAYOUT_COLUMNS = [
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
    "JobHead_CommitDate_c",
    "RemainingOps",
    "RemainingOpsh",
    "MinDue",
    "myText1",
    "myText2",
    "myText3",
    "myText4",
    "myText5",
    "willShip",
    "willShipText",
];
function isoToExcelSerial(isoDate) {
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
function parseSalesOrderIdentity(id) {
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
function parseSupplyIdentity(sourceId) {
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
function parseSeqFromId(id, prefix) {
    const cleaned = id.replace(`${prefix}-`, "");
    const asNum = Number(cleaned);
    return Number.isFinite(asNum) ? asNum : cleaned;
}
function companyDisplayLabel(company, plant) {
    const c = (company ?? "").trim();
    const p = (plant ?? "").trim();
    if (c && p) {
        return `${c}-${p}`;
    }
    return c || "CompanyXYZ";
}
function mapSupplyType(supplyType) {
    if (supplyType === "WO") {
        return "J";
    }
    if (supplyType === "ON_HAND") {
        return "W";
    }
    if (supplyType === "PO") {
        return "P";
    }
    if (supplyType === "UNPLANNED") {
        return "N";
    }
    return "N"; // Fallback to N for any unknown type
}
function getMaxDate(values) {
    const filtered = values.filter((v) => v !== null);
    if (filtered.length === 0) {
        return null;
    }
    return Math.max(...filtered);
}
function makeWarning(topDate, dueDate, promiseDate, commitDate, minDue, reportDate) {
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
function text1(thisType, warning) {
    let value = "Y";
    if (thisType === "W") {
        value = "G";
    }
    if (warning === "Y") {
        value = "A";
    }
    return value;
}
function appendTextLine(value, include = true) {
    if (!include) {
        return "";
    }
    const trimmed = value.trim();
    if (!trimmed) {
        return "";
    }
    return `\r\n${trimmed}`;
}
function formatExcelSerialDate(serial) {
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
function formatAccessDate(serial) {
    if (serial === null) {
        return "";
    }
    const wholeDays = Math.floor(serial);
    const base = Date.UTC(1899, 11, 30);
    const date = new Date(base + wholeDays * 24 * 60 * 60 * 1000);
    if (Number.isNaN(date.getTime())) {
        return "";
    }
    const month = date.getUTCMonth() + 1;
    const day = date.getUTCDate();
    const year = date.getUTCFullYear();
    return `${month}/${day}/${year}`;
}
function formatAccessNumber(value) {
    if (typeof value === "number" && Number.isFinite(value)) {
        return String(value);
    }
    if (typeof value === "string") {
        const parsed = Number(value);
        if (Number.isFinite(parsed)) {
            return String(parsed);
        }
    }
    return "";
}
function buildMyText2(thisType, thisOrderNum, thisLine, thisRel, thisPeggedQty, thisQty, thisDate, promiseDate, commitDate, earliestN = null) {
    const base = `${thisType} /${thisOrderNum} /${thisLine} /${thisRel} /${thisPeggedQty} /${thisQty} / Due:${formatExcelSerialDate(thisDate)}`;
    let result = base;
    // Conditionally add Promise date if not null
    if (promiseDate !== null) {
        result += ` / Promise:${formatExcelSerialDate(promiseDate)}`;
    }
    // Conditionally add Commit date if not null
    if (commitDate !== null) {
        result += ` / Commit:${formatExcelSerialDate(commitDate)}`;
    }
    // Conditionally add EarliestN date if not null
    if (earliestN !== null) {
        result += ` / EarliestN:${formatExcelSerialDate(earliestN)}`;
    }
    return result;
}
function buildRows(datasets, progress) {
    reportProgress(progress, "Preparing workbook rows", 20);
    const demandMap = new Map(datasets.demands.map((row) => [row.id, row]));
    const supplyMap = new Map(datasets.supplies.map((row) => [row.id, row]));
    const salesOrderMap = new Map(datasets.salesOrders.map((row) => [row.id, row]));
    const partMap = new Map(datasets.partCatalog.map((row) => [row.partNumber, row]));
    const maxWDate = getMaxDate(datasets.supplies
        .filter((row) => row.supplyType === "ON_HAND")
        .map((row) => isoToExcelSerial(row.reportDate ?? row.availableDate)));
    const rows = [];
    const startLineId = 1;
    function reportRowProgress() {
        if (!progress || rows.length === 0 || rows.length % 2500 !== 0) {
            return;
        }
        reportProgress(progress, "Building workbook rows", 60 + Math.min(30, Math.floor(rows.length / 2500) * 2), `${rows.length} rows`);
    }
    for (const [i, link] of datasets.peggingLinks.entries()) {
        const demand = demandMap.get(link.demandId);
        const supply = supplyMap.get(link.supplyId);
        const salesOrder = demand?.sourceType === "SO" && demand.sourceId ? salesOrderMap.get(demand.sourceId) : undefined;
        const topPartNumber = salesOrder?.partNumber ?? demand?.partNumber ?? supply?.partNumber ?? "";
        const thisPartNumber = supply?.partNumber ?? demand?.partNumber ?? "";
        const partDescription = partMap.get(thisPartNumber)?.description ?? "";
        const topDate = isoToExcelSerial(salesOrder?.dueDate ?? demand?.dueDate);
        const thisDate = isoToExcelSerial(supply?.availableDate ?? demand?.dueDate);
        const dmdDate = isoToExcelSerial(demand?.dueDate);
        const salesIdentity = parseSalesOrderIdentity(salesOrder?.id ?? demand?.sourceId);
        const supplyIdentity = parseSupplyIdentity(supply?.sourceId);
        const leadFromTimePhase = partMap.get(thisPartNumber)?.lead ?? 0;
        const earliestN = supply?.supplyType === "ON_HAND" && maxWDate !== null ? maxWDate - Math.trunc((-7 / 5) * leadFromTimePhase) : null;
        const thisType = mapSupplyType(supply?.supplyType);
        const promiseDate = isoToExcelSerial(supply?.promiseDate) ?? (supply?.supplyType === "PO" ? thisDate : null);
        const commitDate = isoToExcelSerial(supply?.commitDate) ?? (supply?.supplyType === "WO" ? thisDate : null);
        const minDue = isoToExcelSerial(supply?.minDue) ?? thisDate;
        const willShip = getMaxDate([topDate, thisDate, promiseDate, commitDate, minDue, earliestN]);
        const warning = makeWarning(topDate ?? 0, thisDate ?? 0, promiseDate ?? 0, commitDate ?? 0, minDue ?? 0, maxWDate ?? 0);
        const myText1 = text1(thisType, warning);
        const myText2 = buildMyText2(thisType, supplyIdentity.orderNum, supplyIdentity.line, supplyIdentity.rel, link.quantity, supply?.quantity ?? 0, thisDate, promiseDate, commitDate, earliestN);
        // myText3: myText2 + remainingOps (if not null and not UNF) - NO VENDOR (user requirement)
        const myText3 = `${myText2}${appendTextLine(supply?.remainingOps ?? "", !supplyIdentity.orderNum.startsWith("UNF"))}`;
        // myText4: myText2 + vendor + remainingOps
        const myText4 = `${myText2}${appendTextLine(supply?.vendorName ?? "")}${appendTextLine(supply?.remainingOps ?? "")}`;
        // myText5: myText2 + vendor + remainingOpsh
        const myText5 = `${myText2}${appendTextLine(supply?.vendorName ?? "")}${appendTextLine(supply?.remainingOpsh ?? "")}`;
        rows.push({
            LineID: startLineId + i,
            Company: companyDisplayLabel(supply?.company ?? demand?.company, supply?.plant ?? demand?.plant),
            topPNum: topPartNumber,
            topOrderNum: salesOrder?.orderNumber ?? salesIdentity.orderNum,
            topLine: salesIdentity.line,
            topRel: salesIdentity.rel,
            topQty: salesOrder?.quantity ?? demand?.quantity ?? 0,
            topDate,
            nest: link.nest,
            nestText: link.nestText ?? ">".repeat(link.nest),
            thisPNum: thisPartNumber,
            thisDesc: partDescription,
            ThisOrderNum: supply?.supplyType === "ON_HAND" ? undefined : supplyIdentity.orderNum,
            ThisLine: supplyIdentity.line,
            ThisRel: supply?.supplyType === "ON_HAND" ? undefined : supplyIdentity.rel,
            ThisQty: supply?.quantity ?? 0,
            thisPeggedQty: link.quantity,
            thisDate,
            thisType,
            DemandSeq: parseSeqFromId(link.demandId, "DEM"),
            SupplySeq: parseSeqFromId(link.supplyId, "SUP"),
            dmdDate,
            rowsSince1: i + 1,
            duplicate: false,
            JobHead_CommitDate_c: commitDate ?? undefined,
            RemainingOps: supply?.remainingOps ?? "",
            RemainingOpsh: supply?.remainingOpsh ?? "",
            MinDue: minDue ?? 0,
            myText1,
            myText2,
            myText3,
            myText4,
            myText5,
            willShip,
            willShipText: "Latest of due, PO promise, WO commit, earliestN or maxW",
        });
        reportRowProgress();
    }
    return rows;
}
async function writeFlattenedXlsx(outputFile, datasets, progress) {
    const workbook = XLSX.utils.book_new();
    reportProgress(progress, "Starting workbook export", 10);
    const rows = buildRows(datasets, progress);
    reportProgress(progress, "Writing workbook file", 95, `${rows.length} rows`);
    const sheet = XLSX.utils.json_to_sheet(rows, { header: LAYOUT_COLUMNS });
    XLSX.utils.book_append_sheet(workbook, sheet, "tblPeggingPlus2");
    await promises_1.default.mkdir(node_path_1.default.dirname(outputFile), { recursive: true });
    XLSX.writeFile(workbook, outputFile);
    reportProgress(progress, "Workbook export complete", 100, `${rows.length} rows`);
    return rows.length;
}
function asString(value) {
    if (typeof value === "string") {
        return value;
    }
    if (typeof value === "number" && Number.isFinite(value)) {
        return String(value);
    }
    return "";
}
function asNumber(value) {
    if (typeof value === "number" && Number.isFinite(value)) {
        return value;
    }
    if (typeof value === "string") {
        const parsed = Number(value);
        return Number.isFinite(parsed) ? parsed : 0;
    }
    return 0;
}
function xmlDateToIso(value) {
    const raw = asString(value).trim();
    if (!raw) {
        return "";
    }
    return raw.includes("T") ? raw.slice(0, 10) : raw;
}
function normalizeXmlSupplyType(xmlType) {
    const t = (xmlType ?? "").toUpperCase();
    if (t === "P") {
        return "PO";
    }
    if (t === "W") {
        return "ON_HAND";
    }
    if (t === "J") {
        return "WO";
    }
    if (t === "N" || t === "M" || t === "") {
        // N = unplanned/other, M = misc, blank = default to unplanned
        return "UNPLANNED";
    }
    // Default to WO for any other type
    return "WO";
}
function getMinDate(values) {
    const filtered = values.filter((v) => v !== null);
    if (filtered.length === 0) {
        return null;
    }
    return Math.min(...filtered);
}
function buildRowsFromXmlSource(tables, progress) {
    reportProgress(progress, "Preparing XML workbook rows", 20);
    const demandRows = tables.rowsByFile.demands;
    const linkRows = tables.rowsByFile.links;
    const supplyRows = tables.rowsByFile.supplies;
    const poRows = tables.rowsByFile.poDetails;
    const jobRows = tables.rowsByFile.jobs;
    const descriptionRows = tables.rowsByFile.partDescriptions;
    const maxWDate = getMaxDate(supplyRows
        .filter((row) => asString(row.PegSupMst_SupplyType) === "W")
        .map((row) => isoToExcelSerial(xmlDateToIso(row.Calculated_ReportDate ?? row.PegSupMst_ReportDate ?? row.PegSupMst_SupplyDate))));
    const partDescriptionByPartNum = new Map();
    const partLeadByPartNum = new Map();
    for (const row of descriptionRows) {
        const partNum = asString(row.PartNum);
        const description = asString(row.PartDescription);
        const lead = asNumber(row.PartLead);
        if (partNum && lead !== 0 && !partLeadByPartNum.has(partNum)) {
            partLeadByPartNum.set(partNum, lead);
        }
        if (partNum && description && !partDescriptionByPartNum.has(partNum)) {
            partDescriptionByPartNum.set(partNum, description);
        }
    }
    const linksByDemandSeq = new Map();
    for (const row of linkRows) {
        const demandSeq = asString(row.PegLink_DemandSeq);
        if (!demandSeq)
            continue;
        const link = { supplySeq: asString(row.PegLink_SupplySeq), peggedQty: asNumber(row.PegLink_PeggedQty), partNum: asString(row.PegLink_PartNum) };
        const existing = linksByDemandSeq.get(demandSeq) ?? [];
        existing.push(link);
        linksByDemandSeq.set(demandSeq, existing);
    }
    const demandBySeq = new Map();
    for (const row of demandRows) {
        const demandSeq = asString(row.PegDmdMst_DemandSeq);
        if (!demandSeq)
            continue;
        demandBySeq.set(demandSeq, {
            demandSeq,
            demandType: asString(row.PegDmdMst_DemandType),
            demandOrdNum: asString(row.PegDmdMst_DemandOrdNum),
            demandOrdLine: asString(row.PegDmdMst_DemandOrdLine) ?? "0",
            demandOrdRel: asString(row.PegDmdMst_DemandOrdRel) ?? "0",
            partNum: asString(row.PegDmdMst_PartNum),
            demandQty: asNumber(row.PegDmdMst_DemandQty),
            demandDate: isoToExcelSerial(xmlDateToIso(row.PegDmdMst_DemandDate)),
            company: asString(row.PegDmdMst_Company),
            plant: asString(row.PegDmdMst_Plant),
        });
    }
    const poByOrderKey = new Map();
    const vendorByPoKey = new Map();
    for (const row of poRows) {
        const key = `${asString(row.PORel_PONum)}|${asString(row.PORel_POLine)}|${asString(row.PORel_PORelNum)}`;
        poByOrderKey.set(key, row);
        const vendorName = asString(row.Vendor_Name);
        if (vendorName && !vendorByPoKey.has(key)) {
            vendorByPoKey.set(key, vendorName);
        }
    }
    const jobsByOrderNum = new Map();
    const jobRowsByNum = new Map();
    for (const row of jobRows) {
        const jobNum = asString(row.Calculated_jobhead_jobnum) || asString(row.JobHead_JobNum);
        if (!jobNum)
            continue;
        const existing = jobRowsByNum.get(jobNum) ?? [];
        existing.push(row);
        jobRowsByNum.set(jobNum, existing);
    }
    for (const [jobNum, rows] of jobRowsByNum.entries()) {
        const openRows = rows.filter((r) => asString(r.JobOper_OpComplete).toLowerCase() !== "true");
        const minDue = getMinDate(openRows.map((r) => isoToExcelSerial(xmlDateToIso(r.JobOper_DueDate))));
        const commitDate = getMinDate(rows.map((r) => isoToExcelSerial(xmlDateToIso(r.JobHead_CommitDate_c))));
        const remainingOps = openRows
            .map((r) => `${asString(r.JobOper_OprSeq)}>${asString(r.JobOper_OpCode)} Due: ${formatAccessDate(isoToExcelSerial(xmlDateToIso(r.JobOper_DueDate)))}`)
            .join("\r\n");
        const remainingOpsh = openRows
            .map((r) => `${asString(r.JobOper_OprSeq)}>${asString(r.JobOper_OpCode)} Due: ${formatAccessDate(isoToExcelSerial(xmlDateToIso(r.JobOper_DueDate)))} SetH: ${formatAccessNumber(r.JobOper_EstSetHours)} RunH: ${formatAccessNumber(r.JobOper_EstProdHours)}`)
            .join("\r\n");
        jobsByOrderNum.set(jobNum, { commitDate, minDue, remainingOps, remainingOpsh });
    }
    const supplyBySeq = new Map();
    for (const row of supplyRows) {
        const supplySeq = asString(row.PegSupMst_SupplySeq);
        if (!supplySeq)
            continue;
        const rawSupplyType = asString(row.PegSupMst_SupplyType);
        const supplyType = normalizeXmlSupplyType(rawSupplyType);
        const supplyOrdNum = asString(row.PegSupMst_SupplyOrdNum);
        const supplyOrdLine = asString(row.PegSupMst_SupplyOrdLine);
        const supplyOrdRel = asString(row.PegSupMst_SupplyOrdRel);
        const partNum = asString(row.PegSupMst_PartNum);
        const supplyQty = asNumber(row.PegSupMst_SupplyQty);
        let supplyDate = isoToExcelSerial(xmlDateToIso(row.PegSupMst_SupplyDate));
        if (supplyType === "PO") {
            const poKey = `${supplyOrdNum}|${supplyOrdLine}|${supplyOrdRel}`;
            const po = poByOrderKey.get(poKey);
            if (po) {
                supplyDate =
                    isoToExcelSerial(xmlDateToIso(po.PORel_PromiseDt)) ||
                        isoToExcelSerial(xmlDateToIso(po.PORel_DueDate)) ||
                        isoToExcelSerial(xmlDateToIso(po.POHeader_OrderDate));
            }
        }
        else if (supplyType === "WO") {
            const jobSummary = jobsByOrderNum.get(supplyOrdNum);
            if (jobSummary?.commitDate !== null && jobSummary?.commitDate !== undefined) {
                supplyDate = jobSummary.commitDate;
            }
        }
        supplyBySeq.set(supplySeq, {
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
    const seenNested = new Set();
    const output = [];
    function reportRowProgress() {
        if (!progress || output.length === 0 || output.length % 2500 !== 0) {
            return;
        }
        reportProgress(progress, "Building XML rows", 60 + Math.min(30, Math.floor(output.length / 2500) * 2), `${output.length} rows`);
    }
    function addDemandRecursive(top, demandSeq, nesting, prevNestedBOM, visitedDemandSeqs, rowsSince1) {
        if (nesting > 50 || output.length >= 200000) {
            return rowsSince1;
        }
        const links = linksByDemandSeq.get(demandSeq) ?? [];
        const demand = demandBySeq.get(demandSeq);
        for (const link of links) {
            rowsSince1 += 1;
            const supply = supplyBySeq.get(link.supplySeq) ?? {
                supplySeq: link.supplySeq,
                partNum: link.partNum,
                supplyType: "ON_HAND",
                supplyOrdNum: "",
                supplyOrdLine: "",
                supplyOrdRel: "",
                supplyQty: link.peggedQty,
                supplyDate: demand?.demandDate ?? null,
            };
            const effectiveSupplyOrdNum = supply.supplyOrdNum;
            const effectiveSupplyLine = supply.supplyOrdLine;
            const effectiveSupplyRel = supply.supplyOrdRel;
            const nestedBOM = `${prevNestedBOM}>${supply.partNum}`;
            const duplicate = seenNested.has(`${top.topOrderNum}|${top.topLine}|${top.topRel}|${nestedBOM}`);
            if (!duplicate) {
                seenNested.add(`${top.topOrderNum}|${top.topLine}|${top.topRel}|${nestedBOM}`);
            }
            const thisPartNumber = supply.partNum;
            const partDescription = partDescriptionByPartNum.get(thisPartNumber) ?? "";
            const thisType = mapSupplyType(supply.supplyType);
            const promiseDate = supply.supplyType === "PO" ? supply.supplyDate : null;
            const commitDate = supply.supplyType === "WO" ? supply.supplyDate : null;
            const jobSummary = supply.supplyType === "WO" ? jobsByOrderNum.get(supply.supplyOrdNum) : undefined;
            const minDue = supply.supplyType === "WO" ? jobSummary?.minDue ?? 0 : 0;
            // earliestN: calculated for UNPLANNED type (N), calculated as maxWDate - Int(-7/5 * lead)
            // Access formula: IIf([thisType] = "N", [MaxOfPegSupMst_SupplyDate] - Int(-7 / 5 * [LeadFromTimePhase]), NULL)
            const leadFromTimePhase = partLeadByPartNum.get(supply.partNum) ?? 0;
            const earliestN = supply.supplyType === "UNPLANNED" && maxWDate !== null ? maxWDate - Math.trunc((-7 / 5) * leadFromTimePhase) : null;
            const willShip = getMaxDate([top.topDate, supply.supplyDate, promiseDate, commitDate, minDue, earliestN, maxWDate]);
            const warning = makeWarning(top.topDate ?? 0, supply.supplyDate ?? 0, promiseDate ?? 0, commitDate ?? 0, minDue ?? 0, maxWDate ?? 0);
            const myText1 = text1(thisType, warning);
            const myText2 = buildMyText2(thisType, effectiveSupplyOrdNum, effectiveSupplyLine, effectiveSupplyRel, link.peggedQty, supply.supplyQty, supply.supplyDate, promiseDate, commitDate, earliestN);
            // Get vendor name from PO
            const vendorKey = `${supply.supplyOrdNum}|${supply.supplyOrdLine}|${supply.supplyOrdRel}`;
            const vendorName = supply.supplyType === "PO" ? vendorByPoKey.get(vendorKey) ?? "" : "";
            // Get operations from job
            const remainingOps = supply.supplyType === "WO" ? jobSummary?.remainingOps ?? "" : "";
            const remainingOpsh = supply.supplyType === "WO" ? jobSummary?.remainingOpsh ?? "" : "";
            // myText3: myText2 + remainingOps (if not null and not UNF) - NO VENDOR (user requirement)
            const isUnfOrder = effectiveSupplyOrdNum.toUpperCase().startsWith("UNF");
            const myText3 = `${myText2}${appendTextLine(remainingOps, !isUnfOrder)}`;
            // myText4: myText2 + vendor + remainingOps
            const myText4 = `${myText2}${appendTextLine(vendorName)}${appendTextLine(remainingOps)}`;
            // myText5: myText2 + vendor + remainingOpsh
            const myText5 = `${myText2}${appendTextLine(vendorName)}${appendTextLine(remainingOpsh)}`;
            output.push({
                LineID: output.length + 1,
                Company: top.company,
                topPNum: top.topPNum,
                topOrderNum: top.topOrderNum,
                topLine: top.topLine,
                topRel: top.topRel,
                topQty: top.topQty,
                topDate: top.topDate,
                nest: nesting,
                nestText: ">".repeat(nesting),
                thisPNum: thisPartNumber,
                thisDesc: partDescription,
                // ON_HAND supplies don't have order details, others do
                ThisOrderNum: supply.supplyType === "ON_HAND" ? null : effectiveSupplyOrdNum,
                ThisLine: effectiveSupplyLine,
                ThisRel: supply.supplyType === "ON_HAND" ? null : effectiveSupplyRel,
                ThisQty: supply.supplyQty,
                thisPeggedQty: link.peggedQty,
                thisDate: supply.supplyDate,
                thisType,
                DemandSeq: parseSeqFromId(demandSeq, "DEM"),
                SupplySeq: parseSeqFromId(link.supplySeq, "SUP"),
                dmdDate: demand?.demandDate ?? null,
                rowsSince1,
                duplicate,
                JobHead_CommitDate_c: commitDate,
                RemainingOps: supply.supplyType === "WO" ? remainingOps : null,
                RemainingOpsh: supply.supplyType === "WO" ? remainingOpsh : null,
                MinDue: minDue ?? 0,
                myText1,
                myText2,
                myText3,
                myText4,
                myText5,
                willShip,
                willShipText: "Latest of due, PO promise, WO commit, earliestN or maxW",
            });
            reportRowProgress();
            // Recursively get demands where this supply order is the source (matching VBA logic)
            // VBA checks: supply order exists AND supply != demand AND they're not both UNF-blocked
            // Using noUnf=False (include all) by default
            const hasSupplyOrder = supply.supplyOrdNum && supply.supplyOrdNum.trim() !== "";
            const isDifferentOrder = supply.supplyOrdNum !== demand?.demandOrdNum;
            if (hasSupplyOrder && isDifferentOrder) {
                rowsSince1 = getDemandRecursive(top, supply.supplyOrdNum, nesting + 1, nestedBOM, visitedDemandSeqs, rowsSince1);
            }
        }
        return rowsSince1;
    }
    function getDemandRecursive(top, supplyOrdNum, nesting, prevNestedBOM, visitedDemandSeqs, rowsSince1) {
        // Find all demands where demandOrdNum matches this supply order number
        for (const demand of demandBySeq.values()) {
            if (demand.demandOrdNum === supplyOrdNum && !visitedDemandSeqs.has(demand.demandSeq)) {
                visitedDemandSeqs.add(demand.demandSeq);
                rowsSince1 = addDemandRecursive(top, demand.demandSeq, nesting, prevNestedBOM, visitedDemandSeqs, rowsSince1);
            }
        }
        return rowsSince1;
    }
    // Only process demands from sales orders (demandType === 'S')
    for (const demand of demandBySeq.values()) {
        if (output.length >= 200000)
            break;
        // Skip non-sales-order demands (only process type 'S')
        if (demand.demandType !== "S") {
            continue;
        }
        const topOrderNum = demand.demandOrdNum;
        const topLine = demand.demandOrdLine;
        const topRel = demand.demandOrdRel;
        const topDate = demand.demandDate;
        const topPartNumber = demand.partNum;
        const visitedDemandSeqs = new Set();
        visitedDemandSeqs.add(demand.demandSeq);
        let rowsSince1 = 0;
        rowsSince1 = addDemandRecursive({ company: companyDisplayLabel(demand.company, demand.plant), topPNum: topPartNumber, topOrderNum, topLine, topRel, topQty: demand.demandQty, topDate }, demand.demandSeq, 1, topPartNumber, visitedDemandSeqs, rowsSince1);
    }
    return output;
}
async function writeFlattenedXlsxFromXmlSource(outputFile, tables, progress) {
    const workbook = XLSX.utils.book_new();
    reportProgress(progress, "Starting XML workbook export", 10);
    const rows = buildRowsFromXmlSource(tables, progress);
    reportProgress(progress, "Writing workbook file", 95, `${rows.length} rows`);
    const sheet = XLSX.utils.json_to_sheet(rows, { header: LAYOUT_COLUMNS });
    XLSX.utils.book_append_sheet(workbook, sheet, "tblPeggingPlus2");
    await promises_1.default.mkdir(node_path_1.default.dirname(outputFile), { recursive: true });
    XLSX.writeFile(workbook, outputFile);
    reportProgress(progress, "Workbook export complete", 100, `${rows.length} rows`);
    return { rowCount: rows.length, outputFile };
}
//# sourceMappingURL=writeFlattenedXlsx.js.map