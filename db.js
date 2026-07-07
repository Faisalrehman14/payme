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

function createSession(userId, ttlMs = 7 * 24 * 60 * 60 * 1000) {
  const token = crypto.randomBytes(32).toString("hex");
  const expiresAt = Date.now() + ttlMs;
  updateDb((db) => {
    db.sessions = db.sessions.filter((s) => s.expiresAt > Date.now());
    db.sessions.push({ token, userId, expiresAt });
  });
  return { token, expiresAt };
}

function getSession(token) {
  if (!token) return null;
  const db = readDb();
  const session = db.sessions.find((s) => s.token === token && s.expiresAt > Date.now());
  if (!session) return null;
  const user = db.users.find((u) => u.id === session.userId);
  if (!user) return null;
  return { session, user };
}

function deleteSession(token) {
  updateDb((db) => {
    db.sessions = db.sessions.filter((s) => s.token !== token);
  });
}

function seedAdmin(username, password) {
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

function findUserByUsername(username) {
  const db = readDb();
  return db.users.find((u) => u.username.toLowerCase() === username.toLowerCase()) || null;
}

function listOffices() {
  return readDb().offices.slice().sort((a, b) => a.name.localeCompare(b.name));
}

function getOfficeBySlug(slug) {
  const db = readDb();
  return db.offices.find((o) => o.slug === slug && o.active !== false) || null;
}

function getOfficeById(id) {
  const db = readDb();
  return db.offices.find((o) => o.id === id) || null;
}

function createOffice(name, slug) {
  const cleanSlug = slug || slugify(name);
  if (!cleanSlug) throw new Error("Invalid office name");

  const db = readDb();
  if (db.offices.some((o) => o.slug === cleanSlug)) {
    throw new Error("Office slug already exists");
  }

  const office = {
    id: newId(),
    name: name.trim(),
    slug: cleanSlug,
    active: true,
    createdAt: new Date().toISOString(),
  };

  updateDb((d) => {
    d.offices.push(office);
  });

  return office;
}

function createOfficeUser(username, password, officeId) {
  const db = readDb();
  if (db.users.some((u) => u.username.toLowerCase() === username.toLowerCase())) {
    throw new Error("Username already exists");
  }
  if (!getOfficeById(officeId)) {
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

function listUsers() {
  const db = readDb();
  return db.users.map(({ passwordHash, ...user }) => user);
}

function createPayment(record) {
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

function updatePaymentByHash(paymentHash, patch) {
  let updated = null;
  updateDb((db) => {
    const idx = db.payments.findIndex((p) => p.paymentHash === paymentHash);
    if (idx === -1) return;
    db.payments[idx] = { ...db.payments[idx], ...patch };
    updated = db.payments[idx];
  });
  return updated;
}

function getPaymentByHash(paymentHash) {
  const db = readDb();
  return db.payments.find((p) => p.paymentHash === paymentHash) || null;
}

function listPaymentsForOffice(officeId, limit = 100) {
  const db = readDb();
  return db.payments
    .filter((p) => p.officeId === officeId)
    .slice(0, limit);
}

function listAllPayments(limit = 200) {
  const db = readDb();
  return db.payments.slice(0, limit);
}

function getOfficeStats(officeId) {
  const payments = listPaymentsForOffice(officeId, 1000);
  const paid = payments.filter((p) => p.status === "paid");
  return {
    totalPayments: payments.length,
    paidCount: paid.length,
    pendingCount: payments.filter((p) => p.status === "pending").length,
    totalUsd: paid.reduce((sum, p) => sum + (p.amountUsd || 0), 0),
  };
}

module.exports = {
  readDb,
  seedAdmin,
  findUserByUsername,
  verifyPassword,
  createSession,
  getSession,
  deleteSession,
  listOffices,
  getOfficeBySlug,
  getOfficeById,
  createOffice,
  createOfficeUser,
  listUsers,
  createPayment,
  updatePaymentByHash,
  getPaymentByHash,
  listPaymentsForOffice,
  listAllPayments,
  getOfficeStats,
  slugify,
};
