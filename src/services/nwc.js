const { NWCClient } = require("@getalby/sdk/nwc");
const { decodeInvoice } = require("@getalby/lightning-tools");
const { NWC_URL, ALBY_TOKEN, ALBY_LIGHTNING_ADDRESS } = require("../config");

const NWC_TIMEOUT_MS = 20000;
let cachedLightningAddress = ALBY_LIGHTNING_ADDRESS || null;

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
  return Boolean(
    getPaymentProvider() ||
      isValidLightningAddress(ALBY_LIGHTNING_ADDRESS) ||
      isValidLightningAddress(cachedLightningAddress)
  );
}

function requireCredentials(res) {
  if (!hasCredentials()) {
    const parsed = parseNwcUrl(NWC_URL || "");
    const token = normalizeToken(ALBY_TOKEN || "");
    let error =
      parsed.error ||
      "Add ALBY_LIGHTNING_ADDRESS (you@getalby.com) or ALBY_API_TOKEN in Railway Variables.";

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

function isValidLightningAddress(value) {
  return Boolean(value && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(value));
}

async function resolveLightningAddress() {
  if (isValidLightningAddress(cachedLightningAddress)) {
    return cachedLightningAddress;
  }

  if (ALBY_LIGHTNING_ADDRESS && isValidLightningAddress(ALBY_LIGHTNING_ADDRESS)) {
    cachedLightningAddress = ALBY_LIGHTNING_ADDRESS;
    return cachedLightningAddress;
  }

  if (!getAlbyToken()) return null;

  try {
    const me = await albyFetch("/user/me");
    const address = (me.lightning_address || "").trim().toLowerCase();
    if (isValidLightningAddress(address)) {
      cachedLightningAddress = address;
      return cachedLightningAddress;
    }
  } catch {
    // account:read may not be on the token — continue without LN address
  }

  return null;
}

/**
 * Create invoice via LNURL / Lightning Address — same path Cash App wallets expect.
 * Matches btc-cash.store: /.well-known/lnurlp/{user} → callback?amount=msats
 */
async function createInvoiceViaLnurl({ sats, description }) {
  const address = await resolveLightningAddress();
  if (!address) {
    throw new Error("Lightning address not configured");
  }

  const [user, domain] = address.split("@");
  const msats = Math.max(1, Math.round(Number(sats) * 1000));

  const lnurlpRes = await fetch(`https://${domain}/.well-known/lnurlp/${encodeURIComponent(user)}`);
  const lnurlp = await lnurlpRes.json().catch(() => ({}));
  if (!lnurlpRes.ok || !lnurlp.callback) {
    throw new Error(lnurlp.reason || lnurlp.status || "Could not load Lightning Address");
  }

  if (typeof lnurlp.minSendable === "number" && msats < lnurlp.minSendable) {
    throw new Error("Amount too small for this Lightning Address");
  }
  if (typeof lnurlp.maxSendable === "number" && msats > lnurlp.maxSendable) {
    throw new Error("Amount too large for this Lightning Address");
  }

  const callbackUrl = new URL(lnurlp.callback);
  callbackUrl.searchParams.set("amount", String(msats));
  if (description && Number(lnurlp.commentAllowed) > 0) {
    callbackUrl.searchParams.set(
      "comment",
      String(description).slice(0, Number(lnurlp.commentAllowed))
    );
  }

  const invoiceRes = await fetch(callbackUrl.toString());
  const invoiceData = await invoiceRes.json().catch(() => ({}));
  if (!invoiceRes.ok || !invoiceData.pr) {
    throw new Error(
      invoiceData.reason || invoiceData.status || "Could not create Lightning invoice via LNURL"
    );
  }

  const paymentRequest = invoiceData.pr;
  let paymentHash =
    invoiceData.payment_hash ||
    invoiceData.paymentHash ||
    null;

  if (!paymentHash) {
    try {
      const decoded = decodeInvoice(paymentRequest);
      paymentHash = decoded?.paymentHash || null;
    } catch {
      paymentHash = null;
    }
  }

  if (!paymentHash) {
    throw new Error("Could not read payment hash from Lightning invoice");
  }

  return {
    paymentRequest,
    paymentHash,
    provider: "lnurl",
    lightningAddress: address,
  };
}

async function createInvoiceViaAlbyApi({ sats, description }) {
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

async function createInvoiceViaNwc({ sats, description, expirySec }) {
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

async function createInvoicePayment({ sats, description, expirySec }) {
  // Prefer LNURL (Lightning Address) — Cash App can route these reliably,
  // same approach as btc-cash.store.
  const address = await resolveLightningAddress();
  if (address) {
    try {
      return await createInvoiceViaLnurl({ sats, description });
    } catch (err) {
      console.warn("LNURL invoice failed, falling back:", err.message);
    }
  }

  const provider = getPaymentProvider();
  if (!provider) {
    throw new Error(
      "Payment provider not configured. Set ALBY_LIGHTNING_ADDRESS (you@getalby.com) or ALBY_API_TOKEN."
    );
  }

  if (provider === "alby") {
    return createInvoiceViaAlbyApi({ sats, description });
  }

  return createInvoiceViaNwc({ sats, description, expirySec });
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

/**
 * Pay a BOLT11 invoice from the platform wallet (Alby API preferred, NWC fallback).
 * Used for office payouts / withdrawals.
 */
async function payBolt11Invoice(invoice) {
  const bolt11 = String(invoice || "")
    .replace(/^lightning:/i, "")
    .trim();
  if (!bolt11) {
    throw new Error("Lightning invoice is required");
  }

  if (getAlbyToken()) {
    try {
      const result = await albyFetch("/payments/bolt11", {
        method: "POST",
        body: JSON.stringify({ invoice: bolt11 }),
      });
      return {
        paymentHash:
          result.payment_hash ||
          result.paymentHash ||
          null,
        preimage: result.payment_preimage || result.preimage || null,
        amountSats: result.amount != null ? Number(result.amount) : null,
        feeSats: result.fee != null ? Number(result.fee) : null,
        provider: "alby",
      };
    } catch (err) {
      if (!getNwcUrl()) throw err;
      console.warn("Alby pay invoice failed, falling back to NWC:", err.message);
    }
  }

  if (!getNwcUrl()) {
    throw new Error(
      "Payout provider not configured. Set ALBY_API_TOKEN (preferred) or NWC_URL so the platform can send Lightning payments."
    );
  }

  const client = createNwcClient();
  try {
    // Preflight the NWC connection budget so we fail fast with the real number,
    // instead of Alby Hub's generic "not enough budget" rejection.
    let budgetError = null;
    try {
      const budget = await withTimeout(
        client.getBudget(),
        10_000,
        "budget check timed out"
      );
      if (budget && budget.total_budget != null) {
        const remainingSats = Math.max(
          0,
          Math.floor(
            (Number(budget.total_budget) - Number(budget.used_budget || 0)) / 1000
          )
        );
        let needSats = 0;
        try {
          needSats = Math.round(Number(decodeInvoice(bolt11)?.satoshi || 0));
        } catch {
          needSats = 0;
        }
        if (needSats > 0 && needSats > remainingSats) {
          const renews = budget.renews_at
            ? ` Budget renews ${new Date(Number(budget.renews_at) * 1000).toLocaleString()}.`
            : "";
          budgetError = new Error(
            `Alby Hub connection budget too low: ${remainingSats.toLocaleString()} sats remaining but this payout needs ${needSats.toLocaleString()} sats.${renews} Fix: open Alby Hub → Connections → select this app → increase the budget or set it to Unlimited.`
          );
        }
      }
    } catch {
      // Wallet may not support get_budget — let payInvoice decide.
    }
    if (budgetError) throw budgetError;

    const result = await withTimeout(
      client.payInvoice({ invoice: bolt11 }),
      NWC_TIMEOUT_MS,
      "Lightning wallet is not responding. Keep Alby Hub open, or set ALBY_API_TOKEN for cloud payouts."
    );
    return {
      paymentHash: result.payment_hash || result.paymentHash || null,
      preimage: result.preimage || null,
      amountSats:
        result.amount != null
          ? Math.round(Number(result.amount) / 1000)
          : null,
      feeSats:
        result.fees_paid != null
          ? Math.round(Number(result.fees_paid) / 1000)
          : null,
      provider: "nwc",
    };
  } catch (err) {
    const msg = err?.message || "";
    if (/budget/i.test(msg) && !msg.includes("Alby Hub connection budget too low")) {
      throw new Error(
        `Alby Hub NWC connection budget exceeded — the wallet blocked this payout. Fix: open Alby Hub → Connections → select this app → increase the budget or set it to Unlimited, then retry. (${msg})`
      );
    }
    throw err;
  } finally {
    client.close();
  }
}

/**
 * Platform hot-wallet balance (liquidity). This is NOT office ledger balance.
 */
async function getPlatformWalletBalance() {
  if (getAlbyToken()) {
    try {
      const data = await albyFetch("/balance");
      const balanceSats = Number(
        data.balance ?? data.balance_sats ?? data.total_balance ?? data.amount ?? 0
      );
      return {
        ok: true,
        provider: "alby",
        balanceSats: Number.isFinite(balanceSats) ? Math.round(balanceSats) : null,
        currency: data.currency || "BTC",
        error: null,
      };
    } catch (err) {
      if (!getNwcUrl()) {
        return { ok: false, provider: "alby", balanceSats: null, error: err.message };
      }
    }
  }

  if (getNwcUrl()) {
    const client = createNwcClient();
    try {
      const result = await withTimeout(
        client.getBalance(),
        NWC_TIMEOUT_MS,
        "Wallet balance check timed out"
      );
      const msats = Number(result.balance ?? result.balance_msat ?? 0);
      return {
        ok: true,
        provider: "nwc",
        balanceSats: Number.isFinite(msats) ? Math.round(msats / 1000) : null,
        currency: "BTC",
        error: null,
      };
    } catch (err) {
      return { ok: false, provider: "nwc", balanceSats: null, error: err.message };
    } finally {
      client.close();
    }
  }

  return {
    ok: false,
    provider: null,
    balanceSats: null,
    error: "No wallet provider configured",
  };
}

async function lookupInvoiceSettled(paymentHash, providerHint) {
  // LNURL invoices still settle on Alby — check Alby API first when token exists
  if (providerHint === "lnurl" && getAlbyToken()) {
    try {
      return await lookupViaAlby(paymentHash);
    } catch (err) {
      if (!getNwcUrl()) throw err;
    }
  }

  const preferred = providerHint || getPaymentProvider();

  if ((preferred === "alby" || preferred === "lnurl") && getAlbyToken()) {
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
  const address = await resolveLightningAddress();
  if (address) {
    try {
      const [user, domain] = address.split("@");
      const res = await fetch(
        `https://${domain}/.well-known/lnurlp/${encodeURIComponent(user)}`
      );
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.callback) {
        return {
          ok: true,
          provider: "lnurl",
          lightningAddress: address,
          error: null,
        };
      }
      return {
        ok: false,
        provider: "lnurl",
        lightningAddress: address,
        error: data.reason || "Lightning Address LNURL lookup failed",
      };
    } catch (err) {
      return {
        ok: false,
        provider: "lnurl",
        lightningAddress: address,
        error: err.message,
      };
    }
  }

  const provider = getPaymentProvider();
  if (!provider) {
    return {
      ok: false,
      provider: null,
      error:
        "Set ALBY_LIGHTNING_ADDRESS (you@getalby.com) or ALBY_API_TOKEN for Cash App payments",
    };
  }

  if (provider === "alby") {
    try {
      const response = await fetch("https://api.getalby.com/invoices?limit=1", {
        headers: { Authorization: `Bearer ${getAlbyToken()}` },
      });
      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        const message = data.error || data.message || "Invalid Alby access token";
        return { ok: false, provider: "alby", error: message };
      }
      return {
        ok: true,
        provider: "alby",
        lightningAddress: null,
        error: null,
        warning:
          "Using Alby API invoices — set ALBY_LIGHTNING_ADDRESS for better Cash App compatibility",
      };
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
    return { ok: true, provider: "nwc", lightningAddress: null, error: null };
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
  payBolt11Invoice,
  getPlatformWalletBalance,
  lookupInvoiceSettled,
  testPaymentProvider,
  getAlbyTokenDiagnostics,
  resolveLightningAddress,
};
