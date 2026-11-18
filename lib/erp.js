const path = require("path");
const catalog = require("./catalog");

const db = catalog.createCatalog({
  dbFile: process.env.ERP_DB || path.join(__dirname, "..", "data", "erp_items.sqlite"),
  itemsTable: "erp_items",
  metaTable: "erp_meta",
  missingMessage: "ERP item file was not deployed.",
  openMessage: "Could not open the ERP items.",
  extraColumns: ["group_name"],
  writable: true,
});

module.exports = {
  ...db,
  summaryOf: catalog.summaryOf,
  customFieldsOf: catalog.customFieldsOf,
  locationsOf: catalog.locationsOf,
  extraFields: catalog.extraFields,
  formatValue: catalog.formatValue,
};
