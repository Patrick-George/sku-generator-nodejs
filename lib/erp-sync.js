const erp = require("./erp");

const TEXT_FIELDS = {
  name: ["name", "item_name"],
  sku: ["sku"],
  part_number: ["part_number", "mpn"],
  group_id: ["group_id"],
  group_name: ["group_name"],
  status: ["status"],
  unit: ["unit"],
  description: ["description"],
  purchase_description: ["purchase_description"],
  hsn_or_sac: ["hsn_or_sac", "hsn"],
  tax_name: ["tax_name"],
  account_name: ["account_name"],
  purchase_account_name: ["purchase_account_name"],
  inventory_account_name: ["inventory_account_name"],
  vendor_name: ["vendor_name"],
  brand: ["brand"],
  manufacturer: ["manufacturer"],
  item_code: ["item_code"],
  product_type: ["product_type"],
  item_type: ["item_type"],
  created_time: ["created_time"],
  last_modified_time: ["last_modified_time", "modified_time"],
};

const NUMBER_FIELDS = {
  rate: ["rate"],
  purchase_rate: ["purchase_rate"],
  tax_percentage: ["tax_percentage"],
  stock_on_hand: ["stock_on_hand"],
};

const FLAG_FIELDS = {
  track_inventory: ["track_inventory"],
  can_be_sold: ["can_be_sold"],
  can_be_purchased: ["can_be_purchased"],
};

function parseBody(rawBody) {
  const raw = Buffer.isBuffer(rawBody) ? rawBody.toString("utf8").trim() : String(rawBody || "").trim();
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    throw new Error("Webhook body is not valid JSON.");
  }
}

function itemRecord(body) {
  if (body.item && typeof body.item === "object" && !Array.isArray(body.item)) return body.item;
  if (body.data && typeof body.data === "object" && !Array.isArray(body.data)) return body.data;
  return body;
}

function lowerKeys(record) {
  const out = {};
  for (const [key, value] of Object.entries(record || {})) out[String(key).toLowerCase()] = value;
  return out;
}

function normalizeEvent(value) {
  const event = String(value || "").trim().toLowerCase();
  if (["create", "created", "add"].includes(event)) return "created";
  if (["edit", "edited", "update", "updated"].includes(event)) return "edited";
  if (["delete", "deleted"].includes(event)) return "deleted";
  return "";
}

function hasKey(record, keys) {
  return keys.some((key) => Object.prototype.hasOwnProperty.call(record, key));
}

function rawValue(record, keys) {
  for (const key of keys) {
    if (Object.prototype.hasOwnProperty.call(record, key)) return record[key];
  }
  return undefined;
}

function text(value) {
  if (value == null || typeof value === "object") return "";
  return String(value).trim();
}

function num(value) {
  if (value == null || value === "") return null;
  const parsed = Number(String(value).replace(/,/g, ""));
  return Number.isFinite(parsed) ? parsed : null;
}

function bit(value) {
  if (value == null || value === "") return null;
  if (value === true || value === 1) return 1;
  const normalized = String(value).trim().toLowerCase();
  if (["1", "true", "yes", "y"].includes(normalized)) return 1;
  if (["0", "false", "no", "n"].includes(normalized)) return 0;
  return null;
}

function statusOf(value, fallback) {
  const textValue = text(value).toLowerCase();
  if (textValue === "active" || textValue === "inactive") return textValue;
  return fallback || textValue;
}

function rememberMeta() {
  const counts = erp.counts();
  if (!counts) return;
  erp.run(
    "INSERT INTO erp_meta (key, value) VALUES ('item_count', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
    [String(counts.total)]
  );
  erp.run(
    "INSERT INTO erp_meta (key, value) VALUES ('last_webhook_at', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
    [new Date().toISOString()]
  );
}

function applyWebhook({ query = {}, rawBody }) {
  if (typeof erp.run !== "function") throw new Error("ERP catalog is not ready for updates.");
  const body = parseBody(rawBody);
  const event = normalizeEvent(query.event || body.event);
  if (!event) throw new Error("Webhook event must be created, edited, or deleted.");
  const item = lowerKeys(itemRecord(body));
  const itemId = text(query.item_id || item.item_id || item.id);
  if (!itemId) throw new Error("Webhook is missing item_id.");

  const existing = erp.getItem(itemId);
  if (event === "deleted") {
    if (existing) {
      erp.run("DELETE FROM erp_items WHERE item_id = ?", [itemId]);
      rememberMeta();
      erp.persist();
    }
    return { event, item_id: itemId, removed: Boolean(existing) };
  }

  const current = existing || {};
  const record = { item_id: itemId };
  for (const [column, keys] of Object.entries(TEXT_FIELDS)) {
    if (hasKey(item, keys)) record[column] = text(rawValue(item, keys));
    else if (existing) record[column] = current[column] || "";
    else record[column] = "";
  }
  for (const [column, keys] of Object.entries(NUMBER_FIELDS)) {
    if (hasKey(item, keys)) record[column] = num(rawValue(item, keys));
    else record[column] = existing ? current[column] : null;
  }
  for (const [column, keys] of Object.entries(FLAG_FIELDS)) {
    if (hasKey(item, keys)) record[column] = bit(rawValue(item, keys));
    else record[column] = existing ? current[column] : null;
  }
  record.status = statusOf(record.status, existing ? current.status : "active");
  if (!record.name) record.name = existing ? current.name : `Item ${itemId}`;

  const raw = { ...(existing ? existing.raw : {}) };
  for (const [key, value] of Object.entries(item)) {
    if (value == null || typeof value !== "object") raw[key] = value;
    else raw[key] = value;
  }
  if (record.part_number) raw.part_number = record.part_number;
  raw.webhook_event = event;
  record.raw_json = JSON.stringify(raw);

  const columns = Object.keys(record);
  if (existing) {
    const assignments = columns.filter((column) => column !== "item_id").map((column) => `${column} = ?`);
    erp.run(
      `UPDATE erp_items SET ${assignments.join(", ")} WHERE item_id = ?`,
      [...columns.filter((column) => column !== "item_id").map((column) => record[column]), itemId]
    );
  } else {
    erp.run(
      `INSERT INTO erp_items (${columns.join(", ")}) VALUES (${columns.map(() => "?").join(", ")})`,
      columns.map((column) => record[column])
    );
  }
  rememberMeta();
  erp.persist();
  return { event, item_id: itemId, created: !existing };
}

module.exports = { applyWebhook };
