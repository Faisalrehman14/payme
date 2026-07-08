const express = require("express");
const QRCode = require("qrcode");
const db = require("../../db");
const { INVOICE_EXPIRY_SEC } = require("../config");
const { officePublicView } = require("../services/views");
const {
  parseNwcUrl,
  requireCredentials,
  createInvoicePayment,
  lookupInvoiceSettled,
  testPaymentProvider,
  getAlbyTokenDiagnostics,
} = require("../services/nwc");
const { normalizeOfficeSlug } = require("../utils/office-slug");
const { syncPaymentRecord } = require("../services/payment-sync");
const { getSyncStatus } = require("../worker/sync-worker");

const router = express.Router();

router.get("/settings/landing", async (_req, res) => {
  try {
    const settings = await db.getPlatformSettings();
    res.json({
      contactEmail: settings.contactEmail,
      contactHeadline: settings.contactHeadline,
      contactMessage: settings.contactMessage,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get("/offices/:slug", async (req, res) => {
  try {
    const slug = normalizeOfficeSlug(req.params.slug);
    if (!slug) {
      return res.status(400).json({ error: "Invalid payment link" });
    }
    const office = await db.getOfficeBySlugAny(slug);
    if (!office) {
      return res.status(404).json({ error: "Office not found — check your payment link with the office" });
    }
    res.json({ office: officePublicView(office) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get("/health", async (_req, res) => {
  const nwc = parseNwcUrl(process.env.NWC_URL || "");
  const tokenDiag = getAlbyTokenDiagnostics();
  const provider = await testPaymentProvider();
  const database = await db.healthCheck();
  const sync = getSyncStatus();

  res.json({
    ok: provider.ok && database.ok,
    nwc: nwc.valid,
    nwcError: nwc.valid ? null : nwc.error,
    token: tokenDiag.valid,
    tokenConfigured: tokenDiag.configured,
    tokenError: tokenDiag.issue,
    paymentProvider: provider.provider,
    paymentProviderOk: provider.ok,
    paymentProviderError: provider.ok ? null : provider.error,
    database,
    sync,
  });
});

router.get("/price", async (_req, res) => {
  try {
    const response = await fetch("https://mempool.space/api/v1/prices");
    const data = await response.json();
    const usd = data.USD || data.usd;
    if (!usd) throw new Error("Could not fetch BTC price");
    res.json({ usd });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post("/invoice", async (req, res) => {
  if (!requireCredentials(res)) return;

  try {
    const { amountUsd, memo, officeSlug } = req.body;
    const usd = Number(amountUsd);

    if (!usd || usd < 1) {
      return res.status(400).json({ error: "Minimum amount is $1" });
    }

    let office = null;
    const slug = officeSlug ? normalizeOfficeSlug(officeSlug) : "";
    if (slug) {
      office = await db.getOfficeBySlugAny(slug);
      if (!office) {
        return res.status(404).json({
          error: "Invalid payment link — this office does not exist. Ask the office for a new link.",
        });
      }
      if (office.active === false) {
        return res.status(403).json({ error: "This office is not accepting payments right now" });
      }
    }

    const priceRes = await fetch("https://mempool.space/api/v1/prices");
    const priceData = await priceRes.json();
    const btcPrice = priceData.USD || priceData.usd;
    if (!btcPrice) throw new Error("Could not fetch BTC price");

    const sats = Math.max(1, Math.round((usd / btcPrice) * 100_000_000));
    const officeLabel = office ? office.name : "Globa Pay";
    const description = memo || `${officeLabel} — $${usd.toFixed(2)}`;

    const { paymentRequest, paymentHash, provider } = await createInvoicePayment({
      sats,
      description,
      expirySec: INVOICE_EXPIRY_SEC,
    });

    const expiresAt = Date.now() + INVOICE_EXPIRY_SEC * 1000;

    if (office) {
      await db.createPayment({
        officeId: office.id,
        paymentHash,
        amountUsd: usd,
        amountSats: sats,
        btcPrice,
        status: "pending",
        expiresAt: new Date(expiresAt).toISOString(),
        invoiceProvider: provider,
      });
    }

    const qrPayload = `lightning:${paymentRequest.toUpperCase()}`;
    const qrDataUrl = await QRCode.toDataURL(qrPayload, {
      width: 280,
      margin: 2,
      color: { dark: "#000000", light: "#ffffff" },
    });

    res.json({
      paymentHash,
      paymentRequest,
      amountSats: sats,
      amountUsd: usd,
      btcPrice,
      qrDataUrl,
      expiresAt,
      expirySec: INVOICE_EXPIRY_SEC,
      office: office ? officePublicView(office) : null,
    });
  } catch (err) {
    let message = err.message || "Payment could not be started. Please try again.";
    if (message.includes("timeout") || message.includes("Timeout") || message.includes("not responding")) {
      message =
        "Payment system is temporarily offline. Please try again in a few minutes or contact the office.";
    }
    res.status(500).json({ error: message });
  }
});

router.get("/invoice/:hash/status", async (req, res) => {
  if (!requireCredentials(res)) return;

  try {
    const stored = await db.getPaymentByHash(req.params.hash);
    const result = await lookupInvoiceSettled(req.params.hash, stored?.invoiceProvider);
    const settled = result.settled;
    const settledAt = result.settledAt || (settled ? new Date().toISOString() : null);

    if (stored) {
      await syncPaymentRecord(stored);
    }

    res.json({
      settled: Boolean(settled),
      amount: result.amount,
      settledAt,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
