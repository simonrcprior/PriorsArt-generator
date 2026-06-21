import fs from "node:fs/promises";
import path from "node:path";
import JSZip from "jszip";
import { CanonicalPackage } from "../model/types";

export async function writePriorsartPackage(outputFile: string, pkg: CanonicalPackage): Promise<void> {
  const zip = new JSZip();

  zip.file("manifest.json", JSON.stringify(pkg.manifest, null, 2));
  zip.file("quality.json", JSON.stringify(pkg.quality, null, 2));
  zip.file("indexes.json", JSON.stringify(pkg.indexes, null, 2));

  const datasetFolder = zip.folder("datasets");
  if (!datasetFolder) {
    throw new Error("Failed to create datasets folder in zip");
  }

  datasetFolder.file("salesOrders.json", JSON.stringify(pkg.datasets.salesOrders, null, 2));
  datasetFolder.file("assemblies.json", JSON.stringify(pkg.datasets.assemblies, null, 2));
  datasetFolder.file("demands.json", JSON.stringify(pkg.datasets.demands, null, 2));
  datasetFolder.file("supplies.json", JSON.stringify(pkg.datasets.supplies, null, 2));
  datasetFolder.file("operations.json", JSON.stringify(pkg.datasets.operations, null, 2));
  datasetFolder.file("peggingLinks.json", JSON.stringify(pkg.datasets.peggingLinks, null, 2));
  datasetFolder.file("partCatalog.json", JSON.stringify(pkg.datasets.partCatalog, null, 2));

  const buffer = await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });

  await fs.mkdir(path.dirname(outputFile), { recursive: true });
  await fs.writeFile(outputFile, buffer);
}
