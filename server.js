require("dotenv").config();
require("websocket-polyfill");

const { webcrypto } = require("crypto");
if (!globalThis.crypto) {
  globalThis.crypto = webcrypto;
}

const db = require("./db");
const { createApp } = require("./src/app");
const { PORT } = require("./src/config");
const { parseNwcUrl } = require("./src/services/nwc");
const { startSyncWorker } = require("./src/worker/sync-worker");
const { syncAllLedgers } = require("./src/services/ledger-sync");

async function start() {
  try {
    await db.init();
    const adminUser = process.env.ADMIN_USERNAME || "admin";
    const adminPass = process.env.ADMIN_PASSWORD || "admin123";
    await db.seedAdmin(adminUser, adminPass);

    try {
      const ledger = await syncAllLedgers();
      console.log(`? Ledger synced for ${ledger.offices} office(s)`);
    } catch (err) {
      console.warn("Ledger sync warning:", err.message);
    }

    if (
      (process.env.NODE_ENV === "production" || process.env.RAILWAY_ENVIRONMENT) &&
      adminPass === "admin123"
    ) {
      console.warn("? SECURITY: Change ADMIN_PASSWORD from default in production!");
    }
  } catch (err) {
    console.error("Database startup failed:", err.message);
    process.exit(1);
  }

  const app = createApp();

  app.listen(PORT, () => {
    console.log(`Globa Pay running ? http://localhost:${PORT}`);
    console.log(`Admin portal ? http://localhost:${PORT}/admin`);
    console.log(`Office dashboard ? http://localhost:${PORT}/dashboard`);

    const nwc = parseNwcUrl(process.env.NWC_URL || "");
    if (nwc.valid) {
      console.log("? NWC_URL configured");
    } else if (process.env.NWC_URL) {
      console.log("? NWC_URL error:", nwc.error);
    } else {
      console.log("? Add NWC_URL to environment variables");
    }

    if (process.env.DATABASE_URL) {
      console.log("? DATABASE_URL configured (PostgreSQL)");
    } else {
      console.log("? Using JSON storage — add DATABASE_URL on Railway");
    }
  });

  startSyncWorker();
}

start();
