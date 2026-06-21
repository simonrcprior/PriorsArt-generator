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

  return {
    manifest,
    datasets,
    indexes,
    quality,
  };
}
