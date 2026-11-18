const path = require("path");
const catalog = require("./catalog");

const db = catalog.createCatalog({
  dbFile: process.env.BOOKS_DB || path.join(__dirname, "..", "data", "books_items.sqlite"),
  itemsTable: "books_items",
  metaTable: "books_meta",
  missingMessage: "Books backup file was not deployed.",
  openMessage: "Could not open the Books backup.",
});

module.exports = {
  ...db,
  summaryOf: catalog.summaryOf,
  customFieldsOf: catalog.customFieldsOf,
  locationsOf: catalog.locationsOf,
  extraFields: catalog.extraFields,
  formatValue: catalog.formatValue,
};
