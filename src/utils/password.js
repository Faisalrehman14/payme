const WEAK_PASSWORDS = new Set([
  "admin123",
  "password",
  "password123",
  "changeme",
  "change-this-password",
  "12345678",
  "1234567890",
  "qwerty123",
  "letmein",
  "welcome1",
]);

function validatePasswordStrength(password, { minLength = 10 } = {}) {
  const value = String(password || "");
  if (value.length < minLength) {
    return {
      ok: false,
      error: `Password must be at least ${minLength} characters`,
    };
  }
  if (WEAK_PASSWORDS.has(value.toLowerCase())) {
    return { ok: false, error: "Choose a stronger password" };
  }
  if (!/[A-Za-z]/.test(value) || !/[0-9]/.test(value)) {
    return {
      ok: false,
      error: "Password must include at least one letter and one number",
    };
  }
  return { ok: true, error: null };
}

function validateUsername(username) {
  const value = String(username || "").trim();
  if (value.length < 3 || value.length > 32) {
    return { ok: false, error: "Username must be 3–32 characters" };
  }
  if (!/^[a-zA-Z0-9._-]+$/.test(value)) {
    return {
      ok: false,
      error: "Username can only use letters, numbers, dots, underscores, and hyphens",
    };
  }
  return { ok: true, error: null, username: value };
}

function generateOfficePassword(length = 14) {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$%";
  const crypto = require("crypto");
  const bytes = crypto.randomBytes(length);
  let out = "";
  for (let i = 0; i < length; i += 1) {
    out += alphabet[bytes[i] % alphabet.length];
  }
  // Guarantee letter + number for policy
  if (!/[A-Za-z]/.test(out)) out = `A${out.slice(1)}`;
  if (!/[0-9]/.test(out)) out = `${out.slice(0, -1)}7`;
  return out;
}

module.exports = {
  validatePasswordStrength,
  validateUsername,
  generateOfficePassword,
};
