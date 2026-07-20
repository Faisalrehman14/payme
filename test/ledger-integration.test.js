const path = require("path");
const fs = require("fs");
const os = require("os");
const assert = require("assert");

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "ledger-int-"));
process.env.DATA_DIR = tmp;

const db = require("../db-json");
const { syncOfficeLedger, getLedgerBalance } = require("../src/services/ledger-sync");

async function run() {
  await db.init();
  const office = await db.createOffice("Ledger Office", "ledger-office");
  await db.updateOfficeCommission(office.id, 15);
  await db.updateOfficePayoutsEnabled(office.id, true);

  const payment = await db.createPayment({
    officeId: office.id,
    paymentHash: "payhash1",
    amountUsd: 100,
    amountSats: 100000,
    btcPrice: 100000,
    status: "pending",
  });
  await db.updatePaymentByHash("payhash1", {
    status: "paid",
    settledAt: new Date().toISOString(),
  });

  await syncOfficeLedger(office.id);
  let bal = await getLedgerBalance(office.id);
  assert.strictEqual(bal.availableUsd, 85, "available should be 85 after 15% fee");
  assert.strictEqual(bal.source, "ledger");

  const { payout } = await db.createPayoutIfSufficient({
    officeId: office.id,
    paymentHash: "outhash1",
    invoice: "lnbc1test",
    amountUsd: 40,
    amountSats: 40000,
    btcPrice: 100000,
  });
  bal = await getLedgerBalance(office.id);
  assert.strictEqual(bal.availableUsd, 45, "hold should reserve 40");
  assert.strictEqual(bal.pendingUsd, 40);

  await db.updatePayout(payout.id, { status: "paid", settledAt: new Date().toISOString() });
  bal = await getLedgerBalance(office.id);
  assert.strictEqual(bal.availableUsd, 45);
  assert.strictEqual(bal.totalWithdrawnUsd, 40);
  assert.strictEqual(bal.pendingUsd, 0);

  try {
    await db.createPayoutIfSufficient({
      officeId: office.id,
      paymentHash: "outhash2",
      invoice: "lnbc1over",
      amountUsd: 45.01,
      amountSats: 45010,
      btcPrice: 100000,
    });
    throw new Error("should block over-withdraw");
  } catch (err) {
    assert.match(err.message, /Insufficient balance/);
  }

  console.log("✓ ledger integration tests passed");
  fs.rmSync(tmp, { recursive: true, force: true });
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
