const PAGE_SIZE = 40;

const FIELDS = [
  { key: "name", label: "Name" },
  { key: "sku", label: "SKU" },
  { key: "part", label: "Part #" },
  { key: "unit", label: "Unit" },
  { key: "category", label: "Category" },
  { key: "coo", label: "COO" },
  { key: "supply", label: "Type of supply" },
  { key: "hsn", label: "HSN" },
  { key: "tax", label: "Tax %" },
  { key: "rate", label: "Selling price" },
  { key: "cost", label: "Cost price" },
];

function text(value) {
  return String(value == null ? "" : value).trim().replace(/\s+/g, " ");
}

function sameText(left, right) {
  return text(left).toLowerCase() === text(right).toLowerCase();
}

function supplyKey(value) {
  const key = text(value).toLowerCase();
  if (key === "good" || key === "goods") return "goods";
  if (key === "service" || key === "services") return "service";
  return key;
}

function numberOrNull(value) {
  if (value == null || value === "") return null;
  const parsed = Number(String(value).replace(/,/g, ""));
  return Number.isFinite(parsed) ? parsed : null;
}

function money(value) {
  return new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 2 }).format(value);
}

function erpTax(raw) {
  const prefs = raw && Array.isArray(raw.item_tax_preferences) ? raw.item_tax_preferences : [];
  const inter = prefs.find((pref) => pref && (pref.tax_specification === "inter" || pref.tax_specific_type === "igst"));
  if (!inter) return null;
  return numberOrNull(inter.tax_percentage);
}

function valuesOf(erp, tally) {
  const erpRaw = erp.raw || {};
  const tallyRaw = tally.raw || {};
  return {
    name: { erp: text(erp.name), tally: text(tally.name), mode: "text" },
    sku: { erp: text(erp.sku), tally: text(tally.sku), mode: "text" },
    part: { erp: text(erp.part_number), tally: text(tally.part_number), mode: "text" },
    unit: { erp: text(erp.unit), tally: text(tally.unit), mode: "text" },
    category: { erp: text(erpRaw.category_name), tally: text(tally.product_type || tallyRaw.category), mode: "text" },
    coo: { erp: text(erpRaw.cf_coo), tally: text(tallyRaw.coo), mode: "text" },
    supply: { erp: text(erp.product_type), tally: text(tallyRaw.gst_supply), mode: "supply" },
    hsn: { erp: text(erp.hsn_or_sac), tally: text(tally.hsn_or_sac), mode: "text" },
    tax: { erp: erpTax(erpRaw), tally: numberOrNull(tally.tax_percentage), mode: "number" },
    rate: { erp: numberOrNull(erp.rate), tally: numberOrNull(tally.rate), mode: "money" },
    cost: { erp: numberOrNull(erp.purchase_rate), tally: numberOrNull(tally.purchase_rate), mode: "money" },
  };
}

function show(value, mode) {
  if (value == null || value === "") return "";
  if (mode === "money") return money(value);
  if (mode === "number") return `${value}%`;
  return String(value);
}

function fieldResult(field, pair) {
  const left = pair.erp;
  const right = pair.tally;
  const leftBlank = left == null || left === "";
  const rightBlank = right == null || right === "";
  if (leftBlank && rightBlank) return null;
  let equal = false;
  if (!leftBlank && !rightBlank) {
    if (pair.mode === "number" || pair.mode === "money") equal = Math.abs(left - right) <= 0.009;
    else if (pair.mode === "supply") equal = supplyKey(left) === supplyKey(right);
    else equal = sameText(left, right);
  }
  if (equal) return null;
  return {
    key: field.key,
    label: field.label,
    type: leftBlank || rightBlank ? "blank" : "mismatch",
    erp: show(left, pair.mode),
    tally: show(right, pair.mode),
  };
}

function pairRow(erp, tally) {
  const mismatches = [];
  const blanks = [];
  const values = valuesOf(erp, tally);
  for (const field of FIELDS) {
    const result = fieldResult(field, values[field.key]);
    if (!result) continue;
    if (result.type === "blank") blanks.push(result);
    else mismatches.push(result);
  }
  let kind = "ok";
  if (mismatches.length) kind = "mismatch";
  else if (blanks.length) kind = "blank";
  return {
    kind,
    note: "",
    sku: text(erp.sku) || text(tally.sku),
    erp: { id: erp.item_id, name: text(erp.name) || erp.item_id },
    tally: { id: tally.item_id, name: text(tally.name) || tally.item_id },
    mismatches,
    blanks,
  };
}

function missingRow(side, item, note) {
  const name = text(item.name) || item.item_id;
  return {
    kind: side,
    note,
    sku: text(item.sku),
    erp: side === "missing-tally" ? { id: item.item_id, name } : null,
    tally: side === "missing-erp" ? { id: item.item_id, name } : null,
    mismatches: [],
    blanks: [],
  };
}

function build(erpRows, tallyRows) {
  const tallyById = new Map();
  for (const row of tallyRows) tallyById.set(String(row.item_id), row);
  const referenced = new Set();
  const rows = [];
  for (const erp of erpRows) {
    const ref = text(erp.raw && erp.raw.cf_tally_reference_id);
    if (!ref) {
      rows.push(missingRow("missing-tally", erp, "No Tally id on the ERP item"));
      continue;
    }
    const tally = tallyById.get(ref);
    if (!tally) {
      rows.push(missingRow("missing-tally", erp, "Tally id is not in the current file"));
      continue;
    }
    referenced.add(ref);
    rows.push(pairRow(erp, tally));
  }
  for (const tally of tallyRows) {
    if (referenced.has(String(tally.item_id))) continue;
    rows.push(missingRow("missing-erp", tally, "No ERP item points at this Tally id"));
  }
  rows.sort((a, b) => {
    const rank = (row) => (row.kind === "missing-tally" || row.kind === "missing-erp" ? 0 : 1);
    const byKind = rank(a) - rank(b);
    if (byKind) return byKind;
    const nameA = ((a.erp && a.erp.name) || (a.tally && a.tally.name) || "").toLowerCase();
    const nameB = ((b.erp && b.erp.name) || (b.tally && b.tally.name) || "").toLowerCase();
    return nameA.localeCompare(nameB);
  });
  return rows;
}

function hasField(list, field) {
  if (field === "all") return list.length > 0;
  return list.some((item) => item.key === field);
}

function visible(row, kind, field, q) {
  if (q) {
    const haystack = [row.sku, row.erp && row.erp.name, row.tally && row.tally.name].filter(Boolean).join(" ").toLowerCase();
    if (!haystack.includes(q)) return false;
  }
  if (kind === "missing-tally" || kind === "missing-erp") return row.kind === kind;
  if (kind === "matched") return row.erp && row.tally;
  if (kind === "mismatch") return hasField(row.mismatches, field);
  if (kind === "blank") return hasField(row.blanks, field);
  if (row.kind === "missing-tally" || row.kind === "missing-erp") return field === "all";
  return hasField(row.mismatches, field);
}

function shown(row, kind, field) {
  if (row.kind === "missing-tally" || row.kind === "missing-erp") {
    return [{ label: "", erp: "", tally: "", note: row.note }];
  }
  const source = kind === "blank" ? row.blanks : row.mismatches;
  const list = field === "all" ? source : source.filter((item) => item.key === field);
  return list;
}

function countsOf(rows) {
  const counts = { matched: 0, missingTally: 0, missingErp: 0, mismatches: 0, blanks: 0, problems: 0 };
  for (const row of rows) {
    if (row.erp && row.tally) counts.matched += 1;
    if (row.kind === "missing-tally") counts.missingTally += 1;
    if (row.kind === "missing-erp") counts.missingErp += 1;
    if (row.mismatches.length) counts.mismatches += 1;
    if (row.blanks.length) counts.blanks += 1;
    if (row.kind === "missing-tally" || row.kind === "missing-erp" || row.mismatches.length) counts.problems += 1;
  }
  return counts;
}

function report(erpRows, tallyRows, { kind = "problems", field = "all", q = "", page = 1, pageSize = PAGE_SIZE } = {}) {
  const safeKind = ["problems", "missing-tally", "missing-erp", "mismatch", "blank", "matched"].includes(kind) ? kind : "problems";
  const safeField = FIELDS.some((item) => item.key === field) ? field : "all";
  const query = text(q).toLowerCase();
  const rows = build(erpRows, tallyRows);
  const counts = countsOf(rows);
  const matched = rows.filter((row) => visible(row, safeKind, safeField, query));
  const size = Math.min(Math.max(Number(pageSize) || PAGE_SIZE, 1), 100);
  const pages = Math.max(1, Math.ceil(matched.length / size));
  const current = Math.min(Math.max(Number(page) || 1, 1), pages);
  const slice = matched.slice((current - 1) * size, current * size).map((row) => ({
    ...row,
    shown: shown(row, safeKind, safeField),
  }));
  return {
    counts,
    fields: FIELDS,
    kind: safeKind,
    field: safeField,
    q,
    rows: slice,
    total: matched.length,
    page: current,
    pages,
    pageSize: size,
  };
}

module.exports = { report, FIELDS, PAGE_SIZE };
