/**
 * Office money ledger helpers.
 * Available = payment_credits − platform_fee%(credits) − payout_holds − payout_debits
 */

function roundUsd(n) {
  return Math.round((Number(n) || 0) * 100) / 100;
}

function clampCommission(pct) {
  const n = Number(pct);
  if (!Number.isFinite(n)) return 0;
  return Math.min(100, Math.max(0, n));
}

function computeBalanceFromLedger(entries, commissionPercent) {
  let totalEarnedUsd = 0;
  let pendingUsd = 0;
  let totalWithdrawnUsd = 0;

  for (const entry of entries || []) {
    const amount = roundUsd(entry.amountUsd);
    if (entry.entryType === "payment_credit") totalEarnedUsd += amount;
    else if (entry.entryType === "payout_hold") pendingUsd += amount;
    else if (entry.entryType === "payout_debit") totalWithdrawnUsd += amount;
  }

  totalEarnedUsd = roundUsd(totalEarnedUsd);
  pendingUsd = roundUsd(pendingUsd);
  totalWithdrawnUsd = roundUsd(totalWithdrawnUsd);

  const pct = clampCommission(commissionPercent);
  const platformFeeUsd = roundUsd((totalEarnedUsd * pct) / 100);
  const netEarnedUsd = roundUsd(totalEarnedUsd - platformFeeUsd);
  const availableUsd = Math.max(0, roundUsd(netEarnedUsd - totalWithdrawnUsd - pendingUsd));

  return {
    totalEarnedUsd,
    commissionPercent: pct,
    platformFeeUsd,
    netEarnedUsd,
    totalWithdrawnUsd,
    pendingUsd,
    availableUsd,
    ledgerEntryCount: (entries || []).length,
    source: "ledger",
  };
}

function idempotencyKey(entryType, refId) {
  return `${entryType}:${refId}`;
}

module.exports = {
  roundUsd,
  clampCommission,
  computeBalanceFromLedger,
  idempotencyKey,
};
