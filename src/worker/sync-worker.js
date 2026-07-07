const db = require("../../db");
const { SYNC_INTERVAL_MS } = require("../config");
const { syncAllPendingPayments, getSyncStatus } = require("../services/payment-sync");

let timer = null;

function startSyncWorker() {
  if (timer) return;

  const run = async () => {
    try {
      const result = await syncAllPendingPayments();
      if (result.updated > 0) {
        console.log(`✓ Payment sync: ${result.updated} updated of ${result.synced} pending`);
      }
    } catch (err) {
      console.warn("Payment sync worker error:", err.message);
    }
  };

  run();
  timer = setInterval(run, SYNC_INTERVAL_MS);
  console.log(`✓ Background payment sync every ${SYNC_INTERVAL_MS / 1000}s`);
}

function stopSyncWorker() {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}

module.exports = { startSyncWorker, stopSyncWorker, getSyncStatus };
