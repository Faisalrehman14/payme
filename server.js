require("dotenv").config();
require("websocket-polyfill");

const { webcrypto } = require("crypto");
if (!globalThis.crypto) {
  globalThis.crypto = webcrypto;
}

const express = require("express");
const QRCode = require("qrcode");
const path = require("path");
const { NWCClient } = require("@getalby/sdk/nwc");

const app = express();
const PORT = process.env.PORT || 3000;
const INVOICE_EXPIRY_SEC = 600;
const NWC_URL = process.env.NWC_URL;
const ALBY_TOKEN = process.env.ALBY_API_TOKEN;

app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

function hasCredentials() {
  const nwcOk = NWC_URL && !NWC_URL.includes("paste_here");
  const tokenOk = ALBY_TOKEN && ALBY_TOKEN !== "your_token_here";
  return nwcOk || tokenOk;
}

function requireCredentials(res) {
  if (!hasCredentials()) {
    res.status(500).json({
      error:
        "NWC_URL missing. Alby Hub ? Connections ? New Connection ? copy full nostr+walletconnect:// string into .env",
    });
    return false;
  }
  return true;
}

function createNwcClient() {
  return new NWCClient({ nostrWalletConnectUrl: NWC_URL });
}

async function albyFetch(endpoint, options = {}) {
  const response = await fetch(`https://api.getalby.com${endpoint}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${ALBY_TOKEN}`,
      "Content-Type": "application/json",
      ...(options.headers || {}),
    },
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data.message || data.error || `Alby API error (${response.status})`);
  }
  return data;
}

app.get("/api/price", async (_req, res) => {
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

app.post("/api/invoice", async (req, res) => {
  if (!requireCredentials(res)) return;

  try {
    const { amountUsd, memo } = req.body;
    const usd = Number(amountUsd);

    if (!usd || usd < 1) {
      return res.status(400).json({ error: "Minimum amount is $1" });
    }

    const priceRes = await fetch("https://mempool.space/api/v1/prices");
    const priceData = await priceRes.json();
    const btcPrice = priceData.USD || priceData.usd;
    if (!btcPrice) throw new Error("Could not fetch BTC price");

    const sats = Math.max(1, Math.round((usd / btcPrice) * 100_000_000));
    const description = memo || `Payment $${usd.toFixed(2)}`;

    let paymentRequest;
    let paymentHash;

    if (NWC_URL && !NWC_URL.includes("paste_here")) {
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
      expiresAt: Date.now() + INVOICE_EXPIRY_SEC * 1000,
      expirySec: INVOICE_EXPIRY_SEC,
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

app.get("/api/invoice/:hash/status", async (req, res) => {
  if (!requireCredentials(res)) return;

  try {
    if (NWC_URL && !NWC_URL.includes("paste_here")) {
      const client = createNwcClient();
      try {
        const result = await client.lookupInvoice({ payment_hash: req.params.hash });
        const settled = result.invoice?.settled ?? result.settled ?? false;
        res.json({
          settled: Boolean(settled),
          amount: result.invoice?.amount ?? result.amount,
          settledAt: settled ? new Date().toISOString() : null,
        });
      } finally {
        client.close();
      }
    } else {
      const invoice = await albyFetch(`/invoices/${req.params.hash}`);
      res.json({
        settled: Boolean(invoice.settled_at),
        amount: invoice.amount,
        settledAt: invoice.settled_at || null,
      });
    }
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.listen(PORT, () => {
  console.log(`Lightning Pay running ? http://localhost:${PORT}`);
  if (!hasCredentials()) {
    console.log("?  Add NWC_URL to .env (Alby Hub ? Connections ? New Connection)");
  }
});
