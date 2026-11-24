const fs = require("fs");
const path = require("path");
const readline = require("readline");
const Database = require("better-sqlite3");

const DB_FILE = process.env.TALLY_DB || path.join(__dirname, "..", "data", "tally_items.sqlite");

function decode(value) {
  return String(value || "")
    .replace(/&#(\d+);/g, (_, digits) => {
      const code = Number(digits);
      return code < 32 ? "" : String.fromCodePoint(code);
    })
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex) => {
      const code = parseInt(hex, 16);
      return code < 32 ? "" : String.fromCodePoint(code);
    })
    .replace(/&quot;/g, "\"")
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();
}

function tag(block, name) {
  const match = block.match(new RegExp(`<${name}>([^<]*)</${name}>`));
  return match ? decode(match[1]) : "";
}

function tags(block, name) {
  const found = [];
  const pattern = new RegExp(`<${name}>([^<]*)</${name}>`, "g");
  let match;
  while ((match = pattern.exec(block))) {
    const value = decode(match[1]);
    if (value) found.push(value);
  }
  return found;
}

function lastIgst(block) {
  const pattern = /<GSTRATEDUTYHEAD>\s*IGST\s*<\/GSTRATEDUTYHEAD>[\s\S]*?<GSTRATE>([^<]*)<\/GSTRATE>/g;
  let rate = "";
  let match;
  while ((match = pattern.exec(block))) rate = decode(match[1]);
  return rate;
}

function leadingNumber(value) {
  const match = String(value || "").replace(/,/g, "").match(/-?\d+(?:\.\d+)?/);
  if (!match) return null;
  const parsed = Number(match[0]);
  return Number.isFinite(parsed) ? parsed : null;
}

function tallyTime(value) {
  const digits = String(value || "").replace(/\D/g, "");
  if (digits.length < 14) return "";
  return `${digits.slice(0, 4)}-${digits.slice(4, 6)}-${digits.slice(6, 8)} ${digits.slice(8, 10)}:${digits.slice(10, 12)}:${digits.slice(12, 14)}`;
}

function attributeName(block) {
  const match = block.match(/<STOCKITEM\s+NAME="([^"]*)"/);
  return match ? decode(match[1]) : "";
}

function itemFrom(block) {
  const name = attributeName(block) || tag(block, "NAME");
  if (!name) return null;
  const mailing = tags(block, "MAILINGNAME").find((value) => value.toLowerCase() !== name.toLowerCase()) || "";
  const aliases = tags(block, "NAME").filter((value) => value.toLowerCase() !== name.toLowerCase());
  const hsn = tags(block, "HSNCODE").at(-1) || "";
  const taxability = tags(block, "TAXABILITY").at(-1) || "";
  const igst = lastIgst(block);
  const openingRate = leadingNumber(tag(block, "OPENINGRATE"));
  const openingQty = leadingNumber(tag(block, "OPENINGBALANCE"));
  const deleted = tag(block, "ISDELETED").toLowerCase() === "yes";
  const guid = tag(block, "GUID");
  const raw = {
    guid,
    parent: tag(block, "PARENT"),
    category: tag(block, "CATEGORY"),
    base_units: tag(block, "BASEUNITS"),
    mailing_name: mailing,
    aliases,
    hsn,
    gst_taxability: taxability,
    igst_rate: igst,
    opening_balance: tag(block, "OPENINGBALANCE"),
    opening_rate: tag(block, "OPENINGRATE"),
    opening_value: tag(block, "OPENINGVALUE"),
    alter_id: tag(block, "ALTERID"),
    entered_by: tag(block, "ENTEREDBY"),
    updated: tag(block, "UPDATEDDATETIME"),
    is_deleted: deleted,
  };
  return {
    item_id: guid || name,
    name,
    sku: "",
    part_number: mailing,
    group_name: raw.parent,
    status: deleted ? "inactive" : "active",
    unit: raw.base_units,
    rate: null,
    purchase_rate: openingRate,
    description: aliases.join("\n"),
    purchase_description: "",
    hsn_or_sac: hsn,
    tax_name: taxability,
    tax_percentage: igst,
    account_name: "",
    purchase_account_name: "",
    inventory_account_name: "",
    vendor_name: "",
    brand: "",
    manufacturer: "",
    item_code: "",
    stock_on_hand: openingQty,
    track_inventory: null,
    can_be_sold: null,
    can_be_purchased: null,
    product_type: raw.category,
    item_type: "Stock item",
    created_time: "",
    last_modified_time: tallyTime(raw.updated),
    raw_json: JSON.stringify(raw),
  };
}

function writeItems(items, company) {
  fs.mkdirSync(path.dirname(DB_FILE), { recursive: true });
  if (fs.existsSync(DB_FILE)) fs.unlinkSync(DB_FILE);
  const db = new Database(DB_FILE);
  db.exec(`
    CREATE TABLE tally_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    CREATE TABLE tally_items (
      item_id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      sku TEXT NOT NULL DEFAULT '',
      part_number TEXT NOT NULL DEFAULT '',
      group_name TEXT NOT NULL DEFAULT '',
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
    CREATE INDEX tally_items_name ON tally_items(name);
    CREATE INDEX tally_items_part ON tally_items(part_number);
    CREATE INDEX tally_items_status ON tally_items(status);
    CREATE INDEX tally_items_group ON tally_items(group_name);
  `);
  const insert = db.prepare(`
    INSERT INTO tally_items (
      item_id, name, sku, part_number, group_name, status, unit, rate, purchase_rate,
      description, purchase_description, hsn_or_sac, tax_name, tax_percentage, account_name,
      purchase_account_name, inventory_account_name, vendor_name, brand, manufacturer, item_code,
      stock_on_hand, track_inventory, can_be_sold, can_be_purchased, product_type, item_type,
      created_time, last_modified_time, raw_json
    ) VALUES (
      @item_id, @name, @sku, @part_number, @group_name, @status, @unit, @rate, @purchase_rate,
      @description, @purchase_description, @hsn_or_sac, @tax_name, @tax_percentage, @account_name,
      @purchase_account_name, @inventory_account_name, @vendor_name, @brand, @manufacturer, @item_code,
      @stock_on_hand, @track_inventory, @can_be_sold, @can_be_purchased, @product_type, @item_type,
      @created_time, @last_modified_time, @raw_json
    )
  `);
  const save = db.transaction((rows) => {
    for (const row of rows) insert.run(row);
  });
  save(items);
  const meta = db.prepare("INSERT INTO tally_meta (key, value) VALUES (?, ?)");
  meta.run("organization", company || "Blastline India Pvt Ltd");
  meta.run("taken_at", new Date().toISOString().slice(0, 10));
  meta.run("item_count", String(items.length));
  meta.run("source", "Tally stock item master");
  db.close();
}

async function readStockItems(file) {
  const items = [];
  const seen = new Set();
  let company = "";
  let capturing = false;
  let block = [];
  const lines = readline.createInterface({
    input: fs.createReadStream(file, { encoding: "utf16le" }),
    crlfDelay: Infinity,
  });
  for await (const line of lines) {
    if (!company && line.includes("<SVCURRENTCOMPANY>")) {
      company = decode(line.replace(/.*<SVCURRENTCOMPANY>/, "").replace(/<\/SVCURRENTCOMPANY>.*/, ""));
    }
    if (!capturing) {
      if (line.includes("<STOCKITEM ")) {
        capturing = true;
        block = [line];
      }
      continue;
    }
    block.push(line);
    if (line.includes("</STOCKITEM>")) {
      const item = itemFrom(block.join("\n"));
      capturing = false;
      block = [];
      if (!item || seen.has(item.item_id)) continue;
      seen.add(item.item_id);
      items.push(item);
    }
  }
  return { items, company };
}

async function main() {
  const file = process.argv[2];
  if (!file) {
    console.error("Usage: node scripts/import-tally-items.js <stockitems.xml>");
    process.exit(1);
  }
  const { items, company } = await readStockItems(file);
  writeItems(items, company);
  console.log(`Wrote ${items.length} Tally stock items for ${company || "the company"} to ${DB_FILE}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
