const { NWCClient } = require("@getalby/sdk/nwc");
const { NWC_URL, ALBY_TOKEN } = require("../config");

const NWC_TIMEOUT_MS = 20000;

function normalizeToken(value) {
  if (!value) return "";
  return value.trim().replace(/^["']|["']$/g, "");
}

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

function getAlbyToken() {
  const token = normalizeToken(ALBY_TOKEN);
  if (!token || token === "your_token_here") return "";
  if (token.startsWith("nostr+walletconnect://")) return "";
  return token;
}

function getAlbyTokenDiagnostics() {
  const raw = normalizeToken(
    process.env.ALBY_API_TOKEN || process.env.ALBY_TOKEN || ""
  );
  const token = getAlbyToken();
  if (!raw) {
    return { configured: false, valid: false, issue: "ALBY_API_TOKEN not set on server" };
  }
  if (raw.startsWith("nostr+walletconnect://")) {
    return {
      configured: true,
      valid: false,
      issue: "NWC string is in ALBY_API_TOKEN — use getalby.com/developer access token instead",
    };
  }
  if (raw === "your_token_here" || raw.includes("paste_here")) {
    return { configured: true, valid: false, issue: "Placeholder token — paste real access token" };
  }
  if (!token) {
    return { configured: true, valid: false, issue: "Token empty or invalid after parsing" };
  }
  return { configured: true, valid: true, issue: null };
}

function getPaymentProvider() {
  if (getAlbyToken()) return "alby";
  if (getNwcUrl()) return "nwc";
  return null;
}

function hasCredentials() {
  return Boolean(getPaymentProvider());
}

function requireCredentials(res) {
  if (!hasCredentials()) {
    const parsed = parseNwcUrl(NWC_URL || "");
    const token = normalizeToken(ALBY_TOKEN || "");
    let error = parsed.error || "Add ALBY_API_TOKEN or NWC_URL in Railway Variables.";

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

function withTimeout(promise, ms, message) {
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      setTimeout(() => reject(new Error(message)), ms);
    }),
  ]);
}

async function albyFetch(endpoint, options = {}) {
  const token = getAlbyToken();
  if (!token) {
    throw new Error(
      "Invalid ALBY_API_TOKEN. Use access token from getalby.com/developer — not NWC string."
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

async function createInvoicePayment({ sats, description, expirySec }) {
  const provider = getPaymentProvider();
  if (!provider) {
    throw new Error("Payment provider not configured");
  }

  if (provider === "alby") {
    const invoice = await albyFetch("/invoices", {
      method: "POST",
      body: JSON.stringify({ amount: sats, memo: description }),
    });
    if (!invoice.payment_request || !invoice.payment_hash) {
      throw new Error("Could not create Lightning invoice");
    }
    return {
      paymentRequest: invoice.payment_request,
      paymentHash: invoice.payment_hash,
      provider: "alby",
    };
  }

  const client = createNwcClient();
  try {
    const result = await withTimeout(
      client.makeInvoice({
        amount: sats * 1000,
        description,
        expiry: expirySec,
      }),
      NWC_TIMEOUT_MS,
      "Lightning wallet is not responding. Keep Alby Hub open and unlocked on your computer, or set ALBY_API_TOKEN on the server for 24/7 payments."
    );
    const paymentRequest = result.invoice?.bolt11 || result.invoice;
    const paymentHash = result.invoice?.payment_hash || result.payment_hash;
    if (!paymentRequest || !paymentHash) {
      throw new Error("Could not create Lightning invoice");
    }
    return { paymentRequest, paymentHash, provider: "nwc" };
  } finally {
    client.close();
  }
}

async function lookupViaAlby(paymentHash) {
  const invoice = await albyFetch(`/invoices/${paymentHash}`);
  return {
    settled: Boolean(invoice.settled_at),
    amount: invoice.amount,
    settledAt: invoice.settled_at || null,
    provider: "alby",
  };
}

async function lookupViaNwc(paymentHash) {
  const client = createNwcClient();
  try {
    const result = await withTimeout(
      client.lookupInvoice({ payment_hash: paymentHash }),
      NWC_TIMEOUT_MS,
      "Lightning wallet is not responding"
    );
    const settled = result.invoice?.settled ?? result.settled ?? false;
    return {
      settled: Boolean(settled),
      amount: result.invoice?.amount ?? result.amount,
      settledAt: null,
      provider: "nwc",
    };
  } finally {
    client.close();
  }
}

async function lookupInvoiceSettled(paymentHash, providerHint) {
  const preferred = providerHint || getPaymentProvider();

  if (preferred === "alby" && getAlbyToken()) {
    try {
      return await lookupViaAlby(paymentHash);
    } catch (err) {
      if (!getNwcUrl()) throw err;
    }
  }

  if (getNwcUrl()) {
    return lookupViaNwc(paymentHash);
  }

  if (getAlbyToken()) {
    return lookupViaAlby(paymentHash);
  }

  throw new Error("Payment provider not configured");
}

async function testPaymentProvider() {
  const provider = getPaymentProvider();
  if (!provider) {
    return { ok: false, provider: null, error: "No payment credentials configured" };
  }

  if (provider === "alby") {
    try {
      const response = await fetch("https://api.getalby.com/balance", {
        headers: { Authorization: `Bearer ${getAlbyToken()}` },
      });
      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        return {
          ok: false,
          provider: "alby",
          error: data.error || data.message || "Invalid Alby access token",
        };
      }
      return { ok: true, provider: "alby", error: null };
    } catch (err) {
      return { ok: false, provider: "alby", error: err.message };
    }
  }

  const client = createNwcClient();
  try {
    await withTimeout(
      client.getInfo(),
      NWC_TIMEOUT_MS,
      "Alby Hub / NWC wallet not reachable"
    );
    return { ok: true, provider: "nwc", error: null };
  } catch (err) {
    return { ok: false, provider: "nwc", error: err.message };
  } finally {
    client.close();
  }
}

module.exports = {
  parseNwcUrl,
  getNwcUrl,
  getAlbyToken,
  getPaymentProvider,
  hasCredentials,
  requireCredentials,
  createNwcClient,
  albyFetch,
  createInvoicePayment,
  lookupInvoiceSettled,
  testPaymentProvider,
  getAlbyTokenDiagnostics,
};
