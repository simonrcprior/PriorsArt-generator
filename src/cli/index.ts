#!/usr/bin/env node

import { Command } from "commander";
import path from "node:path";
import { generateFromXlsx, generateFromXml } from "../pipeline/generate";
import { exportFlattenedXlsx } from "../pipeline/exportXlsx";
import { DateOrder } from "../model/types";

const program = new Command();

program
  .name("priorsart-generator")
  .description("Generate .priorsart packages from source data")
  .version("0.1.0");

program
  .command("generate")
  .requiredOption("--from <source>", "Input source adapter (xlsx, xml)")
  .requiredOption("--input <path>", "Input source file (xlsx) or folder/file path (xml)")
  .requiredOption("--output <file>", "Output .priorsart file")
  .option("--defaultDateOrder <order>", "Date order policy (MDY, DMY, YMD)", "MDY")
  .option("--xmlConfig <file>", "XML source manifest JSON path (for --from xml)")
  .action(async (opts) => {
    const from = String(opts.from).toLowerCase();
    if (!["xlsx", "xml"].includes(from)) {
      throw new Error(`Unsupported --from '${opts.from}'. Valid values are 'xlsx' and 'xml'.`);
    }

    const defaultDateOrder = String(opts.defaultDateOrder).toUpperCase() as DateOrder;
    if (!["MDY", "DMY", "YMD"].includes(defaultDateOrder)) {
      throw new Error("--defaultDateOrder must be one of: MDY, DMY, YMD");
    }

    const outputFile = String(opts.output);
    if (path.extname(outputFile).toLowerCase() !== ".priorsart") {
      throw new Error("Output file must use the .priorsart extension");
    }

    const generateOptions = {
      inputFile: String(opts.input),
      outputFile,
      datePolicy: { defaultDateOrder },
      ...(opts.xmlConfig ? { xmlConfigFile: String(opts.xmlConfig) } : {}),
    };

    if (from !== "xml" && generateOptions.xmlConfigFile) {
      throw new Error("--xmlConfig can only be used with --from xml");
    }

    const pkg = from === "xml" ? await generateFromXml(generateOptions) : await generateFromXlsx(generateOptions);

    console.log(`Generated ${outputFile}`);
    console.log(`Counts: ${JSON.stringify(pkg.manifest.counts)}`);
    console.log(
      `Quality: warnings=${pkg.manifest.qualitySummary.warnings}, errors=${pkg.manifest.qualitySummary.errors}, droppedRows=${pkg.manifest.qualitySummary.droppedRows}, ambiguousDates=${pkg.manifest.qualitySummary.ambiguousDateCount}, invalidDates=${pkg.manifest.qualitySummary.invalidDateCount}`
    );

    if (pkg.manifest.qualitySummary.errors > 0) {
      process.exitCode = 2;
    }
  });

program
  .command("export-xlsx")
  .requiredOption("--from <source>", "Input source adapter (xml, priorsart)")
  .requiredOption("--input <path>", "Input source folder/file")
  .requiredOption("--output <file>", "Output .xlsx file")
  .option("--defaultDateOrder <order>", "Date order policy (MDY, DMY, YMD)", "YMD")
  .option("--xmlConfig <file>", "XML source manifest JSON path (for --from xml)")
  .action(async (opts) => {
    const from = String(opts.from).toLowerCase();
    if (!["xml", "priorsart"].includes(from)) {
      throw new Error(`Unsupported --from '${opts.from}'. Valid values are 'xml' and 'priorsart'.`);
    }

    const defaultDateOrder = String(opts.defaultDateOrder).toUpperCase() as DateOrder;
    if (!["MDY", "DMY", "YMD"].includes(defaultDateOrder)) {
      throw new Error("--defaultDateOrder must be one of: MDY, DMY, YMD");
    }

    const outputFile = String(opts.output);
    if (path.extname(outputFile).toLowerCase() !== ".xlsx") {
      throw new Error("Output file must use the .xlsx extension");
    }

    const xmlConfigFile = opts.xmlConfig ? String(opts.xmlConfig) : undefined;
    if (from !== "xml" && xmlConfigFile) {
      throw new Error("--xmlConfig can only be used with --from xml");
    }

    const result = await exportFlattenedXlsx({
      from: from as "xml" | "priorsart",
      inputFile: String(opts.input),
      outputFile,
      datePolicy: { defaultDateOrder },
      ...(xmlConfigFile ? { xmlConfigFile } : {}),
    });

    console.log(`Exported ${result.outputFile}`);
    console.log(`Rows: ${result.rowCount}`);
    console.log(
      `Quality: warnings=${result.qualitySummary.warnings}, errors=${result.qualitySummary.errors}, droppedRows=${result.qualitySummary.droppedRows}, ambiguousDates=${result.qualitySummary.ambiguousDateCount}, invalidDates=${result.qualitySummary.invalidDateCount}`
    );
    console.log(`Source: ${result.sourceSummary}`);

    if (result.qualitySummary.errors > 0) {
      process.exitCode = 2;
    }
  });

program.parseAsync(process.argv).catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`Generation failed: ${message}`);
  process.exit(1);
});
