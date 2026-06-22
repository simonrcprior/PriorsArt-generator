import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import JSZip from "jszip";
import * as XLSX from "xlsx";
import { describe, expect, test } from "vitest";
import { generateFromXlsx } from "../src/pipeline/generate";

async function buildSampleWorkbook(filePath: string): Promise<void> {
  const wb = XLSX.utils.book_new();

  XLSX.utils.book_append_sheet(
    wb,
    XLSX.utils.json_to_sheet([
      { id: "SO-1", orderNumber: "1001", partNumber: "P-100", quantity: 10, dueDate: "03/04/2026" },
    ]),
    "salesOrders"
  );

  XLSX.utils.book_append_sheet(
    wb,
    XLSX.utils.json_to_sheet([{ id: "ASM-1", partNumber: "P-100", orderId: "SO-1", quantity: 10 }]),
    "assemblies"
  );

  XLSX.utils.book_append_sheet(
    wb,
    XLSX.utils.json_to_sheet([
      {
        id: "DEM-1",
        partNumber: "P-100",
        quantity: 10,
        dueDate: "03/04/2026",
        sourceType: "SO",
        sourceId: "SO-1",
      },
    ]),
    "demands"
  );

  XLSX.utils.book_append_sheet(
    wb,
    XLSX.utils.json_to_sheet([
      {
        id: "SUP-1",
        partNumber: "P-100",
        quantity: 10,
        availableDate: "03/03/2026",
        supplyType: "PO",
        sourceId: "PO-999",
      },
    ]),
    "supplies"
  );

  XLSX.utils.book_append_sheet(
    wb,
    XLSX.utils.json_to_sheet([
      { id: "OP-1", assemblyId: "ASM-1", operationCode: "CUT", workCenter: "WC-10", hours: 2.5 },
    ]),
    "operations"
  );

  XLSX.utils.book_append_sheet(
    wb,
    XLSX.utils.json_to_sheet([{ id: "PEG-1", demandId: "DEM-1", supplyId: "SUP-1", quantity: 10 }]),
    "peggingLinks"
  );

  XLSX.utils.book_append_sheet(
    wb,
    XLSX.utils.json_to_sheet([{ partNumber: "P-100", description: "Sample Part", uom: "EA" }]),
    "partCatalog"
  );

  XLSX.writeFile(wb, filePath);
}

describe("generateFromXlsx", () => {
  test("creates a .priorsart zip with manifest and datasets", async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "priorsart-generator-"));
    const inputPath = path.join(tempDir, "input.xlsx");
    const outputPath = path.join(tempDir, "output.priorsart");

    await buildSampleWorkbook(inputPath);

    const pkg = await generateFromXlsx({
      inputFile: inputPath,
      outputFile: outputPath,
      datePolicy: { defaultDateOrder: "MDY" },
    });

    expect(pkg.manifest.counts.salesOrders).toBe(1);
    expect(pkg.manifest.qualitySummary.ambiguousDateCount).toBe(2);
    expect(pkg.manifest.schemaVersion).toBe("3");
    expect(pkg.manifest.qualitySummary.nestLevelCounts["1"]).toBe(1);
    expect(pkg.datasets.peggingLinks[0]?.nest).toBe(1);
    expect(pkg.datasets.peggingLinks[0]?.path).toEqual(["PEG-1"]);
    expect(pkg.datasets.peggingLinks[0]?.duplicate).toBe(false);

    const zipBytes = await fs.readFile(outputPath);
    const zip = await JSZip.loadAsync(zipBytes);

    const manifestJson = await zip.file("manifest.json")?.async("string");
    const qualityJson = await zip.file("quality.json")?.async("string");

    expect(manifestJson).toBeTruthy();
    expect(qualityJson).toBeTruthy();

    const manifest = JSON.parse(manifestJson ?? "{}");
    const quality = JSON.parse(qualityJson ?? "{}");

    expect(manifest.datePolicy.defaultDateOrder).toBe("MDY");
    expect(manifest.schemaVersion).toBe("3");
    expect(quality.ambiguousDateCount).toBe(2);
    expect(quality.nestLevelCounts["1"]).toBe(1);
    expect(Array.isArray(quality.warnings)).toBe(true);
  });
});
