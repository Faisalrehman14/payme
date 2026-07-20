const express = require("express");
const db = require("../../db");
const {
  setSessionCookie,
  clearSessionCookie,
  parseCookies,
  getAuthUser,
  getClientIp,
  checkLoginRateLimit,
  recordFailedLogin,
  clearLoginAttempts,
} = require("../middleware/auth");
const { SESSION_COOKIE, SESSION_TTL_MS } = require("../config");
const { createRateLimiter } = require("../middleware/rate-limit");
const { logAudit } = require("../services/audit");

const router = express.Router();

const loginLimiter = createRateLimiter({
  windowMs: 15 * 60 * 1000,
  max: 30,
  keyFn: (req) => getClientIp(req),
  message: "Too many login attempts from this IP. Please wait 15 minutes.",
});

router.post("/login", loginLimiter, async (req, res) => {
  try {
    const ip = getClientIp(req);
    checkLoginRateLimit(ip);

    const { username, password } = req.body || {};
    if (!username?.trim() || !password) {
      return res.status(400).json({ error: "Username and password required" });
    }

    const user = await db.findUserByUsername(username.trim());
    if (!user || !db.verifyPassword(password, user.passwordHash)) {
      recordFailedLogin(ip);
      return res.status(401).json({ error: "Invalid username or password" });
    }

    if (user.role === "office") {
      if (!user.officeId) {
        return res.status(403).json({ error: "Office account is not linked. Contact admin." });
      }
      const office = await db.getOfficeById(user.officeId);
      if (!office) {
        return res.status(403).json({ error: "Office not found. Contact admin." });
      }
      if (office.active === false) {
        return res.status(403).json({
          error: "This office is deactivated. Contact admin.",
        });
      }
    }

    clearLoginAttempts(ip);

    const { token, expiresAt } = await db.createSession(user.id, SESSION_TTL_MS);
    setSessionCookie(res, token, expiresAt);

    req.user = { id: user.id, username: user.username, role: user.role };
    try {
      await logAudit(req, "auth.login", {
        targetType: "user",
        targetId: user.id,
        details: { role: user.role },
      });
    } catch {
      // ignore audit failures on login
    }

    const { passwordHash, ...safeUser } = user;
    res.json({ user: safeUser });
  } catch (err) {
    const status = err.message.includes("Too many") ? 429 : 500;
    res.status(status).json({ error: err.message });
  }
});

router.post("/logout", async (req, res) => {
  try {
    const cookies = parseCookies(req);
    if (cookies[SESSION_COOKIE]) {
      await db.deleteSession(cookies[SESSION_COOKIE]);
    }
    clearSessionCookie(res);
    res.json({ ok: true });
  } catch (_err) {
    res.status(500).json({ error: "Logout failed" });
  }
});

router.get("/me", async (req, res) => {
  try {
    const user = await getAuthUser(req);
    if (!user) return res.status(401).json({ error: "Not logged in" });
    res.json({ user });
  } catch (_err) {
    res.status(500).json({ error: "Could not load session" });
  }
});

module.exports = router;
