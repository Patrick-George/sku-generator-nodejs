const fs = require("fs");
const path = require("path");
const Database = require("better-sqlite3");

const DB_FILE = path.join(__dirname, "..", "data", "erp_items.sqlite");

function readPayload(file) {
  const payload = JSON.parse(fs.readFileSync(file, "utf8"));
  const value = payload && payload.result && payload.result.value;
  if (value && Array.isArray(value.items)) return value.items;
  if (value && Array.isArray(value.groups)) return value.groups;
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload.items)) return payload.items;
  throw new Error(`No items in ${file}`);
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

function partOf(item) {
  if (text(item.part_number)) return text(item.part_number);
  if (text(item.cf_mpn)) return text(item.cf_mpn);
  const field = (item.custom_fields || []).find((entry) => entry && (entry.api_name === "cf_mpn" || entry.label === "Part #"));
  return field && field.value ? String(field.value).trim() : "";
}

function build(listFiles, groupFile) {
  const groups = new Map();
  for (const row of readPayload(groupFile)) {
    if (row && row.item_id) groups.set(String(row.item_id), row);
  }
  const items = new Map();
  for (const file of listFiles) {
    for (const item of readPayload(file)) {
      if (!item || !item.item_id) continue;
      const id = String(item.item_id);
      const group = groups.get(id) || {};
      items.set(id, {
        ...item,
        group_id: text(group.group_id || item.group_id),
        group_name: text(group.group_name || item.group_name),
      });
    }
  }

  if (fs.existsSync(DB_FILE)) fs.unlinkSync(DB_FILE);
  const db = new Database(DB_FILE);
  db.exec(`
    CREATE TABLE erp_meta (
      key TEXT PRIMARY KEY,
      value TEXT
    );
    CREATE TABLE erp_items (
      item_id TEXT PRIMARY KEY,
      name TEXT,
      sku TEXT,
      part_number TEXT,
      group_id TEXT,
      group_name TEXT,
      status TEXT,
      unit TEXT,
      rate REAL,
      purchase_rate REAL,
      description TEXT,
      purchase_description TEXT,
      hsn_or_sac TEXT,
      tax_name TEXT,
      tax_percentage REAL,
      account_name TEXT,
      purchase_account_name TEXT,
      inventory_account_name TEXT,
      vendor_name TEXT,
      brand TEXT,
      manufacturer TEXT,
      item_code TEXT,
      stock_on_hand REAL,
      track_inventory INTEGER,
      can_be_sold INTEGER,
      can_be_purchased INTEGER,
      product_type TEXT,
      item_type TEXT,
      created_time TEXT,
      last_modified_time TEXT,
      raw_json TEXT
    );
  `);
  const insert = db.prepare(`
    INSERT INTO erp_items (
      item_id, name, sku, part_number, group_id, group_name, status, unit, rate, purchase_rate,
      description, purchase_description, hsn_or_sac, tax_name, tax_percentage, account_name,
      purchase_account_name, inventory_account_name, vendor_name, brand, manufacturer, item_code,
      stock_on_hand, track_inventory, can_be_sold, can_be_purchased, product_type, item_type,
      created_time, last_modified_time, raw_json
    ) VALUES (
      @item_id, @name, @sku, @part_number, @group_id, @group_name, @status, @unit, @rate, @purchase_rate,
      @description, @purchase_description, @hsn_or_sac, @tax_name, @tax_percentage, @account_name,
      @purchase_account_name, @inventory_account_name, @vendor_name, @brand, @manufacturer, @item_code,
      @stock_on_hand, @track_inventory, @can_be_sold, @can_be_purchased, @product_type, @item_type,
      @created_time, @last_modified_time, @raw_json
    )
  `);
  const insertMeta = db.prepare("INSERT INTO erp_meta (key, value) VALUES (?, ?)");
  const write = db.transaction((rows) => {
    for (const item of rows) {
      insert.run({
        item_id: String(item.item_id),
        name: text(item.name || item.item_name),
        sku: text(item.sku),
        part_number: partOf(item),
        group_id: text(item.group_id),
        group_name: text(item.group_name),
        status: text(item.status),
        unit: text(item.unit),
        rate: num(item.rate),
        purchase_rate: num(item.purchase_rate),
        description: text(item.description),
        purchase_description: text(item.purchase_description),
        hsn_or_sac: text(item.hsn_or_sac),
        tax_name: text(item.tax_name),
        tax_percentage: num(item.tax_percentage),
        account_name: text(item.account_name),
        purchase_account_name: text(item.purchase_account_name),
        inventory_account_name: text(item.inventory_account_name),
        vendor_name: text(item.vendor_name),
        brand: text(item.brand),
        manufacturer: text(item.manufacturer),
        item_code: text(item.item_code),
        stock_on_hand: num(item.stock_on_hand),
        track_inventory: bit(item.track_inventory),
        can_be_sold: bit(item.can_be_sold),
        can_be_purchased: bit(item.can_be_purchased),
        product_type: text(item.product_type),
        item_type: text(item.item_type),
        created_time: text(item.created_time),
        last_modified_time: text(item.last_modified_time),
        raw_json: JSON.stringify(item),
      });
    }
    const meta = {
      source: "Zoho ERP",
      organization: "Blastline India Private Limited",
      organization_id: "60070950161",
      taken_at: "2026-11-18",
      item_count: String(rows.length),
    };
    for (const [key, value] of Object.entries(meta)) insertMeta.run(key, value);
  });
  write([...items.values()]);
  db.close();
  return { items: items.size, groups: groups.size };
}

const listFiles = process.argv.slice(2, -1);
const groupFile = process.argv[process.argv.length - 1];
if (listFiles.length < 1 || !groupFile) {
  console.error("Usage: node scripts/import-erp-items.js <list.json> ... <groups.json>");
  process.exit(1);
}
console.log(JSON.stringify(build(listFiles, groupFile)));
