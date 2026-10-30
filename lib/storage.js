const fs = require("fs");
const path = require("path");
const { padShortCodesInPlace } = require("./sku");

const DATA_FILE = process.env.DATA_FILE || path.join(__dirname, "..", "data", "sku_data.json");

const PACKAGE_SHORT_CODES = ["2A", "2B", "3A", "3B", "4A", "4B"];
const PPE = ["+ Blast Gloves", "+ Blast Suit", "+ Blast Helmet"];

function packageContents(length, extras = []) {
  return [
    "Blast Machine (incl. Screen + Cover)",
    "Remote Control Valve",
    "Moisture Separator",
    "Abrasive Metering Valve",
    "Threaded Pot Coupling",
    "Four-Jaw Inlet Coupling",
    "Dead Man Handle",
    `Twin Hose (${length}) + Fittings`,
    `Blast Hose 1-1/4" (${length})`,
    "Blast Hose Coupling",
    "Nozzle Holder Nylon (NHP2)",
    "Nozzle #5 (8 mm) / #6 (9.5 mm)",
    "Whip Check",
    "R Clip (only for cast iron hose coupling)",
    ...extras,
  ].join("\n");
}

const PACKAGE_DETAILS = {
  "2A": packageContents("20m"),
  "2B": packageContents("40m"),
  "3A": packageContents("20m", PPE),
  "3B": packageContents("40m", PPE),
  "4A": packageContents("20m", [
    "Blast Gloves",
    "Blast Suit",
    "Blast Helmet",
    "+ Breathing Air Filter Single BL 20",
    '+ Breathing Hose 3/8" (20m) + Fittings',
  ]),
  "4B": packageContents("40m", [
    "Blast Gloves",
    "Blast Suit",
    "Blast Helmet",
    "+ Breathing Air Filter Single BL 20",
    '+ Breathing Hose 3/8" (40m) + Fittings',
  ]),
};

function insertAfter(mapping, afterKey, newKey, value) {
  const rebuilt = {};
  let inserted = false;
  for (const [key, item] of Object.entries(mapping)) {
    rebuilt[key] = item;
    if (key === afterKey) {
      rebuilt[newKey] = value;
      inserted = true;
    }
  }
  if (!inserted) rebuilt[newKey] = value;
  return rebuilt;
}

function copiedOptions(field) {
  let raw = [];
  if (Array.isArray(field)) raw = field;
  else if (field && typeof field === "object") raw = field.options || [];
  const options = [];
  for (const opt of raw) {
    if (!opt || typeof opt !== "object" || opt.type === "text") continue;
    const code = String(opt.code || "").trim();
    if (!code) continue;
    options.push({
      code,
      name: opt.name || "",
      tally_name: opt.tally_name || "",
      description: opt.description || "",
      order: opt.order != null ? opt.order : options.length + 1,
    });
  }
  return options;
}

function buildBlastMachinePackages(blastMachine) {
  const sourceFields = blastMachine && typeof blastMachine === "object" ? blastMachine.fields || {} : {};
  return {
    fields: {
      Capacity: { order: 1, options: copiedOptions(sourceFields.Capacity) },
      Certification: { order: 2, options: copiedOptions(sourceFields.Certification) },
      Helmet: {
        order: 3,
        options: [
          { code: "AS", name: "Astro", tally_name: "AS", description: "Astro Helmet", order: 1 },
          { code: "T6", name: "Testa", tally_name: "T6", description: "Testa Helmet", order: 2 },
        ],
      },
      Package: {
        order: 4,
        options: PACKAGE_SHORT_CODES.map((short, index) => ({
          code: `PK${short}`,
          name: `Package ${short}`,
          tally_name: `PK${short}`,
          description: `Package ${short}`,
          order: index + 1,
          contents: PACKAGE_DETAILS[short] || "",
        })),
      },
    },
    extras: [],
    settings: {
      separator: "",
      extras_mode: "Multiple",
      use_short_codes: false,
    },
  };
}

function packageField(data) {
  const inventory = data.inventory;
  const category = inventory && typeof inventory === "object" ? inventory["Blast Machine Packages"] : null;
  if (!category || typeof category !== "object") return null;
  const field = (category.fields || {}).Package;
  return field && typeof field === "object" ? field : null;
}

function ensureBlastMachinePackages(data) {
  if (data.blast_machine_packages_seeded) return false;
  const inventory = data.inventory;
  if (!inventory || typeof inventory !== "object" || Array.isArray(inventory)) {
    data.blast_machine_packages_seeded = true;
    return true;
  }
  if (!inventory["Blast Machine Packages"]) {
    data.inventory = insertAfter(
      inventory,
      "Blast Machine",
      "Blast Machine Packages",
      buildBlastMachinePackages(inventory["Blast Machine"])
    );
  }
  data.blast_machine_packages_seeded = true;
  return true;
}

function ensurePackageDetails(data) {
  if (data.package_details_seeded) return false;
  const field = packageField(data);
  for (const opt of (field && field.options) || []) {
    if (!opt || typeof opt !== "object") continue;
    const code = String(opt.code || "").trim();
    const short = code.startsWith("PK") ? code.slice(2) : code;
    if (PACKAGE_DETAILS[short] && !String(opt.contents || "").trim()) opt.contents = PACKAGE_DETAILS[short];
  }
  data.package_details_seeded = true;
  return true;
}

function ensurePackageDetailsV2(data) {
  if (data.package_details_v2_seeded) return false;
  const field = packageField(data);
  if (field) {
    const options = field.options || (field.options = []);
    const byCode = {};
    for (const opt of options) {
      if (opt && typeof opt === "object") byCode[String(opt.code || "").trim()] = opt;
    }
    let nextOrder = 1 + options.reduce((max, opt) => {
      const order = opt && typeof opt === "object" ? Number(opt.order) || 0 : 0;
      return order > max ? order : max;
    }, 0);
    for (const short of PACKAGE_SHORT_CODES) {
      const text = PACKAGE_DETAILS[short] || "";
      const skuCode = `PK${short}`;
      const opt = byCode[skuCode] || byCode[short];
      if (!opt) {
        options.push({
          code: skuCode,
          name: `Package ${short}`,
          tally_name: skuCode,
          description: `Package ${short}`,
          order: nextOrder,
          contents: text,
        });
        nextOrder += 1;
      } else if (text && !String(opt.contents || "").trim()) {
        opt.contents = text;
      }
    }
  }
  data.package_details_v2_seeded = true;
  return true;
}

function ensurePackagePkCodes(data) {
  if (data.package_pk_codes_seeded) return false;
  const field = packageField(data);
  if (field) {
    const options = field.options || [];
    const byCode = {};
    for (const opt of options) {
      if (opt && typeof opt === "object") byCode[String(opt.code || "").trim()] = opt;
    }
    for (const short of PACKAGE_SHORT_CODES) {
      const newCode = `PK${short}`;
      const shortOpt = byCode[short];
      const pkOpt = byCode[newCode];
      let target = pkOpt;
      if (shortOpt && !pkOpt) {
        shortOpt.code = newCode;
        byCode[newCode] = shortOpt;
        target = shortOpt;
      } else if (shortOpt) {
        target = pkOpt || shortOpt;
      }
      if (!target) continue;
      const tally = String(target.tally_name || "").trim();
      if (tally === "" || tally === short || tally === newCode) target.tally_name = newCode;
    }
  }
  data.package_pk_codes_seeded = true;
  return true;
}

function blank() {
  return { inventory: {}, sku_history: [], short_codes: {}, code_counters: {} };
}

function ensureShape(data) {
  data.inventory = data.inventory || {};
  data.sku_history = data.sku_history || [];
  data.short_codes = data.short_codes || {};
  data.code_counters = data.code_counters || {};
  return data;
}

function parseDataFile(raw) {
  // Python's json.dumps writes NaN for empty spreadsheet cells. That is not valid JSON.
  const cleaned = raw.replace(/^\uFEFF/, "").replace(/\bNaN\b|-?\bInfinity\b/g, "null");
  return { data: JSON.parse(cleaned), cleaned: cleaned !== raw.replace(/^\uFEFF/, "") };
}

function load() {
  let data = null;
  let sanitized = false;
  if (fs.existsSync(DATA_FILE)) {
    try {
      const parsed = parseDataFile(fs.readFileSync(DATA_FILE, "utf8"));
      data = parsed.data;
      sanitized = parsed.cleaned;
    } catch {
      data = null;
    }
  }
  if (!data || typeof data !== "object" || Array.isArray(data)) data = blank();
  ensureShape(data);
  let changed = sanitized || padShortCodesInPlace(data);
  if (ensureBlastMachinePackages(data)) changed = true;
  if (ensurePackageDetails(data)) changed = true;
  if (ensurePackageDetailsV2(data)) changed = true;
  if (ensurePackagePkCodes(data)) changed = true;
  if (changed) save(data);
  return data;
}

function save(data) {
  ensureShape(data);
  fs.mkdirSync(path.dirname(DATA_FILE), { recursive: true });
  const tmp = `${DATA_FILE}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
  fs.renameSync(tmp, DATA_FILE);
  return true;
}

function saveHistory(history) {
  const current = load();
  current.sku_history = history;
  return save(current);
}

function saveRegistry(shortCodes, codeCounters) {
  const current = load();
  current.short_codes = shortCodes;
  current.code_counters = codeCounters;
  return save(current);
}

module.exports = { DATA_FILE, load, save, saveHistory, saveRegistry };
