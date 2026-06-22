"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.generateFromXlsx = generateFromXlsx;
exports.generateFromXml = generateFromXml;
const node_path_1 = __importDefault(require("node:path"));
const readXlsxCanonical_1 = require("../adapters/xlsx/readXlsxCanonical");
const readXmlCanonical_1 = require("../adapters/xml/readXmlCanonical");
const writeFlattenedXlsx_1 = require("../export/writeFlattenedXlsx");
const collector_1 = require("../diagnostics/collector");
const validation_1 = require("../model/validation");
const writePriorsartPackage_1 = require("../package/writePriorsartPackage");
function buildIndexes(datasets) {
    return {
        salesOrdersById: datasets.salesOrders.map((r) => r.id),
        assembliesById: datasets.assemblies.map((r) => r.id),
        demandsById: datasets.demands.map((r) => r.id),
        suppliesById: datasets.supplies.map((r) => r.id),
        operationsById: datasets.operations.map((r) => r.id),
        peggingLinksById: datasets.peggingLinks.map((r) => r.id),
        partNumbers: datasets.partCatalog.map((r) => r.partNumber),
    };
}
function countDatasets(datasets) {
    return {
        salesOrders: datasets.salesOrders.length,
        assemblies: datasets.assemblies.length,
        demands: datasets.demands.length,
        supplies: datasets.supplies.length,
        operations: datasets.operations.length,
        peggingLinks: datasets.peggingLinks.length,
        partCatalog: datasets.partCatalog.length,
    };
}
async function finalizePackage(datasets, source, options, diagnostics, flattenedPegging) {
    (0, validation_1.validateCanonical)(datasets, diagnostics);
    const quality = diagnostics.toQualityReport();
    const manifest = {
        packageVersion: "1.0.0",
        schemaVersion: "3",
        generatedAt: new Date().toISOString(),
        source,
        datePolicy: options.datePolicy,
        counts: countDatasets(datasets),
        qualitySummary: {
            warnings: quality.warnings.length,
            errors: quality.errors.length,
            droppedRows: quality.droppedRows,
            ambiguousDateCount: quality.ambiguousDateCount,
            invalidDateCount: quality.invalidDateCount,
            nestLevelCounts: quality.nestLevelCounts,
        },
    };
    const pkg = {
        manifest,
        datasets,
        indexes: buildIndexes(datasets),
        quality,
    };
    await (0, writePriorsartPackage_1.writePriorsartPackage)(options.outputFile, pkg, flattenedPegging);
    return pkg;
}
async function generateFromXlsx(options) {
    const diagnostics = new collector_1.DiagnosticCollector();
    const { datasets, worksheetNames } = (0, readXlsxCanonical_1.readXlsxCanonical)(options.inputFile, options.datePolicy, diagnostics);
    return finalizePackage(datasets, {
        type: "xlsx",
        inputFile: node_path_1.default.basename(options.inputFile),
        worksheetNames,
    }, options, diagnostics);
}
async function generateFromXml(options) {
    const diagnostics = new collector_1.DiagnosticCollector();
    const { datasets, fileNames, sourceTables } = await (0, readXmlCanonical_1.readXmlCanonical)(options.inputFile, options.datePolicy, diagnostics, options.xmlConfigFile);
    // Compute flattened pegging view for viewer optimization
    const flattenedPegging = (0, writeFlattenedXlsx_1.buildRowsFromXmlSource)(sourceTables);
    return finalizePackage(datasets, {
        type: "xml",
        inputPath: options.inputFile,
        fileNames,
        ...(options.xmlConfigFile ? { configFile: options.xmlConfigFile } : {}),
    }, options, diagnostics, flattenedPegging);
}
//# sourceMappingURL=generate.js.map