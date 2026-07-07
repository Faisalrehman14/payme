const express = require("express");
const QRCode = require("qrcode");
const db = require("../../db");
const { INVOICE_EXPIRY_SEC } = require("../config");
const { officePublicView } = require("../services/views");
const {
  parseNwcUrl,
  getNwcUrl,
  getAlbyToken,
  requireCredentials,
  createNwcClient,
  albyFetch,
  lookupInvoiceSettled,
} = require("../services/nwc");
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
    const office = await db.getOfficeBySlugAny(req.params.slug);
    if (!office) {
      return res.status(404).json({ error: "Office not found" });
    }
    res.json({ office: officePublicView(office) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get("/health", async (_req, res) => {
  const nwc = parseNwcUrl(process.env.NWC_URL || "");
  const token = getAlbyToken();
  let tokenOk = false;
  let tokenError = null;

  if (token) {
    try {
      const response = await fetch("https://api.getalby.com/balance", {
        headers: { Authorization: `Bearer ${token}` },
      });
      tokenOk = response.ok;
      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        tokenError = data.error || data.message || "invalid access token";
      }
    } catch (err) {
      tokenError = err.message;
    }
  }

  const database = await db.healthCheck();
  const sync = getSyncStatus();

  res.json({
    ok: (nwc.valid || tokenOk) && database.ok,
    nwc: nwc.valid,
    nwcError: nwc.valid ? null : nwc.error,
    token: tokenOk,
    tokenError,
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
    if (officeSlug) {
      office = await db.getOfficeBySlugAny(officeSlug);
      if (!office) {
        return res.status(404).json({ error: "Invalid payment link" });
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

    let paymentRequest;
    let paymentHash;

    if (getNwcUrl()) {
      const client = createNwcClient();
      try {
        const result = await client.makeInvoice({
          amount: sats * 1000,
          description,
          expiry: INVOICE_EXPIRY_SEC,
        });
        paymentRequest = result.invoice?.bolt11 || result.invoice;
        paymentHash = result.invoice?.payment_hash || result.payment_hash;
      } finally {
        client.close();
      }
    } else {
      const invoice = await albyFetch("/invoices", {
        method: "POST",
        body: JSON.stringify({ amount: sats, memo: description }),
      });
      paymentRequest = invoice.payment_request;
      paymentHash = invoice.payment_hash;
    }

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
      });
    }

    const qrDataUrl = await QRCode.toDataURL(paymentRequest, {
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
    let message = err.message || "Unknown error";
    if (message.includes("timeout") || message.includes("Timeout")) {
      message =
        "Alby Hub is not responding. Open Alby Hub, unlock with password, keep it running, then try again.";
    }
    res.status(500).json({ error: message });
  }
});

router.get("/invoice/:hash/status", async (req, res) => {
  if (!requireCredentials(res)) return;

  try {
    const result = await lookupInvoiceSettled(req.params.hash);
    const settled = result.settled;
    const settledAt = result.settledAt || (settled ? new Date().toISOString() : null);

    const stored = await db.getPaymentByHash(req.params.hash);
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
