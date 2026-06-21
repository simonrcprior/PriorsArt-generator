# priorsart-generator

Generator pipeline for producing .priorsart packages from source data.

Current inputs:
- XLSX
- XML (Epicor 6-file export set)

Planned next inputs:
- XML
- ODATA

Planned output:
- .priorsart package for consumption by the viewer app

## Milestone: XLSX -> .priorsart

This milestone provides an end-to-end generator path:
- Read XLSX workbook sheets
- Normalize into canonical datasets
- Validate required fields, enums, numbers, dates, duplicate IDs, and key FK relationships
- Emit diagnostics (warnings/errors/dropped rows/date counters)
- Write a ZIP-based `.priorsart` package

### Install

```bash
npm install
```

### Build

```bash
npm run build
```

### Run the local web UI

Start the browser-based generator at `http://localhost:4173`:

```bash
npm run web
```

or

```bash
npm run dev
```

In the UI, you can drag and drop XML files, pick a folder, generate the workbook, track progress, and download the result.

If `npm run web` fails with `tsx` not recognized, run `npm install` first to restore the local dependencies.

### Generate

```bash
npm run generate -- --from xlsx --input ./input.xlsx --output ./output.priorsart --defaultDateOrder MDY
```

```bash
npm run generate -- --from xml --input . --output ./output-from-xml.priorsart --defaultDateOrder YMD
```

```bash
npm run generate -- --from xml --input . --xmlConfig ./xml-input.manifest.json --output ./output-from-xml.priorsart --defaultDateOrder YMD
```

### Export Single XLSX

Generate one flattened workbook directly from XML input files:

```bash
npm run generate -- --from xml --input . --xmlConfig ./xml-input.manifest.json --output ./temp.priorsart --defaultDateOrder YMD
npm run export-xlsx -- --from xml --input . --xmlConfig ./xml-input.manifest.json --output ./processedData1.generated.xlsx --defaultDateOrder YMD
```

You can also export from an existing `.priorsart` package:

```bash
npm run export-xlsx -- --from priorsart --input ./xml-config.priorsart --output ./processedData1.generated.xlsx
```

Quick run for the current 6-file XML set:

```bash
npm run export-xlsx -- --from xml --input . --xmlConfig ./xml-input.manifest.json --output ./processedData1.generated.xlsx --defaultDateOrder YMD
```

Arguments:
- `--from`: `xlsx` or `xml`
- `--input`:
	- xlsx: path to workbook
	- xml: folder path containing the expected XML files (or any XML path inside that folder)
- `--output`: must end with `.priorsart`
- `--defaultDateOrder`: `MDY`, `DMY`, or `YMD`
- `--xmlConfig`: optional JSON manifest for explicit XML file mapping (xml only)

### XML file set (initial adapter)

The XML adapter expects these files in one folder:
- `PEGDMDMST.xml`
- `PEGJOBINFOSP2.xml`
- `PEGLINK.xml`
- `PEGPODETAIL.xml`
- `PEGSALESORDER3.xml`
- `PEGSUPMST.xml`
- `Time Phase Material Requirement_447293.xml` (part descriptions)

If any are missing, generation still runs and logs warnings in `quality.json` and manifest quality summary.

### XML config manifest (explicit mode)

Use `--xmlConfig` to explicitly map each logical XML source to a filename/path.

Example:

```json
{
	"basePath": ".",
	"files": {
		"demands": "PEGDMDMST.xml",
		"jobs": "PEGJOBINFOSP2.xml",
		"links": "PEGLINK.xml",
		"poDetails": "PEGPODETAIL.xml",
		"salesOrders": "PEGSALESORDER3.xml",
		"supplies": "PEGSUPMST.xml",
		"partDescriptions": "Time Phase Material Requirement_447293.xml"
	}
}
```

Notes:
- `basePath` is resolved relative to the manifest file location.
- Each `files.*` value can be relative to `basePath` or absolute.
- Any omitted key falls back to the default filename.

### Date policy

- Internal canonical date format is `YYYY-MM-DD`.
- Excel serial dates are preferred when present.
- String dates are parsed by `defaultDateOrder`.
- Ambiguous slash dates (example `03/04/2026`) are not silently ignored:
	- they are parsed using the explicit policy
	- they are counted and logged in diagnostics

### Expected sheet names and columns

Each worksheet name maps to one canonical dataset.

- `salesOrders`: `id`, `orderNumber`, `partNumber`, `quantity`, `dueDate`
- `assemblies`: `id`, `partNumber`, `orderId`, `quantity`
- `demands`: `id`, `partNumber`, `quantity`, `dueDate`, `sourceType`, `sourceId`
- `supplies`: `id`, `partNumber`, `quantity`, `availableDate`, `supplyType`, `sourceId`
- `operations`: `id`, `assemblyId`, `operationCode`, `workCenter`, `hours`
- `peggingLinks`: `id`, `demandId`, `supplyId`, `quantity`
- `partCatalog`: `partNumber`, `description`, `uom`

### Package structure

Generated `.priorsart` files are ZIP archives containing:
- `manifest.json`
- `quality.json`
- `indexes.json`
- `datasets/salesOrders.json`
- `datasets/assemblies.json`
- `datasets/demands.json`
- `datasets/supplies.json`
- `datasets/operations.json`
- `datasets/peggingLinks.json`
- `datasets/partCatalog.json`

### Tests

```bash
npm test
```