const assert = require("assert");
const { computeBalanceFromLedger, roundUsd, idempotencyKey } = require("../src/services/ledger");

function test(name, fn) {
  try {
    fn();
    console.log(`✓ ${name}`);
  } catch (err) {
    console.error(`✗ ${name}`);
    throw err;
  }
}

test("15% fee on $100 leaves $85 available", () => {
  const balance = computeBalanceFromLedger(
    [{ entryType: "payment_credit", amountUsd: 100 }],
    15
  );
  assert.strictEqual(balance.platformFeeUsd, 15);
  assert.strictEqual(balance.netEarnedUsd, 85);
  assert.strictEqual(balance.availableUsd, 85);
});

test("payout hold and debit reduce available", () => {
  const balance = computeBalanceFromLedger(
    [
      { entryType: "payment_credit", amountUsd: 100 },
      { entryType: "payout_hold", amountUsd: 20 },
      { entryType: "payout_debit", amountUsd: 10 },
    ],
    15
  );
  // net 85 - 20 hold - 10 debit = 55
  assert.strictEqual(balance.availableUsd, 55);
  assert.strictEqual(balance.pendingUsd, 20);
  assert.strictEqual(balance.totalWithdrawnUsd, 10);
});

test("cannot go negative available", () => {
  const balance = computeBalanceFromLedger(
    [
      { entryType: "payment_credit", amountUsd: 10 },
      { entryType: "payout_debit", amountUsd: 50 },
    ],
    0
  );
  assert.strictEqual(balance.availableUsd, 0);
});

test("roundUsd cents", () => {
  assert.strictEqual(roundUsd(10.005), 10.01);
  assert.strictEqual(roundUsd(10.004), 10);
});

test("idempotency key format", () => {
  assert.strictEqual(idempotencyKey("payment_credit", "abc"), "payment_credit:abc");
});

console.log("All ledger tests passed");
