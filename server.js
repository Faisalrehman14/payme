require("dotenv").config();
require("websocket-polyfill");

const { webcrypto } = require("crypto");
if (!globalThis.crypto) {
  globalThis.crypto = webcrypto;
}

const db = require("./db");
const { createApp } = require("./src/app");
const { PORT, IS_PRODUCTION } = require("./src/config");
const { parseNwcUrl, hasCredentials, getPlatformWalletBalance } = require("./src/services/nwc");
const { startSyncWorker, stopSyncWorker } = require("./src/worker/sync-worker");
const { syncAllLedgers } = require("./src/services/ledger-sync");
const { assertStartupConfigOrExit } = require("./src/services/bootstrap");

async function start() {
  const boot = assertStartupConfigOrExit();

  try {
    await db.init();
    await db.seedAdmin(boot.adminUser, boot.adminPass);

    try {
      const ledger = await syncAllLedgers();
      console.log(`? Ledger synced for ${ledger.offices} office(s)`);
    } catch (err) {
      console.warn("Ledger sync warning:", err.message);
    }
  } catch (err) {
    console.error("Database startup failed:", err.message);
    process.exit(1);
  }

  const app = createApp();
  const server = app.listen(PORT, async () => {
    console.log(`? Globa Pay listening on :${PORT}`);
    console.log(`  Mode: ${IS_PRODUCTION ? "production" : "development"}`);
    console.log(`  Admin: /admin`);
    console.log(`  Office: /dashboard`);

    if (process.env.PUBLIC_BASE_URL) {
      console.log(`  Public URL: ${process.env.PUBLIC_BASE_URL}`);
    }
    if (process.env.DATABASE_URL) {
      console.log("? PostgreSQL configured");
    }
    if (hasCredentials()) {
      console.log("? Payment provider configured");
      try {
        const wallet = await getPlatformWalletBalance();
        if (wallet.ok && wallet.balanceSats != null) {
          console.log(`? Wallet liquidity: ${wallet.balanceSats.toLocaleString()} sats`);
        }
      } catch {
        // non-fatal at boot
      }
    }

    const nwc = parseNwcUrl(process.env.NWC_URL || "");
    if (process.env.NWC_URL && !nwc.valid) {
      console.warn("? NWC_URL:", nwc.error);
    }
  });

  startSyncWorker();

  function shutdown(signal) {
    console.log(`${signal} received — shutting down…`);
    stopSyncWorker();
    server.close(() => {
      console.log("HTTP server closed");
      process.exit(0);
    });
    setTimeout(() => process.exit(1), 10_000).unref();
  }

  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));
}

start().catch((err) => {
  console.error("Fatal startup error:", err);
  process.exit(1);
});
