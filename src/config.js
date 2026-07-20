const path = require("path");

const PORT = process.env.PORT || 3000;
const INVOICE_EXPIRY_SEC = 600;
const SESSION_COOKIE = "payme_session";
const IS_PRODUCTION =
  process.env.NODE_ENV === "production" ||
  Boolean(process.env.RAILWAY_ENVIRONMENT) ||
  Boolean(process.env.RAILWAY_PUBLIC_DOMAIN);

const USE_SECURE_COOKIES = IS_PRODUCTION;

const LOGIN_WINDOW_MS = 15 * 60 * 1000;
const LOGIN_MAX_ATTEMPTS = 10;
const SYNC_INTERVAL_MS = Number(process.env.SYNC_INTERVAL_MS) || 30_000;
const SESSION_TTL_MS = Number(process.env.SESSION_TTL_MS) || 7 * 24 * 60 * 60 * 1000;
const JSON_BODY_LIMIT = process.env.JSON_BODY_LIMIT || "64kb";

const NWC_URL = process.env.NWC_URL;
const ALBY_TOKEN = (process.env.ALBY_API_TOKEN || process.env.ALBY_TOKEN || "")
  .trim()
  .replace(/^["']|["']$/g, "");

// Lightning Address used for Cash App-compatible LNURL invoices (e.g. you@getalby.com)
const ALBY_LIGHTNING_ADDRESS = (
  process.env.ALBY_LIGHTNING_ADDRESS ||
  process.env.LIGHTNING_ADDRESS ||
  ""
)
  .trim()
  .toLowerCase();

const PUBLIC_BASE_URL = (process.env.PUBLIC_BASE_URL || "")
  .trim()
  .replace(/\/$/, "");

const PUBLIC_DIR = path.join(__dirname, "..", "public");
const APP_TIMEZONE = (process.env.APP_TIMEZONE || "Asia/Karachi").trim() || "Asia/Karachi";

module.exports = {
  PORT,
  INVOICE_EXPIRY_SEC,
  SESSION_COOKIE,
  IS_PRODUCTION,
  USE_SECURE_COOKIES,
  LOGIN_WINDOW_MS,
  LOGIN_MAX_ATTEMPTS,
  SYNC_INTERVAL_MS,
  SESSION_TTL_MS,
  JSON_BODY_LIMIT,
  NWC_URL,
  ALBY_TOKEN,
  ALBY_LIGHTNING_ADDRESS,
  PUBLIC_BASE_URL,
  PUBLIC_DIR,
  APP_TIMEZONE,
};
