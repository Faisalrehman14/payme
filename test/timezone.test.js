const assert = require("assert");
const {
  dateKeyInTz,
  businessDateKeyInTz,
  isSameDayInTz,
  isSameBusinessDayInTz,
  isSameMonthInTz,
  monthYearInTz,
} = require("../src/utils/timezone");

// 2026-07-20T20:11:00Z = 2026-07-21 01:11 AM in Asia/Karachi
const lateUtcOnJul20 = new Date("2026-07-20T20:11:00.000Z");
assert.strictEqual(dateKeyInTz(lateUtcOnJul20, "Asia/Karachi"), "2026-07-21");
assert.strictEqual(dateKeyInTz(lateUtcOnJul20, "UTC"), "2026-07-20");

const earlyKarachiMorning = new Date("2026-07-20T20:03:24.000Z"); // Jul 21 01:03 PKT
assert.ok(isSameDayInTz(earlyKarachiMorning, lateUtcOnJul20, "Asia/Karachi"));

// Previous PKT calendar day should not match "today" in Karachi
const previousPktAfternoon = new Date("2026-07-20T10:00:00.000Z"); // Jul 20 15:00 PKT
assert.ok(!isSameDayInTz(previousPktAfternoon, lateUtcOnJul20, "Asia/Karachi"));
assert.ok(isSameDayInTz(previousPktAfternoon, lateUtcOnJul20, "UTC"));

// Business day rolls at 04:00 — 1:11 AM still belongs to Jul 20
assert.strictEqual(businessDateKeyInTz(lateUtcOnJul20, "Asia/Karachi", 4), "2026-07-20");
assert.ok(isSameBusinessDayInTz(previousPktAfternoon, lateUtcOnJul20, "Asia/Karachi", 4));

// After 04:00, calendar day matches business day
const afterFourAm = new Date("2026-07-20T23:30:00.000Z"); // Jul 21 04:30 PKT
assert.strictEqual(businessDateKeyInTz(afterFourAm, "Asia/Karachi", 4), "2026-07-21");
assert.ok(!isSameBusinessDayInTz(previousPktAfternoon, afterFourAm, "Asia/Karachi", 4));

const { month, year } = monthYearInTz(lateUtcOnJul20, "Asia/Karachi");
assert.strictEqual(month, 7);
assert.strictEqual(year, 2026);
assert.ok(isSameMonthInTz(lateUtcOnJul20, new Date("2026-07-01T10:00:00+05:00"), "Asia/Karachi"));

console.log("timezone.test.js: ok");
