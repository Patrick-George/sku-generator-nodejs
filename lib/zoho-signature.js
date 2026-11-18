const crypto = require("crypto");

function flatten(params) {
  const out = {};
  for (const [key, value] of Object.entries(params || {})) {
    if (value == null) continue;
    out[key] = Array.isArray(value) ? value.map(String).join(",") : String(value);
  }
  return out;
}

function concatSorted(params) {
  return Object.keys(params).sort().map((key) => key + params[key]).join("");
}

function signingString(query, rawBody, contentType) {
  const raw = Buffer.isBuffer(rawBody) ? rawBody.toString("utf8") : String(rawBody || "");
  const type = String(contentType || "").toLowerCase();
  if (type.includes("application/x-www-form-urlencoded")) {
    return concatSorted({ ...flatten(query), ...flatten(Object.fromEntries(new URLSearchParams(raw))) });
  }
  return concatSorted(flatten(query)) + raw;
}

function sameText(given, expected) {
  const left = Buffer.from(String(given));
  const right = Buffer.from(String(expected));
  if (left.length !== right.length) return false;
  return crypto.timingSafeEqual(left, right);
}

function verifySignature({ query, rawBody, contentType, signature, secret }) {
  if (!secret || !signature) return false;
  const payload = signingString(query, rawBody, contentType);
  const hmac = crypto.createHmac("sha256", secret).update(payload).digest();
  const given = String(signature).trim();
  return sameText(given, hmac.toString("base64")) || sameText(given, hmac.toString("hex"));
}

module.exports = { signingString, verifySignature };
