const db = require("../../db");
const { hasCredentials, lookupInvoiceSettled } = require("./nwc");

let lastSyncAt = null;
let lastSyncCount = 0;
let syncRunning = false;

async function syncPaymentRecord(payment) {
  if (!payment || payment.status !== "pending") return payment;

  if (payment.expiresAt && Date.now() > Date.parse(payment.expiresAt)) {
    return db.updatePaymentByHash(payment.paymentHash, { status: "expired" });
  }

  if (!hasCredentials()) return payment;

  try {
    const result = await lookupInvoiceSettled(payment.paymentHash);
    const settledAt = result.settledAt || (result.settled ? new Date().toISOString() : null);
    if (result.settled) {
      return db.updatePaymentByHash(payment.paymentHash, {
        status: "paid",
        settledAt,
      });
    }
  } catch {
    // Alby Hub may be offline — keep pending
  }

  return payment;
}

async function syncOfficePayments(officeId) {
  const payments = await db.listPaymentsForOffice(officeId, 200);
  const pending = payments.filter((p) => p.status === "pending");
  await Promise.all(pending.map((p) => syncPaymentRecord(p)));
}

async function syncAllPendingPayments() {
  if (syncRunning) return { skipped: true };
  syncRunning = true;
  try {
    const pending = await db.listPendingPayments(150);
    let updated = 0;
    for (const payment of pending) {
      const before = payment.status;
      const after = await syncPaymentRecord(payment);
      if (after?.status !== before) updated += 1;
    }
    lastSyncAt = new Date().toISOString();
    lastSyncCount = pending.length;
    return { synced: pending.length, updated, at: lastSyncAt };
  } finally {
    syncRunning = false;
  }
}

function getSyncStatus() {
  return {
    lastSyncAt,
    lastSyncCount,
    running: syncRunning,
  };
}

module.exports = {
  syncPaymentRecord,
  syncOfficePayments,
  syncAllPendingPayments,
  getSyncStatus,
};
