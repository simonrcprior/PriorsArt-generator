import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import * as XLSX from "xlsx";
import { describe, expect, test } from "vitest";
import { readXmlSourceTables } from "../src/adapters/xml/readXmlCanonical";
import { exportFlattenedXlsx } from "../src/pipeline/exportXlsx";

function xmlRows(rows: Array<Record<string, string | number>>): string {
  const nodes = rows
    .map((row) => {
      const fields = Object.entries(row)
        .map(([key, value]) => `<${key}>${String(value)}</${key}>`)
        .join("");
      return `<Results>${fields}</Results>`;
    })
    .join("");

  return `<?xml version="1.0" encoding="utf-8"?><root>${nodes}</root>`;
}

async function writeMinimalXmlFixture(dir: string): Promise<void> {
  const files: Array<{ name: string; content: string }> = [
    {
      name: "PEGDMDMST.xml",
      content: xmlRows([
        {
          PegDmdMst_DemandSeq: "100",
          PegDmdMst_PartNum: "PARENT-100",
          PegDmdMst_DemandQty: 5,
          PegDmdMst_DemandDate: "2026-01-20",
          PegDmdMst_DemandOrdNum: "SO100",
          PegDmdMst_DemandOrdLine: "1",
          PegDmdMst_DemandOrdRel: "1",
          PegDmdMst_DemandType: "S",
          PegDmdMst_Company: "EPIC06",
          PegDmdMst_Plant: "MFGSYS",
        },
      ]),
    },
    {
      name: "PEGLINK.xml",
      content: xmlRows([
        {
          PegLink_PegNum: "1",
          PegLink_DemandSeq: "100",
          PegLink_SupplySeq: "200",
          PegLink_PartNum: "COMP-200",
          PegLink_PeggedQty: 5,
          PegLink_Company: "EPIC06",
          PegLink_Plant: "MFGSYS",
        },
      ]),
    },
    {
      name: "PEGSUPMST.xml",
      content: xmlRows([
        {
          PegSupMst_SupplySeq: "200",
          PegSupMst_PartNum: "COMP-200",
          PegSupMst_SupplyQty: 5,
          PegSupMst_SupplyDate: "2026-01-18",
          PegSupMst_SupplyType: "P",
          PegSupMst_SupplyOrdNum: "PO500",
          PegSupMst_SupplyOrdLine: "1",
          PegSupMst_SupplyOrdRel: "1",
          PegSupMst_Company: "EPIC06",
          PegSupMst_Plant: "MFGSYS",
          Calculated_ReportDate: "2026-01-15",
          Calculated_UnusedField: "should-not-load",
        },
      ]),
    },
    {
      name: "PEGPODETAIL.xml",
      content: xmlRows([
        {
          PORel_Company: "EPIC06",
          PORel_Plant: "MFGSYS",
          PORel_PONum: "PO500",
          PORel_POLine: "1",
          PORel_PORelNum: "1",
          PORel_PromiseDt: "2026-01-19",
          PODetail_PartNum: "COMP-200",
          PODetail_LineDesc: "Component 200",
          Vendor_Name: "Vendor A",
          Calculated_openqty: 5,
        },
      ]),
    },
    {
      name: "PEGJOBINFOSP2.xml",
      content: xmlRows([]),
    },
    {
      name: "PEGSALESORDER3.xml",
      content: xmlRows([]),
    },
    {
      name: "Time Phase Material Requirement_447293.xml",
      content:
        "<?xml version=\"1.0\" encoding=\"utf-8\"?><root txtPartNum=\"COMP-200\" txtPartDescription=\"Component 200\" txtCalc_DspLeadTime=\"3\" />",
    },
  ];

  await Promise.all(files.map((file) => fs.writeFile(path.join(dir, file.name), file.content, "utf8")));
}

function readFirstSheetRows(workbookPath: string): Array<Record<string, unknown>> {
  const workbook = XLSX.readFile(workbookPath, { cellDates: false });
  const firstSheetName = workbook.SheetNames[0];
  if (!firstSheetName) {
    return [];
  }

  const sheet = workbook.Sheets[firstSheetName];
  if (!sheet) {
    return [];
  }

  return XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: null, raw: true });
}

describe("exportFlattenedXlsx XML canonical enrichment", () => {
  test("matches the Access-style workbook shape and removes vendor text from myText3", async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "priorsart-export-canonical-"));
    await writeMinimalXmlFixture(tempDir);

    const output = path.join(tempDir, "shared.xlsx");
    await exportFlattenedXlsx({
      from: "xml",
      inputFile: tempDir,
      outputFile: output,
      datePolicy: { defaultDateOrder: "YMD" },
    });

    const rows = readFirstSheetRows(output);
    expect(rows.length).toBeGreaterThan(0);

    expect(rows.some((row) => String(row.myText3 ?? "").includes("Vendor A"))).toBe(false);
    expect(Object.keys(rows[0] ?? {})).not.toContain("PORel_PromiseDt");
    expect(Object.keys(rows[0] ?? {})).not.toContain("earliestN");
    expect(Object.keys(rows[0] ?? {})).not.toContain("OrderBy");
  });

  test("drops XML fields that are not required or used by the loader", async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "priorsart-xml-project-"));
    await writeMinimalXmlFixture(tempDir);

    const tables = await readXmlSourceTables(tempDir, {
      warn: () => undefined,
      error: () => undefined,
      incrementDroppedRows: () => undefined,
    } as never);

    const supplyRow = tables.rowsByFile.supplies[0] ?? {};
    expect(supplyRow.PegSupMst_PartNum).toBe("COMP-200");
    expect(Object.keys(supplyRow)).not.toContain("PegSupMst_UnusedField");
    expect(Object.keys(supplyRow)).not.toContain("Calculated_UnusedField");
  });
});
