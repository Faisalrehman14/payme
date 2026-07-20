const { IS_PRODUCTION } = require("../config");
const { hasCredentials, parseNwcUrl, getAlbyTokenDiagnostics } = require("./nwc");
const { validatePasswordStrength } = require("../utils/password");

const DEFAULT_WEAK = new Set([
  "admin123",
  "change-this-password",
  "password",
  "changeme",
]);

function isProductionRuntime() {
  return (
    IS_PRODUCTION ||
    Boolean(process.env.RAILWAY_ENVIRONMENT) ||
    Boolean(process.env.RAILWAY_PUBLIC_DOMAIN) ||
    process.env.FORCE_PRODUCTION_CHECKS === "1"
  );
}

/**
 * Fail fast on unsafe production config so offices can be onboarded safely.
 */
function validateStartupConfig() {
  const production = isProductionRuntime();
  const errors = [];
  const warnings = [];

  const adminUser = (process.env.ADMIN_USERNAME || "admin").trim();
  const adminPass = process.env.ADMIN_PASSWORD || "";

  if (!adminPass) {
    errors.push("ADMIN_PASSWORD is required");
  } else {
    if (DEFAULT_WEAK.has(adminPass.toLowerCase())) {
      errors.push("ADMIN_PASSWORD is too weak / still a placeholder — set a strong unique password");
    }
    const strength = validatePasswordStrength(adminPass, { minLength: production ? 12 : 8 });
    if (!strength.ok) {
      (production ? errors : warnings).push(`ADMIN_PASSWORD: ${strength.error}`);
    }
  }

  if (!adminUser || adminUser.length < 3) {
    errors.push("ADMIN_USERNAME must be at least 3 characters");
  }

  if (production && !process.env.DATABASE_URL) {
    errors.push("DATABASE_URL is required in production (PostgreSQL)");
  } else if (!process.env.DATABASE_URL) {
    warnings.push("DATABASE_URL missing — using JSON file storage (dev only)");
  }

  if (production && !(process.env.PUBLIC_BASE_URL || "").trim()) {
    errors.push("PUBLIC_BASE_URL is required in production (e.g. https://globa-cash.us)");
  }

  if (!hasCredentials()) {
    const token = getAlbyTokenDiagnostics();
    const nwc = parseNwcUrl(process.env.NWC_URL || "");
    const msg =
      "Payment provider not ready. Set ALBY_LIGHTNING_ADDRESS + ALBY_API_TOKEN (recommended) or a valid NWC_URL.";
    if (production) errors.push(msg);
    else warnings.push(msg);
    if (token.issue) warnings.push(`ALBY_API_TOKEN: ${token.issue}`);
    if (process.env.NWC_URL && !nwc.valid) warnings.push(`NWC_URL: ${nwc.error}`);
  }

  return { production, errors, warnings, adminUser, adminPass };
}

function assertStartupConfigOrExit() {
  const result = validateStartupConfig();
  for (const warning of result.warnings) {
    console.warn("⚠", warning);
  }
  if (result.errors.length) {
    console.error("❌ Production startup blocked:");
    for (const error of result.errors) {
      console.error("  -", error);
    }
    console.error("Fix Railway Variables, then redeploy.");
    process.exit(1);
  }
  return result;
}

module.exports = {
  validateStartupConfig,
  assertStartupConfigOrExit,
  isProductionRuntime,
};
