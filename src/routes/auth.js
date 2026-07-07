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
const { SESSION_COOKIE } = require("../config");

const router = express.Router();

router.post("/login", async (req, res) => {
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

    clearLoginAttempts(ip);

    const { token, expiresAt } = await db.createSession(user.id);
    setSessionCookie(res, token, expiresAt);

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
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get("/me", async (req, res) => {
  try {
    const user = await getAuthUser(req);
    if (!user) return res.status(401).json({ error: "Not logged in" });
    res.json({ user });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
