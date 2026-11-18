const express = require("express");
const { verifySignature } = require("../lib/zoho-signature");
const { applyWebhook } = require("../lib/erp-sync");

const router = express.Router();

router.post("/erp/items", express.raw({ type: () => true, limit: "2mb" }), (req, res) => {
  const secret = process.env.ZOHO_ERP_WEBHOOK_SECRET || "";
  if (!secret) return res.status(503).json({ ok: false, error: "Webhook secret is not configured." });
  const rawBody = Buffer.isBuffer(req.body) ? req.body : Buffer.from(String(req.body || ""), "utf8");
  const signature = req.get("x-zoho-webhook-signature") || "";
  const valid = verifySignature({
    query: req.query,
    rawBody,
    contentType: req.get("content-type"),
    signature,
    secret,
  });
  if (!valid) return res.status(401).json({ ok: false, error: "Invalid webhook signature." });
  try {
    const result = applyWebhook({ query: req.query, rawBody });
    res.json({ ok: true, ...result });
  } catch (err) {
    console.error("ERP webhook failed.", err.message);
    res.status(400).json({ ok: false, error: err.message });
  }
});

module.exports = router;
