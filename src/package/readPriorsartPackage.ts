import fs from "node:fs/promises";
import JSZip from "jszip";
import { CanonicalPackage } from "../model/types";

async function readJsonFile<T>(zip: JSZip, name: string): Promise<T> {
  const entry = zip.file(name);
  if (!entry) {
    throw new Error(`Missing '${name}' in .priorsart package`);
  }

  const text = await entry.async("string");
  return JSON.parse(text) as T;
}

export async function readPriorsartPackage(inputFile: string): Promise<CanonicalPackage> {
  const bytes = await fs.readFile(inputFile);
  const zip = await JSZip.loadAsync(bytes);

  const manifest = await readJsonFile<CanonicalPackage["manifest"]>(zip, "manifest.json");
  const quality = await readJsonFile<CanonicalPackage["quality"]>(zip, "quality.json");
  const indexes = await readJsonFile<CanonicalPackage["indexes"]>(zip, "indexes.json");

  const datasets: CanonicalPackage["datasets"] = {
    salesOrders: await readJsonFile(zip, "datasets/salesOrders.json"),
    assemblies: await readJsonFile(zip, "datasets/assemblies.json"),
    demands: await readJsonFile(zip, "datasets/demands.json"),
    supplies: await readJsonFile(zip, "datasets/supplies.json"),
    operations: await readJsonFile(zip, "datasets/operations.json"),
    peggingLinks: await readJsonFile(zip, "datasets/peggingLinks.json"),
    partCatalog: await readJsonFile(zip, "datasets/partCatalog.json"),
  };

  datasets.peggingLinks = datasets.peggingLinks.map((link) => ({
    ...link,
    nest: Number.isInteger((link as { nest?: number }).nest) && (link as { nest?: number }).nest! >= 1 ? (link as { nest: number }).nest : 1,
    nestText:
      typeof (link as { nestText?: string }).nestText === "string" && (link as { nestText?: string }).nestText!.length > 0
        ? (link as { nestText: string }).nestText
        : ">".repeat(Number.isInteger((link as { nest?: number }).nest) && (link as { nest?: number }).nest! >= 1 ? (link as { nest: number }).nest : 1),
    parentLinkId:
      typeof (link as { parentLinkId?: unknown }).parentLinkId === "string"
        ? ((link as { parentLinkId: string }).parentLinkId || null)
        : null,
    parentDemandId:
      typeof (link as { parentDemandId?: unknown }).parentDemandId === "string"
        ? ((link as { parentDemandId: string }).parentDemandId || null)
        : null,
    parentSupplyId:
      typeof (link as { parentSupplyId?: unknown }).parentSupplyId === "string"
        ? ((link as { parentSupplyId: string }).parentSupplyId || null)
        : null,
    path:
      Array.isArray((link as { path?: unknown }).path) && (link as { path: unknown[] }).path.every((entry) => typeof entry === "string")
        ? ((link as { path: string[] }).path.length > 0 ? (link as { path: string[] }).path : [link.id])
        : [link.id],
    duplicate: Boolean((link as { duplicate?: unknown }).duplicate),
    ...(typeof (link as { duplicateReason?: unknown }).duplicateReason === "string" &&
    (link as { duplicateReason: string }).duplicateReason.trim().length > 0
      ? { duplicateReason: (link as { duplicateReason: string }).duplicateReason }
      : {}),
  }));

  manifest.qualitySummary = {
    ...manifest.qualitySummary,
    nestLevelCounts:
      manifest.qualitySummary &&
      typeof manifest.qualitySummary === "object" &&
      manifest.qualitySummary.nestLevelCounts &&
      typeof manifest.qualitySummary.nestLevelCounts === "object"
        ? manifest.qualitySummary.nestLevelCounts
        : {},
  };

  quality.nestLevelCounts =
    quality &&
    typeof quality === "object" &&
    quality.nestLevelCounts &&
    typeof quality.nestLevelCounts === "object"
      ? quality.nestLevelCounts
      : {};

  return {
    manifest,
    datasets,
    indexes,
    quality,
  };
}
