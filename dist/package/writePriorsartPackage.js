"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.writePriorsartPackage = writePriorsartPackage;
const promises_1 = __importDefault(require("node:fs/promises"));
const node_path_1 = __importDefault(require("node:path"));
const jszip_1 = __importDefault(require("jszip"));
async function writePriorsartPackage(outputFile, pkg, flattenedPegging) {
    const zip = new jszip_1.default();
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
    if (flattenedPegging && flattenedPegging.length > 0) {
        datasetFolder.file("flattenedPegging.json", JSON.stringify(flattenedPegging, null, 2));
    }
    const buffer = await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
    await promises_1.default.mkdir(node_path_1.default.dirname(outputFile), { recursive: true });
    await promises_1.default.writeFile(outputFile, buffer);
}
//# sourceMappingURL=writePriorsartPackage.js.map