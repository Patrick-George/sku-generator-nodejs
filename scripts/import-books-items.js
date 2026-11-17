const fs = require("fs");
const path = require("path");
const Database = require("better-sqlite3");

const DB_FILE = path.join(__dirname, "..", "data", "books_items.sqlite");

function readItems(file) {
  const payload = JSON.parse(fs.readFileSync(file, "utf8"));
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload.items)) return payload.items;
  const value = payload && payload.result && payload.result.value;
  if (value && Array.isArray(value.items)) return value.items;
  throw new Error(`No items in ${file}`);
}

function merge(listItem, detail) {
  const merged = { ...listItem };
  if (!detail) return merged;
  for (const [key, value] of Object.entries(detail)) {
    const current = merged[key];
    const empty = current == null || current === "" || (Array.isArray(current) && current.length === 0);
    if (empty && value != null && value !== "") merged[key] = value;
  }
  for (const key of [
    "locations", "custom_fields", "package_details", "price_brackets", "default_price_brackets",
    "inventory_account_id", "inventory_account_name", "item_code", "vendor_id", "unit_id",
    "pricebook_rate", "pricing_scheme", "sales_margin", "is_combo_product", "track_serial_number",
    "track_batch_number",
  ]) {
    if (detail[key] != null) merged[key] = detail[key];
  }
  return merged;
}

function partOf(item) {
  if (item.cf_mpn) return String(item.cf_mpn).trim();
  const field = (item.custom_fields || []).find((entry) => entry && (entry.api_name === "cf_mpn" || entry.label === "Part #"));
  return field && field.value ? String(field.value).trim() : "";
}

function stockOf(item) {
  const locations = Array.isArray(item.locations) ? item.locations : [];
  if (!locations.length) return null;
  let sum = 0;
  let seen = false;
  for (const location of locations) {
    if (!location || location.location_stock_on_hand == null || location.location_stock_on_hand === "") continue;
    const qty = Number(location.location_stock_on_hand);
    if (!Number.isFinite(qty)) continue;
    sum += qty;
    seen = true;
  }
  return seen ? sum : null;
}

function text(value) {
  if (typeof value === "string") return value.trim();
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return "";
}

function bit(value) {
  if (value == null || value === "") return null;
  return value === true || value === 1 || value === "true" ? 1 : 0;
}

function num(value) {
  if (value == null || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function build(listFiles, detailFiles) {
  const details = new Map();
  for (const file of detailFiles) {
    for (const item of readItems(file)) {
      if (item && item.item_id) details.set(String(item.item_id), item);
    }
  }
  const items = new Map();
  for (const file of listFiles) {
    for (const item of readItems(file)) {
      if (!item || !item.item_id) continue;
      const id = String(item.item_id);
      items.set(id, merge(item, details.get(id)));
    }
  }

  fs.mkdirSync(path.dirname(DB_FILE), { recursive: true });
  if (fs.existsSync(DB_FILE)) fs.unlinkSync(DB_FILE);
  const db = new Database(DB_FILE);
  db.exec(`
    CREATE TABLE books_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    CREATE TABLE books_items (
      item_id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      sku TEXT NOT NULL DEFAULT '',
      part_number TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT '',
      unit TEXT NOT NULL DEFAULT '',
      rate REAL,
      purchase_rate REAL,
      description TEXT NOT NULL DEFAULT '',
      purchase_description TEXT NOT NULL DEFAULT '',
      hsn_or_sac TEXT NOT NULL DEFAULT '',
      tax_name TEXT NOT NULL DEFAULT '',
      tax_percentage TEXT NOT NULL DEFAULT '',
      product_type TEXT NOT NULL DEFAULT '',
      item_type TEXT NOT NULL DEFAULT '',
      account_name TEXT NOT NULL DEFAULT '',
      purchase_account_name TEXT NOT NULL DEFAULT '',
      inventory_account_name TEXT NOT NULL DEFAULT '',
      vendor_name TEXT NOT NULL DEFAULT '',
      brand TEXT NOT NULL DEFAULT '',
      manufacturer TEXT NOT NULL DEFAULT '',
      item_code TEXT NOT NULL DEFAULT '',
      track_inventory INTEGER,
      can_be_sold INTEGER,
      can_be_purchased INTEGER,
      stock_on_hand REAL,
      created_time TEXT NOT NULL DEFAULT '',
      last_modified_time TEXT NOT NULL DEFAULT '',
      raw_json TEXT NOT NULL
    );
    CREATE INDEX books_items_name ON books_items(name);
    CREATE INDEX books_items_sku ON books_items(sku);
    CREATE INDEX books_items_part ON books_items(part_number);
    CREATE INDEX books_items_status ON books_items(status);
  `);
  const insertMeta = db.prepare("INSERT INTO books_meta (key, value) VALUES (?, ?)");
  const meta = {
    source: "Zoho Books",
    organization: "Blastline India Private Limited",
    organization_id: "60036674243",
    taken_at: "2026-11-17",
    item_count: String(items.size),
  };
  const insert = db.prepare(`
    INSERT INTO books_items (
      item_id, name, sku, part_number, status, unit, rate, purchase_rate, description, purchase_description,
      hsn_or_sac, tax_name, tax_percentage, product_type, item_type, account_name, purchase_account_name,
      inventory_account_name, vendor_name, brand, manufacturer, item_code, track_inventory, can_be_sold,
      can_be_purchased, stock_on_hand, created_time, last_modified_time, raw_json
    ) VALUES (
      @item_id, @name, @sku, @part_number, @status, @unit, @rate, @purchase_rate, @description, @purchase_description,
      @hsn_or_sac, @tax_name, @tax_percentage, @product_type, @item_type, @account_name, @purchase_account_name,
      @inventory_account_name, @vendor_name, @brand, @manufacturer, @item_code, @track_inventory, @can_be_sold,
      @can_be_purchased, @stock_on_hand, @created_time, @last_modified_time, @raw_json
    )
  `);
  const write = db.transaction((rows) => {
    for (const [key, value] of Object.entries(meta)) insertMeta.run(key, value);
    for (const item of rows) insert.run(item);
  });
  write([...items.values()].map((item) => ({
    item_id: String(item.item_id),
    name: text(item.name || item.item_name),
    sku: text(item.sku),
    part_number: partOf(item),
    status: text(item.status),
    unit: text(item.unit),
    rate: num(item.rate),
    purchase_rate: num(item.purchase_rate),
    description: String(item.description || ""),
    purchase_description: String(item.purchase_description || ""),
    hsn_or_sac: text(item.hsn_or_sac),
    tax_name: text(item.tax_name),
    tax_percentage: item.tax_percentage == null || typeof item.tax_percentage === "object" ? "" : String(item.tax_percentage),
    product_type: text(item.product_type),
    item_type: text(item.item_type),
    account_name: text(item.account_name),
    purchase_account_name: text(item.purchase_account_name),
    inventory_account_name: text(item.inventory_account_name),
    vendor_name: text(item.vendor_name),
    brand: text(item.brand),
    manufacturer: text(item.manufacturer),
    item_code: text(item.item_code),
    track_inventory: bit(item.track_inventory),
    can_be_sold: bit(item.can_be_sold),
    can_be_purchased: bit(item.can_be_purchased),
    stock_on_hand: stockOf(item),
    created_time: String(item.created_time || ""),
    last_modified_time: String(item.last_modified_time || ""),
    raw_json: JSON.stringify(item),
  })));
  db.close();
  return { items: items.size, details: details.size, db: DB_FILE };
}

function argPaths(prefix) {
  return process.argv.slice(2)
    .filter((arg) => arg.startsWith(`${prefix}=`))
    .map((arg) => arg.slice(prefix.length + 1));
}

if (require.main === module) {
  const listFiles = argPaths("list");
  const detailFiles = argPaths("detail");
  if (!listFiles.length) {
    console.error("Usage: node scripts/import-books-items.js list=file.json detail=file.json");
    process.exit(1);
  }
  const result = build(listFiles, detailFiles);
  console.log(JSON.stringify(result));
}

module.exports = { build };
