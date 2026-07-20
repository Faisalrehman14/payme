const { decodeInvoice } = require("@getalby/lightning-tools");
const db = require("../../db");
const { payBolt11Invoice, hasCredentials, getPlatformWalletBalance } = require("./nwc");
const { getLedgerBalance } = require("./ledger-sync");

const MIN_PAYOUT_USD = 1;
const STALE_PENDING_MS = 10 * 60 * 1000;
const MAX_INVOICE_LENGTH = 4000;

function normalizeBolt11(invoice) {
  return String(invoice || "")
    .replace(/^lightning:/i, "")
    .trim();
}

function roundUsd(n) {
  return Math.round((Number(n) || 0) * 100) / 100;
}

async function fetchBtcPriceUsd() {
  const priceRes = await fetch("https://mempool.space/api/v1/prices");
  const priceData = await priceRes.json();
  const btcPrice = Number(priceData.USD || priceData.usd);
  if (!btcPrice || !Number.isFinite(btcPrice) || btcPrice <= 0) {
    throw new Error("Could not fetch BTC price");
  }
  return btcPrice;
}

function satsToUsd(sats, btcPrice) {
  return roundUsd((Number(sats) / 100_000_000) * btcPrice);
}

function availableSatsFromBalance(availableUsd, btcPrice) {
  return Math.floor((availableUsd / btcPrice) * 100_000_000);
}

function isInvoiceExpired(decoded) {
  if (!decoded?.timestamp || decoded.expiry == null) return false;
  const expiresAtMs = (Number(decoded.timestamp) + Number(decoded.expiry)) * 1000;
  return Date.now() >= expiresAtMs - 30_000;
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
  return getLedgerBalance(officeId);
}

async function listOfficePayouts(officeId, limit = 100) {
  await db.failStalePendingPayouts(officeId, STALE_PENDING_MS);
  return db.listPayoutsForOffice(officeId, limit);
}

/**
 * Office requests withdrawal by pasting a Lightning invoice.
 * Amount comes from the invoice; reserved on ledger, then paid from platform wallet.
 */
async function requestOfficePayout({ officeId, userId, invoice }) {
  if (!hasCredentials()) {
    throw new Error(
      "Payout system is temporarily offline. Ask admin to configure ALBY_API_TOKEN or NWC_URL."
    );
  }

  await ensurePayoutsEnabled(officeId);

  const bolt11 = normalizeBolt11(invoice);
  if (!bolt11 || bolt11.length > MAX_INVOICE_LENGTH) {
    throw new Error("Paste a valid Lightning invoice");
  }
  if (!/^ln[a-z0-9]+$/i.test(bolt11)) {
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

  const btcPrice = await fetchBtcPriceUsd();
  const amountSats = Math.round(Number(decoded.satoshi));
  const amountUsd = satsToUsd(amountSats, btcPrice);

  if (amountUsd < MIN_PAYOUT_USD) {
    throw new Error(`Minimum payout is $${MIN_PAYOUT_USD.toFixed(2)}`);
  }

  const preview = await getPayoutBalance(officeId);
  const maxSats = availableSatsFromBalance(preview.availableUsd, btcPrice);
  if (amountSats > maxSats || amountUsd > preview.availableUsd + 0.009) {
    throw new Error(
      `Insufficient balance. Available: $${preview.availableUsd.toFixed(2)} (max ~${maxSats.toLocaleString()} sats). Invoice is for $${amountUsd.toFixed(2)}.`
    );
  }

  // Platform wallet liquidity ≠ office ledger balance
  const wallet = await getPlatformWalletBalance();
  if (wallet.ok && wallet.balanceSats != null && amountSats > wallet.balanceSats) {
    throw new Error(
      `Platform wallet liquidity too low for this payout (${wallet.balanceSats.toLocaleString()} sats available). Try a smaller amount or contact admin.`
    );
  }

  const { payout } = await db.createPayoutIfSufficient(
    {
      officeId,
      userId,
      paymentHash: decoded.paymentHash,
      invoice: bolt11,
      amountUsd,
      amountSats,
      btcPrice,
    },
    { stalePendingMs: STALE_PENDING_MS }
  );

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
      balance: await getLedgerBalance(officeId),
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
