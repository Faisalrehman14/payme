const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, "data");
const DB_FILE = path.join(DATA_DIR, "store.json");

const DEFAULT_DB = {
  offices: [],
  users: [],
  payments: [],
  payouts: [],
  ledgerEntries: [],
  sessions: [],
  auditLogs: [],
  platformSettings: null,
};

const DEFAULT_PLATFORM_SETTINGS = {
  contactEmail: process.env.CONTACT_EMAIL || "payments@globapay.com",
  contactHeadline: "Want to receive Cash App payments?",
  contactMessage:
    "Contact us to set up your office with a dedicated payment link and secure dashboard with real-time payment tracking.",
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
  const key = String(slug || "").trim().toLowerCase();
  return db.offices.find((o) => o.slug.toLowerCase() === key && o.active !== false) || null;
}

async function getOfficeBySlugAny(slug) {
  const db = readDb();
  const key = String(slug || "").trim().toLowerCase();
  return db.offices.find((o) => o.slug.toLowerCase() === key) || null;
}

async function getOfficeById(id) {
  const db = readDb();
  return db.offices.find((o) => o.id === id) || null;
}

async function createOffice(name, slug) {
  const cleanSlug = slug || slugify(name);
  if (!cleanSlug) throw new Error("Invalid office name");

  const db = readDb();
  if (db.offices.some((o) => o.slug.toLowerCase() === cleanSlug.toLowerCase())) {
    throw new Error("Office slug already exists");
  }

  const office = {
    id: newId(),
    name: name.trim(),
    slug: cleanSlug,
    active: true,
    payoutsEnabled: false,
    commissionPercent: 0,
    createdAt: new Date().toISOString(),
  };

  updateDb((d) => {
    d.offices.push(office);
  });

  return office;
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

async function updateOfficePayoutsEnabled(officeId, enabled) {
  const office = await getOfficeById(officeId);
  if (!office) throw new Error("Office not found");
  updateDb((d) => {
    const idx = d.offices.findIndex((o) => o.id === officeId);
    if (idx !== -1) d.offices[idx].payoutsEnabled = Boolean(enabled);
  });
  return { ...office, payoutsEnabled: Boolean(enabled) };
}

async function updateOfficeCommission(officeId, commissionPercent) {
  const office = await getOfficeById(officeId);
  if (!office) throw new Error("Office not found");
  const pct = Number(commissionPercent);
  if (!Number.isFinite(pct) || pct < 0 || pct > 100) {
    throw new Error("Commission must be between 0 and 100");
  }
  const rounded = Math.round(pct * 100) / 100;
  updateDb((d) => {
    const idx = d.offices.findIndex((o) => o.id === officeId);
    if (idx !== -1) d.offices[idx].commissionPercent = rounded;
  });
  return { ...office, commissionPercent: rounded };
}

function roundUsd(n) {
  return Math.round((Number(n) || 0) * 100) / 100;
}

function buildPayoutBalance({ totalEarnedUsd, totalWithdrawnUsd, pendingUsd, commissionPercent }) {
  const pct = Math.min(100, Math.max(0, Number(commissionPercent) || 0));
  const earned = roundUsd(totalEarnedUsd);
  const withdrawn = roundUsd(totalWithdrawnUsd);
  const pending = roundUsd(pendingUsd);
  const platformFeeUsd = roundUsd((earned * pct) / 100);
  const netEarnedUsd = roundUsd(earned - platformFeeUsd);
  const availableUsd = Math.max(0, roundUsd(netEarnedUsd - withdrawn - pending));
  return {
    totalEarnedUsd: earned,
    commissionPercent: pct,
    platformFeeUsd,
    netEarnedUsd,
    totalWithdrawnUsd: withdrawn,
    pendingUsd: pending,
    availableUsd,
    source: "ledger",
  };
}

const payoutLocks = new Map();

async function withOfficePayoutLock(officeId, fn) {
  const prev = payoutLocks.get(officeId) || Promise.resolve();
  let release;
  const current = new Promise((resolve) => {
    release = resolve;
  });
  payoutLocks.set(
    officeId,
    prev.finally(() => current)
  );
  await prev.catch(() => {});
  try {
    return await fn();
  } finally {
    release();
  }
}

async function upsertLedgerEntry(entry) {
  let saved = null;
  updateDb((d) => {
    if (!d.ledgerEntries) d.ledgerEntries = [];
    const idx = d.ledgerEntries.findIndex((e) => e.idempotencyKey === entry.idempotencyKey);
    const row = {
      id: idx >= 0 ? d.ledgerEntries[idx].id : newId(),
      officeId: entry.officeId,
      entryType: entry.entryType,
      amountUsd: roundUsd(entry.amountUsd),
      amountSats: entry.amountSats ?? null,
      refType: entry.refType,
      refId: entry.refId,
      idempotencyKey: entry.idempotencyKey,
      metadata: entry.metadata || null,
      createdAt: idx >= 0 ? d.ledgerEntries[idx].createdAt : new Date().toISOString(),
    };
    if (idx >= 0) d.ledgerEntries[idx] = row;
    else d.ledgerEntries.unshift(row);
    saved = row;
  });
  return saved;
}

async function deleteLedgerEntryByKey(idempotencyKey) {
  updateDb((d) => {
    if (!d.ledgerEntries) d.ledgerEntries = [];
    d.ledgerEntries = d.ledgerEntries.filter((e) => e.idempotencyKey !== idempotencyKey);
  });
  return true;
}

async function listLedgerEntriesForOffice(officeId, limit = 5000) {
  const db = readDb();
  return (db.ledgerEntries || [])
    .filter((e) => e.officeId === officeId)
    .slice(0, limit);
}

async function getOfficePayoutBalance(officeId) {
  const db = readDb();
  const office = db.offices.find((o) => o.id === officeId);
  if (!office) throw new Error("Office not found");

  const entries = (db.ledgerEntries || []).filter((e) => e.officeId === officeId);
  if (entries.length) {
    return buildPayoutBalance({
      totalEarnedUsd: entries
        .filter((e) => e.entryType === "payment_credit")
        .reduce((s, e) => s + (Number(e.amountUsd) || 0), 0),
      totalWithdrawnUsd: entries
        .filter((e) => e.entryType === "payout_debit")
        .reduce((s, e) => s + (Number(e.amountUsd) || 0), 0),
      pendingUsd: entries
        .filter((e) => e.entryType === "payout_hold")
        .reduce((s, e) => s + (Number(e.amountUsd) || 0), 0),
      commissionPercent: office.commissionPercent || 0,
    });
  }

  const payments = (db.payments || []).filter(
    (p) => p.officeId === officeId && p.status === "paid"
  );
  const payouts = (db.payouts || []).filter((p) => p.officeId === officeId);

  const totalEarnedUsd = payments.reduce((sum, p) => sum + (Number(p.amountUsd) || 0), 0);
  const totalWithdrawnUsd = payouts
    .filter((p) => p.status === "paid")
    .reduce((sum, p) => sum + (Number(p.amountUsd) || 0), 0);
  const pendingUsd = payouts
    .filter((p) => p.status === "pending")
    .reduce((sum, p) => sum + (Number(p.amountUsd) || 0), 0);

  return {
    ...buildPayoutBalance({
      totalEarnedUsd,
      totalWithdrawnUsd,
      pendingUsd,
      commissionPercent: office.commissionPercent || 0,
    }),
    source: "legacy",
  };
}

async function failStalePendingPayouts(officeId, olderThanMs) {
  const cutoff = Date.now() - olderThanMs;
  const failedIds = [];
  updateDb((d) => {
    if (!d.payouts) d.payouts = [];
    for (const p of d.payouts) {
      if (
        p.officeId === officeId &&
        p.status === "pending" &&
        new Date(p.createdAt).getTime() < cutoff
      ) {
        p.status = "failed";
        p.errorMessage = p.errorMessage || "Timed out — please try again";
        failedIds.push(p.id);
      }
    }
    if (!d.ledgerEntries) d.ledgerEntries = [];
    d.ledgerEntries = d.ledgerEntries.filter(
      (e) => !(e.entryType === "payout_hold" && failedIds.includes(e.refId))
    );
  });
}

async function createPayoutIfSufficient(record, { stalePendingMs = 10 * 60 * 1000 } = {}) {
  return withOfficePayoutLock(record.officeId, async () => {
    await failStalePendingPayouts(record.officeId, stalePendingMs);

    const existing = await getPayoutByPaymentHash(record.paymentHash);
    if (existing) {
      throw new Error("This invoice was already used for a payout");
    }

    const balance = await getOfficePayoutBalance(record.officeId);
    const amountUsd = roundUsd(record.amountUsd);
    if (amountUsd > balance.availableUsd + 0.009) {
      throw new Error(
        `Insufficient balance. Available: $${balance.availableUsd.toFixed(2)}, requested: $${amountUsd.toFixed(2)}`
      );
    }

    const payout = await createPayout({ ...record, amountUsd, status: "pending" });
    await upsertLedgerEntry({
      officeId: record.officeId,
      entryType: "payout_hold",
      amountUsd,
      amountSats: record.amountSats,
      refType: "payout",
      refId: payout.id,
      idempotencyKey: `payout_hold:${payout.id}`,
    });
    return { payout, balanceBefore: balance };
  });
}

async function createPayout(record) {
  const payout = {
    id: newId(),
    officeId: record.officeId,
    userId: record.userId || null,
    paymentHash: record.paymentHash,
    invoice: record.invoice,
    amountUsd: Number(record.amountUsd),
    amountSats: record.amountSats,
    btcPrice: record.btcPrice ?? null,
    feeSats: null,
    status: record.status || "pending",
    provider: null,
    preimage: null,
    errorMessage: null,
    createdAt: new Date().toISOString(),
    settledAt: null,
  };
  updateDb((d) => {
    if (!d.payouts) d.payouts = [];
    d.payouts.unshift(payout);
  });
  return payout;
}

async function updatePayout(id, fields) {
  let updated = null;
  updateDb((d) => {
    if (!d.payouts) d.payouts = [];
    const idx = d.payouts.findIndex((p) => p.id === id);
    if (idx === -1) return;
    d.payouts[idx] = {
      ...d.payouts[idx],
      ...fields,
    };
    updated = d.payouts[idx];
  });
  if (!updated) throw new Error("Payout not found");

  if (fields.status === "paid") {
    await deleteLedgerEntryByKey(`payout_hold:${updated.id}`);
    await upsertLedgerEntry({
      officeId: updated.officeId,
      entryType: "payout_debit",
      amountUsd: updated.amountUsd,
      amountSats: updated.amountSats,
      refType: "payout",
      refId: updated.id,
      idempotencyKey: `payout_debit:${updated.id}`,
    });
  } else if (fields.status === "failed") {
    await deleteLedgerEntryByKey(`payout_hold:${updated.id}`);
    await deleteLedgerEntryByKey(`payout_debit:${updated.id}`);
  }

  return updated;
}

async function getPayoutByPaymentHash(paymentHash) {
  const db = readDb();
  return (db.payouts || []).find((p) => p.paymentHash === paymentHash) || null;
}

async function listPayoutsForOffice(officeId, limit = 100) {
  const db = readDb();
  return (db.payouts || [])
    .filter((p) => p.officeId === officeId)
    .slice(0, limit);
}

async function listAllPayouts(limit = 300) {
  const db = readDb();
  return (db.payouts || []).slice(0, limit);
}

async function getDashboardStats(officeId) {
  const office = await getOfficeById(officeId);
  if (!office) throw new Error("Office not found");
  const payments = await listPaymentsForOffice(officeId, 5000);
  const { isSameDayInTz, isSameMonthInTz, DEFAULT_TIMEZONE } = require("./src/utils/timezone");
  const timeZone = DEFAULT_TIMEZONE;
  const now = new Date();

  let todayTotal = 0;
  let todayCount = 0;
  let monthTotal = 0;
  let monthCount = 0;

  for (const p of payments) {
    if (p.status !== "paid") continue;
    const amount = p.amountUsd || 0;
    const paidAt = new Date(p.settledAt || p.createdAt);

    if (isSameDayInTz(paidAt, now, timeZone)) {
      todayTotal += amount;
      todayCount += 1;
    }
    if (isSameMonthInTz(paidAt, now, timeZone)) {
      monthTotal += amount;
      monthCount += 1;
    }
  }

  return {
    todayTotal,
    todayCount,
    monthTotal,
    monthCount,
    totalPayments: payments.length,
    paidCount: payments.filter((p) => p.status === "paid").length,
    pendingCount: payments.filter((p) => p.status === "pending").length,
    timeZone,
  };
}

async function getMonthlyStats(officeId, month, year) {
  const office = await getOfficeById(officeId);
  if (!office) throw new Error("Office not found");
  const { dateKeyInTz, monthYearInTz, DEFAULT_TIMEZONE } = require("./src/utils/timezone");
  const timeZone = DEFAULT_TIMEZONE;
  const payments = (await listPaymentsForOffice(officeId, 10000)).filter((p) => p.status === "paid");

  const inMonth = payments.filter((p) => {
    const { month: m, year: y } = monthYearInTz(p.settledAt || p.createdAt, timeZone);
    return m === month && y === year;
  });

  const amounts = inMonth.map((p) => Number(p.amountUsd) || 0);
  const totalRevenue = amounts.reduce((a, b) => a + b, 0);

  const byDay = {};
  for (const p of inMonth) {
    const key = dateKeyInTz(p.settledAt || p.createdAt, timeZone);
    if (!byDay[key]) byDay[key] = { date: key, transactions: 0, total: 0 };
    const amount = Number(p.amountUsd);
    byDay[key].transactions += 1;
    byDay[key].total += amount;
  }

  const dailyBreakdown = Object.values(byDay).sort((a, b) => a.date.localeCompare(b.date));

  return {
    month,
    year,
    totalRevenue,
    transactionCount: inMonth.length,
    avgTransaction: inMonth.length ? totalRevenue / inMonth.length : 0,
    highest: amounts.length ? Math.max(...amounts) : 0,
    lowest: amounts.length ? Math.min(...amounts) : 0,
    dailyBreakdown,
    timeZone,
    paymentMethods: [
      {
        name: "Cash App",
        percent: 100,
        total: totalRevenue,
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
    invoiceProvider: record.invoiceProvider || null,
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
  if (updated?.status === "paid") {
    await upsertLedgerEntry({
      officeId: updated.officeId,
      entryType: "payment_credit",
      amountUsd: updated.amountUsd,
      amountSats: updated.amountSats,
      refType: "payment",
      refId: updated.id,
      idempotencyKey: `payment_credit:${updated.id}`,
      metadata: { paymentHash: updated.paymentHash },
    });
  }
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

async function deleteOffice(officeId) {
  const office = await getOfficeById(officeId);
  if (!office) throw new Error("Office not found");
  updateDb((d) => {
    const userIds = d.users.filter((u) => u.officeId === officeId).map((u) => u.id);
    d.sessions = d.sessions.filter((s) => !userIds.includes(s.userId));
    d.users = d.users.filter((u) => u.officeId !== officeId);
    d.payments = d.payments.filter((p) => p.officeId !== officeId);
    d.payouts = (d.payouts || []).filter((p) => p.officeId !== officeId);
    d.ledgerEntries = (d.ledgerEntries || []).filter((e) => e.officeId !== officeId);
    d.offices = d.offices.filter((o) => o.id !== officeId);
  });
  return true;
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
  updateOfficeActive,
  updateOfficePayoutsEnabled,
  updateOfficeCommission,
  deleteOffice,
  getDashboardStats,
  getMonthlyStats,
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
  getOfficePayoutBalance,
  failStalePendingPayouts,
  createPayout,
  createPayoutIfSufficient,
  updatePayout,
  getPayoutByPaymentHash,
  listPayoutsForOffice,
  listAllPayouts,
  upsertLedgerEntry,
  deleteLedgerEntryByKey,
  listLedgerEntriesForOffice,
  createAuditLog,
  listAuditLogs,
  getPlatformSettings,
  updatePlatformSettings,
  slugify,
};
