const path = require("path");
const catalog = require("./catalog");

const db = catalog.createCatalog({
  dbFile: process.env.TALLY_DB || path.join(__dirname, "..", "data", "tally_items.sqlite"),
  itemsTable: "tally_items",
  metaTable: "tally_meta",
  missingMessage: "Tally item file was not deployed.",
  openMessage: "Could not open the Tally items.",
  extraColumns: ["group_name"],
});

module.exports = {
  ...db,
  summaryOf: catalog.summaryOf,
  customFieldsOf: catalog.customFieldsOf,
  locationsOf: catalog.locationsOf,
  extraFields: catalog.extraFields,
  formatValue: catalog.formatValue,
};
