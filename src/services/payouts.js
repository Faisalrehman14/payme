const { decodeInvoice } = require("@getalby/lightning-tools");
const db = require("../../db");
const { payBolt11Invoice, hasCredentials } = require("./nwc");

const MIN_PAYOUT_USD = 1;
const STALE_PENDING_MS = 10 * 60 * 1000;

function normalizeBolt11(invoice) {
  return String(invoice || "")
    .replace(/^lightning:/i, "")
    .trim();
}

async function fetchBtcPriceUsd() {
  const priceRes = await fetch("https://mempool.space/api/v1/prices");
  const priceData = await priceRes.json();
  const btcPrice = Number(priceData.USD || priceData.usd);
  if (!btcPrice || !Number.isFinite(btcPrice)) {
    throw new Error("Could not fetch BTC price");
  }
  return btcPrice;
}

function satsToUsd(sats, btcPrice) {
  return Math.round(((Number(sats) / 100_000_000) * btcPrice) * 100) / 100;
}

function isInvoiceExpired(decoded) {
  if (!decoded?.timestamp || decoded.expiry == null) return false;
  const expiresAtMs = (Number(decoded.timestamp) + Number(decoded.expiry)) * 1000;
  return Date.now() >= expiresAtMs;
}

async function ensurePayoutsEnabled(officeId) {
  const office = await db.getOfficeById(officeId);
  if (!office) throw new Error("Office not found");
  if (!office.payoutsEnabled) {
    throw new Error("Payouts are not enabled for this office. Contact admin.");
  }
  return office;
}

async function getPayoutBalance(officeId) {
  await db.failStalePendingPayouts(officeId, STALE_PENDING_MS);
  return db.getOfficePayoutBalance(officeId);
}

async function listOfficePayouts(officeId, limit = 100) {
  await db.failStalePendingPayouts(officeId, STALE_PENDING_MS);
  return db.listPayoutsForOffice(officeId, limit);
}

/**
 * Office requests withdrawal by pasting a Lightning invoice.
 * Amount is taken from the invoice; deducted from available office balance on success.
 */
async function requestOfficePayout({ officeId, userId, invoice }) {
  if (!hasCredentials()) {
    throw new Error(
      "Payout system is temporarily offline. Ask admin to configure ALBY_API_TOKEN or NWC_URL."
    );
  }

  await ensurePayoutsEnabled(officeId);

  const bolt11 = normalizeBolt11(invoice);
  if (!bolt11.toLowerCase().startsWith("ln")) {
    throw new Error("Paste a valid Lightning invoice (starts with lnbc…)");
  }

  const decoded = decodeInvoice(bolt11);
  if (!decoded?.paymentHash) {
    throw new Error("Could not read Lightning invoice");
  }
  if (!decoded.satoshi || decoded.satoshi <= 0) {
    throw new Error("Invoice must have a fixed amount — zero-amount invoices are not supported");
  }
  if (isInvoiceExpired(decoded)) {
    throw new Error("This Lightning invoice has expired — create a new one");
  }

  const existing = await db.getPayoutByPaymentHash(decoded.paymentHash);
  if (existing) {
    throw new Error("This invoice was already used for a payout");
  }

  const btcPrice = await fetchBtcPriceUsd();
  const amountSats = Math.round(Number(decoded.satoshi));
  const amountUsd = satsToUsd(amountSats, btcPrice);

  if (amountUsd < MIN_PAYOUT_USD) {
    throw new Error(`Minimum payout is $${MIN_PAYOUT_USD.toFixed(2)}`);
  }

  await db.failStalePendingPayouts(officeId, STALE_PENDING_MS);
  const balance = await db.getOfficePayoutBalance(officeId);
  if (amountUsd > balance.availableUsd + 0.009) {
    throw new Error(
      `Insufficient balance. Available: $${balance.availableUsd.toFixed(2)}, requested: $${amountUsd.toFixed(2)}`
    );
  }

  const payout = await db.createPayout({
    officeId,
    userId,
    paymentHash: decoded.paymentHash,
    invoice: bolt11,
    amountUsd,
    amountSats,
    btcPrice,
    status: "pending",
  });

  try {
    const paid = await payBolt11Invoice(bolt11);
    const updated = await db.updatePayout(payout.id, {
      status: "paid",
      settledAt: new Date().toISOString(),
      provider: paid.provider || null,
      preimage: paid.preimage || null,
      feeSats: paid.feeSats != null ? paid.feeSats : null,
      errorMessage: null,
    });
    return {
      payout: updated,
      balance: await db.getOfficePayoutBalance(officeId),
    };
  } catch (err) {
    await db.updatePayout(payout.id, {
      status: "failed",
      errorMessage: err.message || "Payout failed",
    });
    throw new Error(err.message || "Payout failed");
  }
}

module.exports = {
  MIN_PAYOUT_USD,
  getPayoutBalance,
  listOfficePayouts,
  requestOfficePayout,
  ensurePayoutsEnabled,
};
