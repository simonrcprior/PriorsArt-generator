import XLSX from "xlsx";

const workbook = XLSX.utils.book_new();

XLSX.utils.book_append_sheet(
  workbook,
  XLSX.utils.json_to_sheet([
    { id: "SO-100", orderNumber: "100", partNumber: "PA-100", quantity: 25, dueDate: "03/04/2026" },
  ]),
  "salesOrders"
);

XLSX.utils.book_append_sheet(
  workbook,
  XLSX.utils.json_to_sheet([{ id: "ASM-100", partNumber: "PA-100", orderId: "SO-100", quantity: 25 }]),
  "assemblies"
);

XLSX.utils.book_append_sheet(
  workbook,
  XLSX.utils.json_to_sheet([
    {
      id: "DEM-100",
      partNumber: "PA-100",
      quantity: 25,
      dueDate: "03/04/2026",
      sourceType: "SO",
      sourceId: "SO-100",
    },
  ]),
  "demands"
);

XLSX.utils.book_append_sheet(
  workbook,
  XLSX.utils.json_to_sheet([
    {
      id: "SUP-100",
      partNumber: "PA-100",
      quantity: 25,
      availableDate: 46084,
      supplyType: "PO",
      sourceId: "PO-100",
    },
  ]),
  "supplies"
);

XLSX.utils.book_append_sheet(
  workbook,
  XLSX.utils.json_to_sheet([
    { id: "OP-100", assemblyId: "ASM-100", operationCode: "CUT", workCenter: "WC-01", hours: 1.5 },
  ]),
  "operations"
);

XLSX.utils.book_append_sheet(
  workbook,
  XLSX.utils.json_to_sheet([{ id: "PEG-100", demandId: "DEM-100", supplyId: "SUP-100", quantity: 25 }]),
  "peggingLinks"
);

XLSX.utils.book_append_sheet(
  workbook,
  XLSX.utils.json_to_sheet([{ partNumber: "PA-100", description: "Sample Part", uom: "EA" }]),
  "partCatalog"
);

XLSX.writeFile(workbook, "test/fixtures/sample-input.xlsx");
console.log("Created test/fixtures/sample-input.xlsx");
