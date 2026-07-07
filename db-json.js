const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, "data");
const DB_FILE = path.join(DATA_DIR, "store.json");

const DEFAULT_DB = {
  offices: [],
  users: [],
  payments: [],
  sessions: [],
  auditLogs: [],
  platformSettings: null,
};

const DEFAULT_PLATFORM_SETTINGS = {
  contactEmail: process.env.CONTACT_EMAIL || "payments@globapay.com",
  contactHeadline: "Want to receive Cash App payments?",
  contactMessage:
    "Contact us to set up your office with a dedicated payment link, secure dashboard, and real-time commission tracking.",
  updatedAt: null,
};

function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
}

function readDb() {
  ensureDataDir();
  if (!fs.existsSync(DB_FILE)) {
    writeDb(DEFAULT_DB);
    return structuredClone(DEFAULT_DB);
  }
  try {
    const raw = fs.readFileSync(DB_FILE, "utf8");
    return { ...DEFAULT_DB, ...JSON.parse(raw) };
  } catch {
    writeDb(DEFAULT_DB);
    return structuredClone(DEFAULT_DB);
  }
}

function writeDb(db) {
  ensureDataDir();
  fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2));
}

function updateDb(mutator) {
  const db = readDb();
  mutator(db);
  writeDb(db);
  return db;
}

function newId() {
  return crypto.randomUUID();
}

function slugify(name) {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 48);
}

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString("hex");
  const hash = crypto.scryptSync(password, salt, 64).toString("hex");
  return `${salt}:${hash}`;
}

function verifyPassword(password, stored) {
  if (!stored || !password) return false;
  const [salt, hash] = stored.split(":");
  if (!salt || !hash) return false;
  const test = crypto.scryptSync(password, salt, 64).toString("hex");
  try {
    return crypto.timingSafeEqual(Buffer.from(hash, "hex"), Buffer.from(test, "hex"));
  } catch {
    return false;
  }
}

async function init() {
  const db = readDb();
  if (!db.platformSettings) {
    updateDb((d) => {
      d.platformSettings = { ...DEFAULT_PLATFORM_SETTINGS };
    });
  }
  console.log("→ Using JSON file storage (set DATABASE_URL for PostgreSQL)");
}

function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

async function getPlatformSettings() {
  const db = readDb();
  return db.platformSettings || { ...DEFAULT_PLATFORM_SETTINGS };
}

async function updatePlatformSettings(patch) {
  const current = await getPlatformSettings();
  const contactEmail = patch.contactEmail?.trim() || current.contactEmail;
  const contactHeadline = patch.contactHeadline?.trim() || current.contactHeadline;
  const contactMessage = patch.contactMessage?.trim() || current.contactMessage;

  if (!isValidEmail(contactEmail)) {
    throw new Error("Valid contact email required");
  }
  if (!contactHeadline) throw new Error("Contact headline required");
  if (!contactMessage) throw new Error("Contact message required");

  const updated = {
    contactEmail,
    contactHeadline,
    contactMessage,
    updatedAt: new Date().toISOString(),
  };
  updateDb((d) => {
    d.platformSettings = updated;
  });
  return updated;
}

async function healthCheck() {
  return { ok: true, backend: "json" };
}

async function createSession(userId, ttlMs = 7 * 24 * 60 * 60 * 1000) {
  const token = crypto.randomBytes(32).toString("hex");
  const expiresAt = Date.now() + ttlMs;
  updateDb((db) => {
    db.sessions = db.sessions.filter((s) => s.expiresAt > Date.now());
    db.sessions.push({ token, userId, expiresAt });
  });
  return { token, expiresAt };
}

async function getSession(token) {
  if (!token) return null;
  const db = readDb();
  const session = db.sessions.find((s) => s.token === token && s.expiresAt > Date.now());
  if (!session) return null;
  const user = db.users.find((u) => u.id === session.userId);
  if (!user) return null;
  return { session, user };
}

async function deleteSession(token) {
  updateDb((db) => {
    db.sessions = db.sessions.filter((s) => s.token !== token);
  });
}

async function seedAdmin(username, password) {
  const db = readDb();
  if (db.users.some((u) => u.role === "admin")) return null;
  if (!username || !password) return null;

  const admin = {
    id: newId(),
    username,
    passwordHash: hashPassword(password),
    role: "admin",
    officeId: null,
    createdAt: new Date().toISOString(),
  };

  updateDb((d) => {
    d.users.push(admin);
  });

  return admin;
}

async function findUserByUsername(username) {
  const db = readDb();
  return db.users.find((u) => u.username.toLowerCase() === username.toLowerCase()) || null;
}

async function listOffices() {
  return readDb().offices.slice().sort((a, b) => a.name.localeCompare(b.name));
}

async function getOfficeBySlug(slug) {
  const db = readDb();
  return db.offices.find((o) => o.slug === slug && o.active !== false) || null;
}

async function getOfficeBySlugAny(slug) {
  const db = readDb();
  return db.offices.find((o) => o.slug === slug) || null;
}

async function getOfficeById(id) {
  const db = readDb();
  return db.offices.find((o) => o.id === id) || null;
}

async function createOffice(name, slug, commissionPercent = 0) {
  const cleanSlug = slug || slugify(name);
  if (!cleanSlug) throw new Error("Invalid office name");
  const pct = Math.min(100, Math.max(0, Number(commissionPercent) || 0));

  const db = readDb();
  if (db.offices.some((o) => o.slug === cleanSlug)) {
    throw new Error("Office slug already exists");
  }

  const office = {
    id: newId(),
    name: name.trim(),
    slug: cleanSlug,
    active: true,
    commissionPercent: pct,
    createdAt: new Date().toISOString(),
  };

  updateDb((d) => {
    d.offices.push(office);
  });

  return office;
}

async function updateOfficeCommission(officeId, commissionPercent) {
  const office = await getOfficeById(officeId);
  if (!office) throw new Error("Office not found");
  const pct = Math.min(100, Math.max(0, Number(commissionPercent) || 0));
  updateDb((d) => {
    const idx = d.offices.findIndex((o) => o.id === officeId);
    if (idx !== -1) d.offices[idx].commissionPercent = pct;
  });
  return { ...office, commissionPercent: pct };
}

async function updateOfficeActive(officeId, active) {
  const office = await getOfficeById(officeId);
  if (!office) throw new Error("Office not found");
  updateDb((d) => {
    const idx = d.offices.findIndex((o) => o.id === officeId);
    if (idx !== -1) d.offices[idx].active = Boolean(active);
  });
  return { ...office, active: Boolean(active) };
}

function netUsd(gross, commissionPercent) {
  return gross * (1 - commissionPercent / 100);
}

async function getDashboardStats(officeId) {
  const office = await getOfficeById(officeId);
  if (!office) throw new Error("Office not found");
  const pct = office.commissionPercent || 0;
  const payments = await listPaymentsForOffice(officeId, 5000);

  const now = new Date();
  const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);

  let todayGross = 0;
  let todayNet = 0;
  let todayCount = 0;
  let monthGross = 0;
  let monthNet = 0;
  let monthCount = 0;

  for (const p of payments) {
    if (p.status !== "paid") continue;
    const gross = p.amountUsd || 0;
    const net = netUsd(gross, pct);
    const paidAt = new Date(p.settledAt || p.createdAt);

    if (paidAt >= startOfDay) {
      todayGross += gross;
      todayNet += net;
      todayCount += 1;
    }
    if (paidAt >= startOfMonth) {
      monthGross += gross;
      monthNet += net;
      monthCount += 1;
    }
  }

  return {
    commissionPercent: pct,
    todayGross,
    todayNet,
    todayCount,
    monthGross,
    monthNet,
    monthCount,
    totalPayments: payments.length,
    paidCount: payments.filter((p) => p.status === "paid").length,
    pendingCount: payments.filter((p) => p.status === "pending").length,
  };
}

async function getMonthlyStats(officeId, month, year) {
  const office = await getOfficeById(officeId);
  if (!office) throw new Error("Office not found");
  const commission = office.commissionPercent || 0;
  const payments = (await listPaymentsForOffice(officeId, 10000)).filter((p) => p.status === "paid");

  const inMonth = payments.filter((p) => {
    const d = new Date(p.settledAt || p.createdAt);
    return d.getMonth() + 1 === month && d.getFullYear() === year;
  });

  const amounts = inMonth.map((p) => Number(p.amountUsd) || 0);
  const grossRevenue = amounts.reduce((a, b) => a + b, 0);
  const netRevenue = inMonth.reduce((s, p) => s + netUsd(Number(p.amountUsd), commission), 0);

  const byDay = {};
  for (const p of inMonth) {
    const d = new Date(p.settledAt || p.createdAt);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    if (!byDay[key]) byDay[key] = { date: key, transactions: 0, gross: 0, net: 0 };
    const g = Number(p.amountUsd);
    byDay[key].transactions += 1;
    byDay[key].gross += g;
    byDay[key].net += netUsd(g, commission);
  }

  const dailyBreakdown = Object.values(byDay).sort((a, b) => a.date.localeCompare(b.date));

  return {
    month,
    year,
    commissionPercent: commission,
    grossRevenue,
    netRevenue,
    transactionCount: inMonth.length,
    avgTransaction: inMonth.length ? grossRevenue / inMonth.length : 0,
    highest: amounts.length ? Math.max(...amounts) : 0,
    lowest: amounts.length ? Math.min(...amounts) : 0,
    dailyBreakdown,
    paymentMethods: [
      {
        name: "Cash App",
        percent: 100,
        gross: grossRevenue,
        count: inMonth.length,
      },
    ],
  };
}

async function createOfficeUser(username, password, officeId) {
  const db = readDb();
  if (db.users.some((u) => u.username.toLowerCase() === username.toLowerCase())) {
    throw new Error(`Username "${username}" already exists — use a different name or reset that user's password`);
  }
  if (!(await getOfficeById(officeId))) {
    throw new Error("Office not found");
  }

  const user = {
    id: newId(),
    username: username.trim(),
    passwordHash: hashPassword(password),
    role: "office",
    officeId,
    createdAt: new Date().toISOString(),
  };

  updateDb((d) => {
    d.users.push(user);
  });

  return user;
}

async function updateOfficeUserPassword(userId, password) {
  const db = readDb();
  const user = db.users.find((u) => u.id === userId);
  if (!user || user.role !== "office") throw new Error("Office user not found");
  updateDb((d) => {
    const idx = d.users.findIndex((u) => u.id === userId);
    d.users[idx].passwordHash = hashPassword(password);
    d.sessions = d.sessions.filter((s) => s.userId !== userId);
  });
  return true;
}

async function deleteOfficeUser(userId) {
  const db = readDb();
  const user = db.users.find((u) => u.id === userId);
  if (!user || user.role !== "office") throw new Error("Office user not found");
  updateDb((d) => {
    d.users = d.users.filter((u) => u.id !== userId);
    d.sessions = d.sessions.filter((s) => s.userId !== userId);
  });
  return true;
}

async function listUsers() {
  const db = readDb();
  return db.users.map(({ passwordHash, ...user }) => user);
}

async function createPayment(record) {
  const payment = {
    id: newId(),
    status: "pending",
    createdAt: new Date().toISOString(),
    settledAt: null,
    ...record,
  };

  updateDb((db) => {
    db.payments.unshift(payment);
  });

  return payment;
}

async function updatePaymentByHash(paymentHash, patch) {
  let updated = null;
  updateDb((db) => {
    const idx = db.payments.findIndex((p) => p.paymentHash === paymentHash);
    if (idx === -1) return;
    db.payments[idx] = { ...db.payments[idx], ...patch };
    updated = db.payments[idx];
  });
  return updated;
}

async function getPaymentByHash(paymentHash) {
  const db = readDb();
  return db.payments.find((p) => p.paymentHash === paymentHash) || null;
}

async function listPaymentsForOffice(officeId, limit = 100) {
  const db = readDb();
  return db.payments.filter((p) => p.officeId === officeId).slice(0, limit);
}

async function listAllPayments(limit = 200) {
  const db = readDb();
  return db.payments.slice(0, limit);
}

async function listPendingPayments(limit = 100) {
  const db = readDb();
  return db.payments.filter((p) => p.status === "pending").slice(0, limit);
}

async function createAuditLog({ userId, username, action, targetType, targetId, details, ip }) {
  const entry = {
    id: newId(),
    userId: userId || null,
    username: username || null,
    action,
    targetType: targetType || null,
    targetId: targetId || null,
    details: details || null,
    ip: ip || null,
    createdAt: new Date().toISOString(),
  };
  updateDb((db) => {
    if (!db.auditLogs) db.auditLogs = [];
    db.auditLogs.unshift(entry);
    db.auditLogs = db.auditLogs.slice(0, 500);
  });
  return entry;
}

async function listAuditLogs(limit = 100) {
  const db = readDb();
  return (db.auditLogs || []).slice(0, limit);
}

async function getOfficeStats(officeId) {
  const payments = await listPaymentsForOffice(officeId, 1000);
  const paid = payments.filter((p) => p.status === "paid");
  return {
    totalPayments: payments.length,
    paidCount: paid.length,
    pendingCount: payments.filter((p) => p.status === "pending").length,
    totalUsd: paid.reduce((sum, p) => sum + (p.amountUsd || 0), 0),
  };
}

module.exports = {
  init,
  healthCheck,
  seedAdmin,
  findUserByUsername,
  verifyPassword,
  createSession,
  getSession,
  deleteSession,
  listOffices,
  getOfficeBySlug,
  getOfficeBySlugAny,
  getOfficeById,
  createOffice,
  updateOfficeCommission,
  updateOfficeActive,
  getDashboardStats,
  getMonthlyStats,
  netUsd,
  createOfficeUser,
  updateOfficeUserPassword,
  deleteOfficeUser,
  listUsers,
  createPayment,
  updatePaymentByHash,
  getPaymentByHash,
  listPaymentsForOffice,
  listAllPayments,
  listPendingPayments,
  getOfficeStats,
  createAuditLog,
  listAuditLogs,
  getPlatformSettings,
  updatePlatformSettings,
  slugify,
};
