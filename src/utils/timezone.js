const DEFAULT_TIMEZONE = process.env.APP_TIMEZONE || "Asia/Karachi";
const BUSINESS_DAY_START_HOUR = Math.min(
  23,
  Math.max(0, Number(process.env.APP_DAY_START_HOUR ?? 4))
);

function zonedParts(date, timeZone = DEFAULT_TIMEZONE) {
  const d = date instanceof Date ? date : new Date(date);
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(d);

  const get = (type) => parts.find((p) => p.type === type)?.value;
  return {
    year: Number(get("year")),
    month: Number(get("month")),
    day: Number(get("day")),
    hour: Number(get("hour")),
    minute: Number(get("minute")),
    second: Number(get("second")),
  };
}

function pad2(n) {
  return String(n).padStart(2, "0");
}

function dateKeyInTz(date, timeZone = DEFAULT_TIMEZONE) {
  const p = zonedParts(date, timeZone);
  return `${p.year}-${pad2(p.month)}-${pad2(p.day)}`;
}

/**
 * Business day key for payment offices that run past midnight.
 * Default: day rolls at 04:00 local (Asia/Karachi), so 1 AM still counts
 * toward the previous operating day.
 */
function businessDateKeyInTz(
  date,
  timeZone = DEFAULT_TIMEZONE,
  dayStartHour = BUSINESS_DAY_START_HOUR
) {
  const p = zonedParts(date, timeZone);
  let utcMidnight = Date.UTC(p.year, p.month - 1, p.day);
  if (p.hour < dayStartHour) {
    utcMidnight -= 24 * 60 * 60 * 1000;
  }
  const shifted = new Date(utcMidnight);
  return `${shifted.getUTCFullYear()}-${pad2(shifted.getUTCMonth() + 1)}-${pad2(shifted.getUTCDate())}`;
}

function isSameDayInTz(date, compareTo = new Date(), timeZone = DEFAULT_TIMEZONE) {
  return dateKeyInTz(date, timeZone) === dateKeyInTz(compareTo, timeZone);
}

function isSameBusinessDayInTz(
  date,
  compareTo = new Date(),
  timeZone = DEFAULT_TIMEZONE,
  dayStartHour = BUSINESS_DAY_START_HOUR
) {
  return (
    businessDateKeyInTz(date, timeZone, dayStartHour) ===
    businessDateKeyInTz(compareTo, timeZone, dayStartHour)
  );
}

function isSameMonthInTz(date, compareTo = new Date(), timeZone = DEFAULT_TIMEZONE) {
  const a = zonedParts(date, timeZone);
  const b = zonedParts(compareTo, timeZone);
  return a.year === b.year && a.month === b.month;
}

function monthYearInTz(date, timeZone = DEFAULT_TIMEZONE) {
  const p = zonedParts(date, timeZone);
  return { month: p.month, year: p.year };
}

module.exports = {
  DEFAULT_TIMEZONE,
  BUSINESS_DAY_START_HOUR,
  zonedParts,
  dateKeyInTz,
  businessDateKeyInTz,
  isSameDayInTz,
  isSameBusinessDayInTz,
  isSameMonthInTz,
  monthYearInTz,
};
