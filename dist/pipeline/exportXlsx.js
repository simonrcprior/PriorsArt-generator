"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.exportFlattenedXlsx = exportFlattenedXlsx;
const node_path_1 = __importDefault(require("node:path"));
const readXmlCanonical_1 = require("../adapters/xml/readXmlCanonical");
const collector_1 = require("../diagnostics/collector");
const validation_1 = require("../model/validation");
const readPriorsartPackage_1 = require("../package/readPriorsartPackage");
const writeFlattenedXlsx_1 = require("../export/writeFlattenedXlsx");
async function exportFlattenedXlsx(options) {
    if (node_path_1.default.extname(options.outputFile).toLowerCase() !== ".xlsx") {
        throw new Error("Output file must use the .xlsx extension");
    }
    if (options.from === "xml") {
        const diagnostics = new collector_1.DiagnosticCollector();
        options.onProgress?.({ stage: "Reading XML source tables", progress: 35 });
        const tables = await (0, readXmlCanonical_1.readXmlSourceTables)(options.inputFile, diagnostics, options.xmlConfigFile);
        options.onProgress?.({ stage: "Reading XML canonical data", progress: 45 });
        const { datasets, fileNames } = await (0, readXmlCanonical_1.readXmlCanonical)(options.inputFile, options.datePolicy, diagnostics, options.xmlConfigFile);
        options.onProgress?.({ stage: "Validating canonical data", progress: 55 });
        (0, validation_1.validateCanonical)(datasets, diagnostics);
        options.onProgress?.({ stage: "Writing XLSX workbook", progress: 70 });
        const result = await (0, writeFlattenedXlsx_1.writeFlattenedXlsxFromXmlSource)(options.outputFile, tables, options.onProgress);
        const quality = diagnostics.toQualityReport();
        return {
            outputFile: result.outputFile,
            rowCount: result.rowCount,
            qualitySummary: {
                warnings: quality.warnings.length,
                errors: quality.errors.length,
                droppedRows: quality.droppedRows,
                ambiguousDateCount: quality.ambiguousDateCount,
                invalidDateCount: quality.invalidDateCount,
                nestLevelCounts: quality.nestLevelCounts,
            },
            sourceSummary: `xml:${fileNames.join(",")}`,
        };
    }
    const pkg = await (0, readPriorsartPackage_1.readPriorsartPackage)(options.inputFile);
    options.onProgress?.({ stage: "Writing workbook", progress: 70 });
    const rowCount = await (0, writeFlattenedXlsx_1.writeFlattenedXlsx)(options.outputFile, pkg.datasets, options.onProgress);
    return {
        outputFile: options.outputFile,
        rowCount,
        qualitySummary: pkg.manifest.qualitySummary,
        sourceSummary: "priorsart",
    };
}
//# sourceMappingURL=exportXlsx.js.map