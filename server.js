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

function normalizeToken(value) {
  if (!value) return "";
  return value.trim().replace(/^["']|["']$/g, "");
}

const NWC_URL = process.env.NWC_URL;
const ALBY_TOKEN = normalizeToken(process.env.ALBY_API_TOKEN);

app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

app.get("/favicon.ico", (_req, res) => {
  res.redirect(301, "/favicon.svg");
});

function normalizeNwcUrl(url) {
  if (!url) return "";
  return url.trim().replace(/^["']|["']$/g, "");
}

function parseNwcUrl(url) {
  const cleaned = normalizeNwcUrl(url);
  if (!cleaned) return { valid: false, error: "NWC_URL is empty" };
  if (cleaned.includes("paste_here")) {
    return { valid: false, error: "NWC_URL still has placeholder text" };
  }
  if (!cleaned.startsWith("nostr+walletconnect://")) {
    return {
      valid: false,
      error: "NWC_URL must start with nostr+walletconnect://",
    };
  }

  const query = cleaned.split("?")[1];
  if (!query) {
    return { valid: false, error: "NWC_URL is incomplete (missing ?relay=...&secret=...)" };
  }

  const params = new URLSearchParams(query);
  const relays = params.getAll("relay");
  const secret = params.get("secret");

  if (!secret) {
    return {
      valid: false,
      error:
        "NWC_URL missing secret. Railway may have cut the URL at &. Paste the FULL string as one variable.",
    };
  }

  if (relays.length === 0) {
    return {
      valid: false,
      error: "NWC_URL missing relay. Paste the complete connection secret from Alby Hub.",
    };
  }

  for (const relay of relays) {
    if (!relay.startsWith("wss://")) {
      return { valid: false, error: `Invalid relay URL: ${relay}` };
    }
  }

  return { valid: true, cleaned };
}

function getNwcUrl() {
  const parsed = parseNwcUrl(NWC_URL);
  return parsed.valid ? parsed.cleaned : null;
}

function hasCredentials() {
  const nwcOk = Boolean(getNwcUrl());
  const token = getAlbyToken();
  return nwcOk || Boolean(token);
}

function getAlbyToken() {
  const token = normalizeToken(ALBY_TOKEN);
  if (!token || token === "your_token_here") return "";
  if (token.startsWith("nostr+walletconnect://")) return "";
  return token;
}

function requireCredentials(res) {
  if (!hasCredentials()) {
    const parsed = parseNwcUrl(NWC_URL || "");
    const token = normalizeToken(ALBY_TOKEN || "");
    let error = parsed.error || "Add NWC_URL or ALBY_API_TOKEN in Railway Variables.";

    if (token.startsWith("nostr+walletconnect://")) {
      error =
        "ALBY_API_TOKEN mein NWC string mat dalo. Woh NWC_URL mein jati hai. ALBY_API_TOKEN ke liye getalby.com/developer se access token lo.";
    }

    res.status(500).json({ error });
    return false;
  }
  return true;
}

function createNwcClient() {
  const url = getNwcUrl();
  if (!url) {
    throw new Error(parseNwcUrl(NWC_URL || "").error || "Invalid NWC_URL");
  }
  return new NWCClient({ nostrWalletConnectUrl: url });
}

async function albyFetch(endpoint, options = {}) {
  const token = getAlbyToken();
  if (!token) {
    throw new Error(
      "Invalid ALBY_API_TOKEN. Use access token from getalby.com/developer  not NWC string."
    );
  }

  const response = await fetch(`https://api.getalby.com${endpoint}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
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

app.get("/api/health", async (_req, res) => {
  const nwc = parseNwcUrl(NWC_URL || "");
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

  res.json({
    ok: nwc.valid || tokenOk,
    nwc: nwc.valid,
    nwcError: nwc.valid ? null : nwc.error,
    token: tokenOk,
    tokenError,
  });
});

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
    if (getNwcUrl()) {
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
  const nwc = parseNwcUrl(NWC_URL || "");
  if (nwc.valid) {
    console.log("? NWC_URL configured");
  } else if (NWC_URL) {
    console.log("? NWC_URL error:", nwc.error);
  } else {
    console.log("? Add NWC_URL to environment variables");
  }
});
