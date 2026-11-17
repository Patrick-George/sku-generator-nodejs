const fs = require("fs");
const path = require("path");
const initSqlJs = require("sql.js");

const DB_FILE = process.env.BOOKS_DB || path.join(__dirname, "..", "data", "books_items.sqlite");
const PAGE_SIZE = 40;

const SUMMARY_FIELDS = [
  ["sku", "SKU"],
  ["part_number", "Part #"],
  ["status", "Status"],
  ["unit", "Unit"],
  ["rate", "Selling price"],
  ["purchase_rate", "Purchase price"],
  ["stock_on_hand", "Stock on hand"],
  ["hsn_or_sac", "HSN / SAC"],
  ["tax_name", "Tax"],
  ["tax_percentage", "Tax %"],
  ["product_type", "Product type"],
  ["item_type", "Item type"],
  ["account_name", "Sales account"],
  ["purchase_account_name", "Purchase account"],
  ["inventory_account_name", "Inventory account"],
  ["vendor_name", "Preferred vendor"],
  ["brand", "Brand"],
  ["manufacturer", "Manufacturer"],
  ["item_code", "Item code"],
  ["track_inventory", "Track inventory"],
  ["can_be_sold", "Can be sold"],
  ["can_be_purchased", "Can be purchased"],
  ["created_time", "Created"],
  ["last_modified_time", "Last modified"],
];

const MONEY_KEYS = new Set(["rate", "purchase_rate", "pricebook_rate", "initial_stock_rate", "sales_margin"]);
const EXTRA_SKIP = new Set([
  "actual_available_stock", "available_stock", "available_for_sale_stock", "committed_stock",
  "actual_available_for_sale_stock", "actual_committed_stock", "has_attachment",
  "is_linked_with_zohocrm", "show_in_storefront", "source", "is_combo_product", "is_modifier_item",
  "is_tax_calculation_on_label_price", "pricing_scheme", "taxability_type", "is_taxable",
  "sales_rate", "pricebook_rate", "sales_margin",
]);
const SKIP_KEYS = new Set([
  "item_id", "name", "item_name", "sku", "part_number", "status", "unit", "rate", "purchase_rate",
  "stock_on_hand", "description", "purchase_description", "hsn_or_sac", "tax_name", "tax_percentage",
  "product_type", "item_type", "account_name", "purchase_account_name", "inventory_account_name",
  "vendor_name", "brand", "manufacturer", "item_code", "track_inventory", "can_be_sold",
  "can_be_purchased", "created_time", "last_modified_time", "locations", "custom_fields",
  "package_details", "search_text", "raw_json",
  ...EXTRA_SKIP,
]);

let db = null;
let openError = null;
let loading = null;

function fileInfo() {
  try {
    if (!fs.existsSync(DB_FILE)) return `missing ${DB_FILE}`;
    return `${DB_FILE} (${fs.statSync(DB_FILE).size} bytes)`;
  } catch (err) {
    return `${DB_FILE} (${err.message})`;
  }
}

function prepare() {
  if (!loading) loading = load();
  return loading;
}

async function load() {
  if (!fs.existsSync(DB_FILE)) {
    openError = `Books backup file was not deployed. ${fileInfo()}`;
    return;
  }
  try {
    const wasmPath = path.join(path.dirname(require.resolve("sql.js")), "sql-wasm.wasm");
    const SQL = await initSqlJs({ locateFile: () => wasmPath });
    db = new SQL.Database(fs.readFileSync(DB_FILE));
    openError = null;
  } catch (err) {
    db = null;
    openError = `Could not open the Books backup. ${err.message}. ${fileInfo()}`;
  }
}

function open() {
  return db;
}

function queryAll(sql, params = []) {
  const stmt = db.prepare(sql);
  if (params.length) stmt.bind(params);
  const rows = [];
  while (stmt.step()) rows.push(stmt.getAsObject());
  stmt.free();
  return rows;
}

function queryGet(sql, params = []) {
  return queryAll(sql, params)[0];
}

function meta() {
  const database = open();
  if (!database) return null;
  const rows = queryAll("SELECT key, value FROM books_meta");
  return Object.fromEntries(rows.map((row) => [row.key, row.value]));
}

function likePattern(query, mode) {
  const escaped = String(query || "").toLowerCase().replace(/[\\%_]/g, (ch) => `\\${ch}`);
  if (!escaped) return "%";
  if (mode === "prefix") return `${escaped}%`;
  if (mode === "word") return `% ${escaped}%`;
  return `%${escaped}%`;
}

function whereClause(query, status) {
  const clauses = [];
  const params = [];
  const q = String(query || "").trim();
  if (q) {
    const contains = likePattern(q, "contains");
    clauses.push(`(
      lower(name) LIKE ? ESCAPE '\\'
      OR lower(sku) LIKE ? ESCAPE '\\'
      OR lower(part_number) LIKE ? ESCAPE '\\'
      OR lower(description) LIKE ? ESCAPE '\\'
      OR lower(purchase_description) LIKE ? ESCAPE '\\'
      OR lower(hsn_or_sac) LIKE ? ESCAPE '\\'
      OR lower(vendor_name) LIKE ? ESCAPE '\\'
      OR lower(item_code) LIKE ? ESCAPE '\\'
      OR lower(brand) LIKE ? ESCAPE '\\'
      OR lower(manufacturer) LIKE ? ESCAPE '\\'
    )`);
    params.push(contains, contains, contains, contains, contains, contains, contains, contains, contains, contains);
  }
  if (status === "active" || status === "inactive") {
    clauses.push("status = ?");
    params.push(status);
  }
  return { sql: clauses.length ? `WHERE ${clauses.join(" AND ")}` : "", params, q };
}

function orderSql(q) {
  if (!q) return "name COLLATE NOCASE, item_id";
  return `CASE
    WHEN lower(name) LIKE ? ESCAPE '\\' THEN 0
    WHEN lower(sku) LIKE ? ESCAPE '\\' THEN 1
    WHEN lower(part_number) LIKE ? ESCAPE '\\' THEN 2
    WHEN lower(name) LIKE ? ESCAPE '\\' THEN 3
    WHEN lower(name) LIKE ? ESCAPE '\\' OR lower(sku) LIKE ? ESCAPE '\\' OR lower(part_number) LIKE ? ESCAPE '\\' OR lower(item_code) LIKE ? ESCAPE '\\' OR lower(hsn_or_sac) LIKE ? ESCAPE '\\' THEN 4
    ELSE 5
  END, name COLLATE NOCASE, item_id`;
}

function orderParams(q) {
  if (!q) return [];
  const prefix = likePattern(q, "prefix");
  const contains = likePattern(q, "contains");
  return [prefix, prefix, prefix, likePattern(q, "word"), contains, contains, contains, contains, contains];
}

const ROW_COLUMNS = `item_id, name, sku, part_number, status, unit, rate, purchase_rate, hsn_or_sac, tax_name, description, stock_on_hand`;

function failedSearch(query, safeStatus, pageSize, err) {
  return {
    ready: false,
    loadError: err ? `${err.message}. ${fileInfo()}` : openError,
    rows: [],
    total: 0,
    page: 1,
    pages: 1,
    pageSize,
    q: query,
    status: safeStatus,
  };
}

function search({ q = "", status = "all", page = 1, pageSize = PAGE_SIZE } = {}) {
  const query = String(q || "").trim();
  const safeStatus = status === "active" || status === "inactive" ? status : "all";
  const size = Math.min(Math.max(Number(pageSize) || PAGE_SIZE, 1), 100);
  const database = open();
  if (!database) return failedSearch(query, safeStatus, size);
  try {
    const filter = whereClause(query, safeStatus);
    const total = queryGet(`SELECT COUNT(*) AS n FROM books_items ${filter.sql}`, filter.params).n;
    const pages = Math.max(1, Math.ceil(total / size));
    const current = Math.min(Math.max(Number(page) || 1, 1), pages);
    const rows = queryAll(
      `SELECT ${ROW_COLUMNS} FROM books_items ${filter.sql} ORDER BY ${orderSql(query)} LIMIT ? OFFSET ?`,
      [...filter.params, ...orderParams(query), size, (current - 1) * size]
    );
    return { ready: true, loadError: null, rows, total, page: current, pages, pageSize: size, q: query, status: safeStatus };
  } catch (err) {
    return failedSearch(query, safeStatus, size, err);
  }
}

function suggest(q, status = "all", limit = 12) {
  const result = search({ q, status, page: 1, pageSize: Math.min(limit, 20) });
  return result.rows;
}

function getItem(itemId) {
  const database = open();
  if (!database) return null;
  const row = queryGet("SELECT * FROM books_items WHERE item_id = ?", [String(itemId)]);
  if (!row) return null;
  let raw = {};
  try {
    raw = JSON.parse(row.raw_json || "{}");
  } catch {
    raw = {};
  }
  return { ...row, raw };
}

function counts() {
  const database = open();
  if (!database) return null;
  try {
    const rows = queryAll("SELECT status, COUNT(*) AS n FROM books_items GROUP BY status");
    const byStatus = Object.fromEntries(rows.map((row) => [row.status, row.n]));
    const total = Object.values(byStatus).reduce((sum, n) => sum + n, 0);
    return { total, active: byStatus.active || 0, inactive: byStatus.inactive || 0 };
  } catch {
    return null;
  }
}

function filled(value) {
  if (value == null) return false;
  if (typeof value === "string") return value.trim() !== "";
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === "object") return Object.keys(value).length > 0;
  return true;
}

function isFlag(key, value) {
  if (typeof value === "boolean") return true;
  if (value !== 0 && value !== 1) return false;
  return /^(can_|track_|is_|show_|has_)/.test(key);
}

function formatValue(key, value) {
  if (isFlag(key, value)) return value === true || value === 1 ? "Yes" : "No";
  if (MONEY_KEYS.has(key) && value !== "" && value != null && Number.isFinite(Number(value))) {
    return new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 2 }).format(Number(value));
  }
  if ((key === "created_time" || key === "last_modified_time") && typeof value === "string") {
    const date = new Date(value);
    if (!Number.isNaN(date.getTime())) {
      return new Intl.DateTimeFormat("en-IN", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Kolkata" }).format(date);
    }
  }
  if (key === "stock_on_hand" && value != null && value !== "") return String(value);
  if (key === "tax_percentage" && value != null && !String(value).includes("%")) return `${value}%`;
  return String(value);
}

function labelFor(key) {
  return String(key)
    .replace(/^cf_/, "")
    .replace(/_formatted$|_unformatted$/g, "")
    .replace(/_/g, " ")
    .replace(/\b\w/g, (ch) => ch.toUpperCase());
}

function summaryOf(item) {
  return SUMMARY_FIELDS
    .map(([key, label]) => ({ key, label, value: formatValue(key, item[key]) }))
    .filter((field) => {
      const value = item[field.key];
      if (!filled(value) && value !== 0) return false;
      if (field.key === "tax_percentage" && Number(value) === 0 && !item.tax_name) return false;
      return true;
    });
}

function customFieldsOf(raw) {
  const rows = [];
  const seen = new Set();
  for (const field of raw.custom_fields || []) {
    if (!field || !filled(field.value)) continue;
    const label = field.label || labelFor(field.api_name || "Custom field");
    seen.add(field.api_name);
    rows.push({ label, value: String(field.value) });
  }
  for (const [key, value] of Object.entries(raw)) {
    if (!key.startsWith("cf_") || key.endsWith("_formatted") || key.endsWith("_unformatted")) continue;
    if (seen.has(key) || !filled(value)) continue;
    rows.push({ label: labelFor(key), value: String(value) });
  }
  return rows;
}

function locationsOf(raw) {
  return (raw.locations || [])
    .filter((location) => location && (location.is_item_mapped || Number(location.location_stock_on_hand)))
    .map((location) => ({
      name: location.location_name || "Location",
      stock: location.location_stock_on_hand,
      available: location.location_available_for_sale_stock,
      committed: location.location_committed_stock,
    }));
}

function extraFields(raw) {
  const rows = [];
  for (const [key, value] of Object.entries(raw)) {
    if (SKIP_KEYS.has(key) || key.endsWith("_id") || key.endsWith("_formatted") || key.endsWith("_unformatted")) continue;
    if (key.startsWith("cf_")) continue;
    if (value != null && typeof value === "object") continue;
    if (isFlag(key, value) && value !== true && value !== 1) continue;
    if (!filled(value)) continue;
    rows.push({ key, label: labelFor(key), value: formatValue(key, value) });
  }
  return rows;
}

module.exports = {
  DB_FILE,
  PAGE_SIZE,
  prepare,
  open,
  meta,
  search,
  suggest,
  getItem,
  counts,
  summaryOf,
  customFieldsOf,
  locationsOf,
  extraFields,
  formatValue,
};
