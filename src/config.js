const path = require("path");

const PORT = process.env.PORT || 3000;
const INVOICE_EXPIRY_SEC = 600;
const SESSION_COOKIE = "payme_session";
const USE_SECURE_COOKIES =
  process.env.NODE_ENV === "production" ||
  Boolean(process.env.RAILWAY_ENVIRONMENT) ||
  Boolean(process.env.RAILWAY_PUBLIC_DOMAIN);

const LOGIN_WINDOW_MS = 15 * 60 * 1000;
const LOGIN_MAX_ATTEMPTS = 10;
const SYNC_INTERVAL_MS = Number(process.env.SYNC_INTERVAL_MS) || 30_000;

const NWC_URL = process.env.NWC_URL;
const ALBY_TOKEN = (process.env.ALBY_API_TOKEN || process.env.ALBY_TOKEN || "")
  .trim()
  .replace(/^["']|["']$/g, "");

const PUBLIC_BASE_URL = (process.env.PUBLIC_BASE_URL || "")
  .trim()
  .replace(/\/$/, "");

const PUBLIC_DIR = path.join(__dirname, "..", "public");

module.exports = {
  PORT,
  INVOICE_EXPIRY_SEC,
  SESSION_COOKIE,
  USE_SECURE_COOKIES,
  LOGIN_WINDOW_MS,
  LOGIN_MAX_ATTEMPTS,
  SYNC_INTERVAL_MS,
  NWC_URL,
  ALBY_TOKEN,
  PUBLIC_BASE_URL,
  PUBLIC_DIR,
};
