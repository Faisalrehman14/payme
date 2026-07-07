require("dotenv").config();
require("websocket-polyfill");

const { webcrypto } = require("crypto");
if (!globalThis.crypto) {
  globalThis.crypto = webcrypto;
}

const express = require("express");
const QRCode = require("qrcode");
const path = require("path");
const { NWCClient } = require("@getalby/sdk/nwc");
const db = require("./db");

const app = express();
const PORT = process.env.PORT || 3000;
const INVOICE_EXPIRY_SEC = 600;
const SESSION_COOKIE = "payme_session";
const USE_SECURE_COOKIES =
  process.env.NODE_ENV === "production" ||
  Boolean(process.env.RAILWAY_ENVIRONMENT) ||
  Boolean(process.env.RAILWAY_PUBLIC_DOMAIN);

const LOGIN_WINDOW_MS = 15 * 60 * 1000;
const LOGIN_MAX_ATTEMPTS = 10;
const loginAttempts = new Map();

app.set("trust proxy", 1);

app.use((_req, res, next) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  res.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
  if (USE_SECURE_COOKIES) {
    res.setHeader("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
  }
  next();
});

function normalizeToken(value) {
  if (!value) return "";
  return value.trim().replace(/^["']|["']$/g, "");
}

const NWC_URL = process.env.NWC_URL;
const ALBY_TOKEN = normalizeToken(process.env.ALBY_API_TOKEN);

app.use(express.json());

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

function requireOffice(req, res, next) {
  if (req.user.role !== "office") {
    return res.status(403).json({ error: "Office login required" });
  }
  next();
}

function officePublicView(office) {
  return {
    id: office.id,
    name: office.name,
    slug: office.slug,
    commissionPercent: office.commissionPercent || 0,
  };
}

function paymentView(payment, officesById) {
  const office = officesById[payment.officeId];
  const commissionPercent = office?.commissionPercent || 0;
  const grossUsd = Number(payment.amountUsd) || 0;
  const netUsd = db.netUsd(grossUsd, commissionPercent);
  return {
    id: payment.id,
    officeId: payment.officeId,
    officeName: office ? office.name : "Unknown",
    officeSlug: office ? office.slug : null,
    paymentHash: payment.paymentHash,
    amountUsd: grossUsd,
    grossUsd,
    netUsd,
    commissionPercent,
    amountSats: payment.amountSats,
    method: "Cash App",
    status: payment.status,
    createdAt: payment.createdAt,
    settledAt: payment.settledAt,
    expiresAt: payment.expiresAt,
  };
}

app.get("/favicon.ico", (_req, res) => {
  res.redirect(301, "/favicon.svg");
});

app.get("/", (_req, res) => {
  res.sendFile(path.join(__dirname, "public", "landing.html"));
});

app.get("/pay/:slug", (_req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

app.get("/admin", (_req, res) => {
  res.sendFile(path.join(__dirname, "public", "admin.html"));
});

app.get("/dashboard", (_req, res) => {
  res.sendFile(path.join(__dirname, "public", "dashboard.html"));
});

app.use(express.static(path.join(__dirname, "public")));

function normalizeNwcUrl(url) {
  if (!url) return "";
  return url.trim().replace(/^["']|["']$/g, "");
}

function parseNwcUrl(url) {
  const cleaned = normalizeNwcUrl(url);
  if (!cleaned) return { valid: false, error: "NWC_URL is empty" };
  if (cleaned.includes("paste_here")) {
    return { valid: false, error: "NWC_URL still has placeholder text" };
  }
  if (!cleaned.startsWith("nostr+walletconnect://")) {
    return {
      valid: false,
      error: "NWC_URL must start with nostr+walletconnect://",
    };
  }

  const query = cleaned.split("?")[1];
  if (!query) {
    return { valid: false, error: "NWC_URL is incomplete (missing ?relay=...&secret=...)" };
  }

  const params = new URLSearchParams(query);
  const relays = params.getAll("relay");
  const secret = params.get("secret");

  if (!secret) {
    return {
      valid: false,
      error:
        "NWC_URL missing secret. Railway may have cut the URL at &. Paste the FULL string as one variable.",
    };
  }

  if (relays.length === 0) {
    return {
      valid: false,
      error: "NWC_URL missing relay. Paste the complete connection secret from Alby Hub.",
    };
  }

  for (const relay of relays) {
    if (!relay.startsWith("wss://")) {
      return { valid: false, error: `Invalid relay URL: ${relay}` };
    }
  }

  return { valid: true, cleaned };
}

function getNwcUrl() {
  const parsed = parseNwcUrl(NWC_URL);
  return parsed.valid ? parsed.cleaned : null;
}

function hasCredentials() {
  const nwcOk = Boolean(getNwcUrl());
  const token = getAlbyToken();
  return nwcOk || Boolean(token);
}

function getAlbyToken() {
  const token = normalizeToken(ALBY_TOKEN);
  if (!token || token === "your_token_here") return "";
  if (token.startsWith("nostr+walletconnect://")) return "";
  return token;
}

function requireCredentials(res) {
  if (!hasCredentials()) {
    const parsed = parseNwcUrl(NWC_URL || "");
    const token = normalizeToken(ALBY_TOKEN || "");
    let error = parsed.error || "Add NWC_URL or ALBY_API_TOKEN in Railway Variables.";

    if (token.startsWith("nostr+walletconnect://")) {
      error =
        "ALBY_API_TOKEN mein NWC string mat dalo. Woh NWC_URL mein jati hai. ALBY_API_TOKEN ke liye getalby.com/developer se access token lo.";
    }

    res.status(500).json({ error });
    return false;
  }
  return true;
}

function createNwcClient() {
  const url = getNwcUrl();
  if (!url) {
    throw new Error(parseNwcUrl(NWC_URL || "").error || "Invalid NWC_URL");
  }
  return new NWCClient({ nostrWalletConnectUrl: url });
}

async function albyFetch(endpoint, options = {}) {
  const token = getAlbyToken();
  if (!token) {
    throw new Error(
      "Invalid ALBY_API_TOKEN. Use access token from getalby.com/developer ù not NWC string."
    );
  }

  const response = await fetch(`https://api.getalby.com${endpoint}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      ...(options.headers || {}),
    },
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data.message || data.error || `Alby API error (${response.status})`);
  }
  return data;
}

async function lookupInvoiceSettled(paymentHash) {
  if (getNwcUrl()) {
    const client = createNwcClient();
    try {
      const result = await client.lookupInvoice({ payment_hash: paymentHash });
      const settled = result.invoice?.settled ?? result.settled ?? false;
      return {
        settled: Boolean(settled),
        amount: result.invoice?.amount ?? result.amount,
      };
    } finally {
      client.close();
    }
  }

  const invoice = await albyFetch(`/invoices/${paymentHash}`);
  return {
    settled: Boolean(invoice.settled_at),
    amount: invoice.amount,
    settledAt: invoice.settled_at || null,
  };
}

async function syncPaymentRecord(payment) {
  if (!payment || payment.status !== "pending") return payment;

  if (payment.expiresAt && Date.now() > Date.parse(payment.expiresAt)) {
    return db.updatePaymentByHash(payment.paymentHash, { status: "expired" });
  }

  if (!hasCredentials()) return payment;

  try {
    const result = await lookupInvoiceSettled(payment.paymentHash);
    const settledAt = result.settledAt || (result.settled ? new Date().toISOString() : null);
    if (result.settled) {
      return db.updatePaymentByHash(payment.paymentHash, {
        status: "paid",
        settledAt,
      });
    }
  } catch {
    // Alby Hub may be offline ù keep pending
  }

  return payment;
}

async function syncOfficePayments(officeId) {
  const payments = await db.listPaymentsForOffice(officeId, 200);
  const pending = payments.filter((p) => p.status === "pending");
  await Promise.all(pending.map((p) => syncPaymentRecord(p)));
}

async function syncOfficePayments(officeId) {
  const payments = await db.listPaymentsForOffice(officeId, 200);
  const pending = payments.filter((p) => p.status === "pending");
  await Promise.all(pending.map((p) => syncPaymentRecord(p)));
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

app.post("/api/auth/login", async (req, res) => {
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
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/auth/logout", async (req, res) => {
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

app.get("/api/auth/me", async (req, res) => {
  try {
    const user = await getAuthUser(req);
    if (!user) return res.status(401).json({ error: "Not logged in" });
    res.json({ user });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get("/api/offices/:slug", async (req, res) => {
  try {
    const office = await db.getOfficeBySlug(req.params.slug);
    if (!office) {
      return res.status(404).json({ error: "Office not found" });
    }
    res.json({ office: officePublicView(office) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get("/api/admin/offices", requireAuth, requireAdmin, async (req, res) => {
  try {
    const offices = await db.listOffices();
    const result = await Promise.all(
      offices.map(async (office) => ({
        ...officePublicView(office),
        payLink: `${reqBaseUrl(req)}/pay/${office.slug}`,
        stats: await db.getOfficeStats(office.id),
      }))
    );
    res.json({ offices: result });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/admin/offices", requireAuth, requireAdmin, async (req, res) => {
  try {
    const { name, slug, commissionPercent } = req.body || {};
    if (!name || !name.trim()) {
      return res.status(400).json({ error: "Office name required" });
    }
    const office = await db.createOffice(
      name.trim(),
      slug ? slug.trim() : undefined,
      commissionPercent
    );
    res.status(201).json({
      office: {
        ...officePublicView(office),
        payLink: `${reqBaseUrl(req)}/pay/${office.slug}`,
      },
    });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.patch("/api/admin/offices/:id/commission", requireAuth, requireAdmin, async (req, res) => {
  try {
    const { commissionPercent } = req.body || {};
    if (commissionPercent === undefined || commissionPercent === null) {
      return res.status(400).json({ error: "Commission percent required" });
    }
    const office = await db.updateOfficeCommission(req.params.id, commissionPercent);
    res.json({ office: officePublicView(office) });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.get("/api/admin/users", requireAuth, requireAdmin, async (_req, res) => {
  try {
    const offices = await db.listOffices();
    const officesById = Object.fromEntries(offices.map((o) => [o.id, o]));
    const users = (await db.listUsers())
      .filter((u) => u.role === "office")
      .map((u) => ({
        ...u,
        officeName: officesById[u.officeId]?.name || null,
        officeSlug: officesById[u.officeId]?.slug || null,
      }));
    res.json({ users });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/admin/users", requireAuth, requireAdmin, async (req, res) => {
  try {
    const { username, password, officeId } = req.body || {};
    if (!username || !password || !officeId) {
      return res.status(400).json({ error: "Username, password, and office required" });
    }
    if (password.length < 8) {
      return res.status(400).json({ error: "Password must be at least 8 characters" });
    }
    const user = await db.createOfficeUser(username.trim(), password, officeId);
    const { passwordHash, ...safeUser } = user;
    res.status(201).json({ user: safeUser });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.patch("/api/admin/users/:id/password", requireAuth, requireAdmin, async (req, res) => {
  try {
    const { password } = req.body || {};
    if (!password || password.length < 8) {
      return res.status(400).json({ error: "Password must be at least 8 characters" });
    }
    await db.updateOfficeUserPassword(req.params.id, password);
    res.json({ ok: true });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.delete("/api/admin/users/:id", requireAuth, requireAdmin, async (req, res) => {
  try {
    await db.deleteOfficeUser(req.params.id);
    res.json({ ok: true });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.get("/api/admin/payments", requireAuth, requireAdmin, async (_req, res) => {
  try {
    const offices = await db.listOffices();
    await Promise.all(offices.map((o) => syncOfficePayments(o.id)));
    const officesById = Object.fromEntries(offices.map((o) => [o.id, o]));
    const payments = (await db.listAllPayments()).map((p) => paymentView(p, officesById));
    res.json({ payments });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get("/api/admin/overview", requireAuth, requireAdmin, async (_req, res) => {
  try {
    const offices = await db.listOffices();
    await Promise.all(offices.map((o) => syncOfficePayments(o.id)));

    const users = (await db.listUsers()).filter((u) => u.role === "office");
    const officesById = Object.fromEntries(offices.map((o) => [o.id, o]));
    const payments = (await db.listAllPayments(300)).map((p) => paymentView(p, officesById));
    const paid = payments.filter((p) => p.status === "paid");

    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);
    const todayPaid = paid.filter((p) => new Date(p.settledAt || p.createdAt) >= startOfDay);

    const nwc = parseNwcUrl(NWC_URL || "");
    const database = await db.healthCheck();

    res.json({
      offices: offices.length,
      users: users.length,
      paidCount: paid.length,
      pendingCount: payments.filter((p) => p.status === "pending").length,
      totalRevenue: paid.reduce((sum, p) => sum + (p.grossUsd || 0), 0),
      todayRevenue: todayPaid.reduce((sum, p) => sum + (p.grossUsd || 0), 0),
      todayCount: todayPaid.length,
      recentPayments: payments.slice(0, 8),
      health: {
        nwc: nwc.valid,
        nwcError: nwc.valid ? null : nwc.error,
        database,
      },
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get("/api/dashboard/summary", requireAuth, requireOffice, async (req, res) => {
  try {
    const office = await db.getOfficeById(req.user.officeId);
    if (!office) return res.status(404).json({ error: "Office not found" });

    await syncOfficePayments(office.id);

    res.json({
      user: { username: req.user.username },
      office: officePublicView(office),
      payLink: `${reqBaseUrl(req)}/pay/${office.slug}`,
      stats: await db.getDashboardStats(office.id),
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get("/api/dashboard/payments", requireAuth, requireOffice, async (req, res) => {
  try {
    await syncOfficePayments(req.user.officeId);
    const offices = await db.listOffices();
    const officesById = Object.fromEntries(offices.map((o) => [o.id, o]));
    const payments = (await db.listPaymentsForOffice(req.user.officeId)).map((p) =>
      paymentView(p, officesById)
    );
    res.json({ payments });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get("/api/dashboard/monthly", requireAuth, requireOffice, async (req, res) => {
  try {
    await syncOfficePayments(req.user.officeId);
    const now = new Date();
    const month = Number(req.query.month) || now.getMonth() + 1;
    const year = Number(req.query.year) || now.getFullYear();
    if (month < 1 || month > 12) {
      return res.status(400).json({ error: "Invalid month" });
    }
    const data = await db.getMonthlyStats(req.user.officeId, month, year);
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.patch("/api/dashboard/password", requireAuth, requireOffice, async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body || {};
    if (!currentPassword || !newPassword) {
      return res.status(400).json({ error: "Current and new password required" });
    }
    if (newPassword.length < 8) {
      return res.status(400).json({ error: "New password must be at least 8 characters" });
    }
    const user = await db.findUserByUsername(req.user.username);
    if (!user || !db.verifyPassword(currentPassword, user.passwordHash)) {
      return res.status(401).json({ error: "Current password is incorrect" });
    }
    await db.updateOfficeUserPassword(user.id, newPassword);
    res.json({ ok: true });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

function reqBaseUrl(req) {
  const proto = req.headers["x-forwarded-proto"] || req.protocol;
  const host = req.headers["x-forwarded-host"] || req.get("host");
  return `${proto}://${host}`;
}

app.get("/api/health", async (_req, res) => {
  const nwc = parseNwcUrl(NWC_URL || "");
  const token = getAlbyToken();
  let tokenOk = false;
  let tokenError = null;

  if (token) {
    try {
      const response = await fetch("https://api.getalby.com/balance", {
        headers: { Authorization: `Bearer ${token}` },
      });
      tokenOk = response.ok;
      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        tokenError = data.error || data.message || "invalid access token";
      }
    } catch (err) {
      tokenError = err.message;
    }
  }

  const database = await db.healthCheck();

  res.json({
    ok: (nwc.valid || tokenOk) && database.ok,
    nwc: nwc.valid,
    nwcError: nwc.valid ? null : nwc.error,
    token: tokenOk,
    tokenError,
    database,
  });
});

app.get("/api/price", async (_req, res) => {
  try {
    const response = await fetch("https://mempool.space/api/v1/prices");
    const data = await response.json();
    const usd = data.USD || data.usd;
    if (!usd) throw new Error("Could not fetch BTC price");
    res.json({ usd });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/invoice", async (req, res) => {
  if (!requireCredentials(res)) return;

  try {
    const { amountUsd, memo, officeSlug } = req.body;
    const usd = Number(amountUsd);

    if (!usd || usd < 1) {
      return res.status(400).json({ error: "Minimum amount is $1" });
    }

    let office = null;
    if (officeSlug) {
      office = await db.getOfficeBySlug(officeSlug);
      if (!office) {
        return res.status(404).json({ error: "Invalid payment link" });
      }
    }

    const priceRes = await fetch("https://mempool.space/api/v1/prices");
    const priceData = await priceRes.json();
    const btcPrice = priceData.USD || priceData.usd;
    if (!btcPrice) throw new Error("Could not fetch BTC price");

    const sats = Math.max(1, Math.round((usd / btcPrice) * 100_000_000));
    const officeLabel = office ? office.name : "Globa Pay";
    const description = memo || `${officeLabel} ù $${usd.toFixed(2)}`;

    let paymentRequest;
    let paymentHash;

    if (getNwcUrl()) {
      const client = createNwcClient();
      try {
        const result = await client.makeInvoice({
          amount: sats * 1000,
          description,
          expiry: INVOICE_EXPIRY_SEC,
        });
        paymentRequest = result.invoice?.bolt11 || result.invoice;
        paymentHash = result.invoice?.payment_hash || result.payment_hash;
      } finally {
        client.close();
      }
    } else {
      const invoice = await albyFetch("/invoices", {
        method: "POST",
        body: JSON.stringify({ amount: sats, memo: description }),
      });
      paymentRequest = invoice.payment_request;
      paymentHash = invoice.payment_hash;
    }

    const expiresAt = Date.now() + INVOICE_EXPIRY_SEC * 1000;

    if (office) {
      await db.createPayment({
        officeId: office.id,
        paymentHash,
        amountUsd: usd,
        amountSats: sats,
        btcPrice,
        status: "pending",
        expiresAt: new Date(expiresAt).toISOString(),
      });
    }

    const qrDataUrl = await QRCode.toDataURL(paymentRequest, {
      width: 280,
      margin: 2,
      color: { dark: "#000000", light: "#ffffff" },
    });

    res.json({
      paymentHash,
      paymentRequest,
      amountSats: sats,
      amountUsd: usd,
      btcPrice,
      qrDataUrl,
      expiresAt,
      expirySec: INVOICE_EXPIRY_SEC,
      office: office ? officePublicView(office) : null,
    });
  } catch (err) {
    let message = err.message || "Unknown error";
    if (message.includes("timeout") || message.includes("Timeout")) {
      message =
        "Alby Hub is not responding. Open Alby Hub, unlock with password, keep it running, then try again.";
    }
    res.status(500).json({ error: message });
  }
});

app.get("/api/invoice/:hash/status", async (req, res) => {
  if (!requireCredentials(res)) return;

  try {
    const result = await lookupInvoiceSettled(req.params.hash);
    const settled = result.settled;
    const settledAt = result.settledAt || (settled ? new Date().toISOString() : null);

    const stored = await db.getPaymentByHash(req.params.hash);
    if (stored) {
      await syncPaymentRecord(stored);
    }

    res.json({
      settled: Boolean(settled),
      amount: result.amount,
      settledAt,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

async function start() {
  try {
    await db.init();
    await db.seedAdmin(
      process.env.ADMIN_USERNAME || "admin",
      process.env.ADMIN_PASSWORD || "admin123"
    );
  } catch (err) {
    console.error("Database startup failed:", err.message);
    process.exit(1);
  }

  app.listen(PORT, () => {
    console.log(`Globa Pay running ? http://localhost:${PORT}`);
    console.log(`Admin portal ? http://localhost:${PORT}/admin`);
    console.log(`Office dashboard ? http://localhost:${PORT}/dashboard`);
    const nwc = parseNwcUrl(NWC_URL || "");
    if (nwc.valid) {
      console.log("? NWC_URL configured");
    } else if (NWC_URL) {
      console.log("? NWC_URL error:", nwc.error);
    } else {
      console.log("? Add NWC_URL to environment variables");
    }
    if (process.env.DATABASE_URL) {
      console.log("? DATABASE_URL configured (PostgreSQL)");
    } else {
      console.log("? Using JSON storage ù add DATABASE_URL on Railway");
    }
  });
}

start();
