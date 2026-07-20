const DEFAULT_TIMEZONE = process.env.APP_TIMEZONE || "Asia/Karachi";

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

function dateKeyInTz(date, timeZone = DEFAULT_TIMEZONE) {
  const p = zonedParts(date, timeZone);
  return `${p.year}-${String(p.month).padStart(2, "0")}-${String(p.day).padStart(2, "0")}`;
}

function isSameDayInTz(date, compareTo = new Date(), timeZone = DEFAULT_TIMEZONE) {
  return dateKeyInTz(date, timeZone) === dateKeyInTz(compareTo, timeZone);
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
  zonedParts,
  dateKeyInTz,
  isSameDayInTz,
  isSameMonthInTz,
  monthYearInTz,
};
