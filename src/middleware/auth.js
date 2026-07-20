const db = require("../../db");
const { SESSION_COOKIE, LOGIN_WINDOW_MS, LOGIN_MAX_ATTEMPTS, PUBLIC_BASE_URL } = require("../config");

const loginAttempts = new Map();

function parseCookies(req) {
  const header = req.headers.cookie || "";
  return Object.fromEntries(
    header
      .split(";")
      .map((part) => part.trim())
      .filter(Boolean)
      .map((part) => {
        const idx = part.indexOf("=");
        if (idx === -1) return [part, ""];
        return [part.slice(0, idx), decodeURIComponent(part.slice(idx + 1))];
      })
  );
}

function setSessionCookie(res, token, expiresAt) {
  const { USE_SECURE_COOKIES } = require("../config");
  const maxAge = Math.max(0, Math.floor((expiresAt - Date.now()) / 1000));
  const parts = [
    `${SESSION_COOKIE}=${encodeURIComponent(token)}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    `Max-Age=${maxAge}`,
  ];
  if (USE_SECURE_COOKIES) parts.push("Secure");
  res.setHeader("Set-Cookie", parts.join("; "));
}

function clearSessionCookie(res) {
  const { USE_SECURE_COOKIES } = require("../config");
  const parts = [
    `${SESSION_COOKIE}=`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    "Max-Age=0",
  ];
  if (USE_SECURE_COOKIES) parts.push("Secure");
  res.setHeader("Set-Cookie", parts.join("; "));
}

async function getAuthUser(req) {
  const cookies = parseCookies(req);
  const session = await db.getSession(cookies[SESSION_COOKIE]);
  if (!session) return null;
  const { passwordHash, ...user } = session.user;
  return user;
}

async function requireAuth(req, res, next) {
  try {
    const user = await getAuthUser(req);
    if (!user) {
      return res.status(401).json({ error: "Login required" });
    }
    req.user = user;
    next();
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

function requireAdmin(req, res, next) {
  if (req.user.role !== "admin") {
    return res.status(403).json({ error: "Admin only" });
  }
  next();
}

async function requireOffice(req, res, next) {
  try {
    if (req.user.role !== "office") {
      return res.status(403).json({ error: "Office login required" });
    }
    if (!req.user.officeId) {
      return res.status(403).json({ error: "Office account is not linked" });
    }
    const office = await db.getOfficeById(req.user.officeId);
    if (!office || office.active === false) {
      return res.status(403).json({ error: "This office is deactivated. Contact admin." });
    }
    req.office = office;
    next();
  } catch (err) {
    res.status(500).json({ error: "Could not verify office access" });
  }
}

function getClientIp(req) {
  const forwarded = req.headers["x-forwarded-for"];
  if (typeof forwarded === "string" && forwarded.length) {
    return forwarded.split(",")[0].trim();
  }
  return req.ip || "unknown";
}

function checkLoginRateLimit(ip) {
  const now = Date.now();
  let entry = loginAttempts.get(ip);
  if (!entry || now - entry.start > LOGIN_WINDOW_MS) {
    entry = { start: now, count: 0 };
  }
  if (entry.count >= LOGIN_MAX_ATTEMPTS) {
    throw new Error("Too many login attempts. Please wait 15 minutes.");
  }
  loginAttempts.set(ip, entry);
}

function recordFailedLogin(ip) {
  const now = Date.now();
  let entry = loginAttempts.get(ip);
  if (!entry || now - entry.start > LOGIN_WINDOW_MS) {
    entry = { start: now, count: 0 };
  }
  entry.count += 1;
  loginAttempts.set(ip, entry);
}

function clearLoginAttempts(ip) {
  loginAttempts.delete(ip);
}

function reqBaseUrl(req) {
  if (PUBLIC_BASE_URL) return PUBLIC_BASE_URL;
  const proto = req.headers["x-forwarded-proto"] || req.protocol;
  const host = req.headers["x-forwarded-host"] || req.get("host");
  return `${proto}://${host}`;
}

module.exports = {
  parseCookies,
  setSessionCookie,
  clearSessionCookie,
  getAuthUser,
  requireAuth,
  requireAdmin,
  requireOffice,
  getClientIp,
  checkLoginRateLimit,
  recordFailedLogin,
  clearLoginAttempts,
  reqBaseUrl,
};
