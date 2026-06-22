"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.readPriorsartPackage = readPriorsartPackage;
const promises_1 = __importDefault(require("node:fs/promises"));
const jszip_1 = __importDefault(require("jszip"));
async function readJsonFile(zip, name) {
    const entry = zip.file(name);
    if (!entry) {
        throw new Error(`Missing '${name}' in .priorsart package`);
    }
    const text = await entry.async("string");
    return JSON.parse(text);
}
async function readPriorsartPackage(inputFile) {
    const bytes = await promises_1.default.readFile(inputFile);
    const zip = await jszip_1.default.loadAsync(bytes);
    const manifest = await readJsonFile(zip, "manifest.json");
    const quality = await readJsonFile(zip, "quality.json");
    const indexes = await readJsonFile(zip, "indexes.json");
    const datasets = {
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
        nest: Number.isInteger(link.nest) && link.nest >= 1 ? link.nest : 1,
        nestText: typeof link.nestText === "string" && link.nestText.length > 0
            ? link.nestText
            : ">".repeat(Number.isInteger(link.nest) && link.nest >= 1 ? link.nest : 1),
        parentLinkId: typeof link.parentLinkId === "string"
            ? (link.parentLinkId || null)
            : null,
        parentDemandId: typeof link.parentDemandId === "string"
            ? (link.parentDemandId || null)
            : null,
        parentSupplyId: typeof link.parentSupplyId === "string"
            ? (link.parentSupplyId || null)
            : null,
        path: Array.isArray(link.path) && link.path.every((entry) => typeof entry === "string")
            ? (link.path.length > 0 ? link.path : [link.id])
            : [link.id],
        duplicate: Boolean(link.duplicate),
        ...(typeof link.duplicateReason === "string" &&
            link.duplicateReason.trim().length > 0
            ? { duplicateReason: link.duplicateReason }
            : {}),
    }));
    manifest.qualitySummary = {
        ...manifest.qualitySummary,
        nestLevelCounts: manifest.qualitySummary &&
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
//# sourceMappingURL=readPriorsartPackage.js.map