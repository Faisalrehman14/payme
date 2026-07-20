const db = require("../../db");
const {
  computeBalanceFromLedger,
  idempotencyKey,
  roundUsd,
} = require("./ledger");

/**
 * Backfill ledger from payments/payouts so balance is ledger-sourced.
 * Safe to run repeatedly (idempotent keys).
 */
async function syncOfficeLedger(officeId) {
  const payments = await db.listPaymentsForOffice(officeId, 10000);
  for (const payment of payments) {
    if (payment.status !== "paid") continue;
    await db.upsertLedgerEntry({
      officeId,
      entryType: "payment_credit",
      amountUsd: payment.amountUsd,
      amountSats: payment.amountSats,
      refType: "payment",
      refId: payment.id,
      idempotencyKey: idempotencyKey("payment_credit", payment.id),
      metadata: { paymentHash: payment.paymentHash },
    });
  }

  const payouts = await db.listPayoutsForOffice(officeId, 10000);
  for (const payout of payouts) {
    if (payout.status === "pending") {
      await db.upsertLedgerEntry({
        officeId,
        entryType: "payout_hold",
        amountUsd: payout.amountUsd,
        amountSats: payout.amountSats,
        refType: "payout",
        refId: payout.id,
        idempotencyKey: idempotencyKey("payout_hold", payout.id),
      });
      await db.deleteLedgerEntryByKey(idempotencyKey("payout_debit", payout.id));
    } else if (payout.status === "paid") {
      await db.deleteLedgerEntryByKey(idempotencyKey("payout_hold", payout.id));
      await db.upsertLedgerEntry({
        officeId,
        entryType: "payout_debit",
        amountUsd: payout.amountUsd,
        amountSats: payout.amountSats,
        refType: "payout",
        refId: payout.id,
        idempotencyKey: idempotencyKey("payout_debit", payout.id),
      });
    } else if (payout.status === "failed") {
      await db.deleteLedgerEntryByKey(idempotencyKey("payout_hold", payout.id));
      await db.deleteLedgerEntryByKey(idempotencyKey("payout_debit", payout.id));
    }
  }
}

async function syncAllLedgers() {
  const offices = await db.listOffices();
  for (const office of offices) {
    await syncOfficeLedger(office.id);
  }
  return { offices: offices.length };
}

async function recordPaymentCredit(payment) {
  if (!payment?.id || !payment.officeId || payment.status !== "paid") return null;
  return db.upsertLedgerEntry({
    officeId: payment.officeId,
    entryType: "payment_credit",
    amountUsd: roundUsd(payment.amountUsd),
    amountSats: payment.amountSats,
    refType: "payment",
    refId: payment.id,
    idempotencyKey: idempotencyKey("payment_credit", payment.id),
    metadata: { paymentHash: payment.paymentHash },
  });
}

async function getLedgerBalance(officeId) {
  await syncOfficeLedger(officeId);
  const office = await db.getOfficeById(officeId);
  if (!office) throw new Error("Office not found");
  const entries = await db.listLedgerEntriesForOffice(officeId);
  return computeBalanceFromLedger(entries, office.commissionPercent || 0);
}

module.exports = {
  syncOfficeLedger,
  syncAllLedgers,
  recordPaymentCredit,
  getLedgerBalance,
};
