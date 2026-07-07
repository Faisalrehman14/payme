const crypto = require("crypto");
const { Pool } = require("pg");
const fs = require("fs");
const path = require("path");

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.PGSSLMODE === "disable" ? false : { rejectUnauthorized: false },
});

const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS offices (
  id UUID PRIMARY KEY,
  name TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  commission_percent NUMERIC(5, 2) NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY,
  username TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('admin', 'office')),
  office_id UUID REFERENCES offices(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS sessions (
  token TEXT PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at BIGINT NOT NULL
);

CREATE TABLE IF NOT EXISTS payments (
  id UUID PRIMARY KEY,
  office_id UUID NOT NULL REFERENCES offices(id) ON DELETE CASCADE,
  payment_hash TEXT NOT NULL,
  amount_usd NUMERIC(12, 2) NOT NULL,
  amount_sats INTEGER NOT NULL,
  btc_price NUMERIC(14, 2),
  status TEXT NOT NULL DEFAULT 'pending',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  settled_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_payments_office_created ON payments(office_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_payments_hash ON payments(payment_hash);
CREATE INDEX IF NOT EXISTS idx_sessions_expires ON sessions(expires_at);
`;

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

function mapOffice(row) {
  if (!row) return null;
  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    active: row.active,
    commissionPercent: Number(row.commission_percent || 0),
    createdAt: row.created_at.toISOString(),
  };
}

function mapUser(row) {
  if (!row) return null;
  return {
    id: row.id,
    username: row.username,
    passwordHash: row.password_hash,
    role: row.role,
    officeId: row.office_id,
    createdAt: row.created_at.toISOString(),
  };
}

function mapPayment(row) {
  if (!row) return null;
  return {
    id: row.id,
    officeId: row.office_id,
    paymentHash: row.payment_hash,
    amountUsd: Number(row.amount_usd),
    amountSats: row.amount_sats,
    btcPrice: row.btc_price != null ? Number(row.btc_price) : null,
    status: row.status,
    createdAt: row.created_at.toISOString(),
    settledAt: row.settled_at ? row.settled_at.toISOString() : null,
    expiresAt: row.expires_at ? row.expires_at.toISOString() : null,
  };
}

async function init() {
  await pool.query(SCHEMA_SQL);
  await pool.query(
    "ALTER TABLE offices ADD COLUMN IF NOT EXISTS commission_percent NUMERIC(5, 2) NOT NULL DEFAULT 0"
  );
  await pool.query("DELETE FROM sessions WHERE expires_at <= $1", [Date.now()]);
  await migrateJsonIfNeeded();
  console.log("✓ PostgreSQL connected and schema ready");
}

async function healthCheck() {
  try {
    await pool.query("SELECT 1");
    return { ok: true, backend: "postgres" };
  } catch (err) {
    return { ok: false, backend: "postgres", error: err.message };
  }
}

async function migrateJsonIfNeeded() {
  const dataFile = path.join(process.env.DATA_DIR || path.join(__dirname, "data"), "store.json");
  if (!fs.existsSync(dataFile)) return;

  const { rows } = await pool.query("SELECT COUNT(*)::int AS count FROM offices");
  if (rows[0].count > 0) return;

  let json;
  try {
    json = JSON.parse(fs.readFileSync(dataFile, "utf8"));
  } catch {
    return;
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    for (const office of json.offices || []) {
      await client.query(
        `INSERT INTO offices (id, name, slug, active, created_at)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (id) DO NOTHING`,
        [office.id, office.name, office.slug, office.active !== false, office.createdAt]
      );
    }

    for (const user of json.users || []) {
      await client.query(
        `INSERT INTO users (id, username, password_hash, role, office_id, created_at)
         VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT (id) DO NOTHING`,
        [user.id, user.username, user.passwordHash, user.role, user.officeId, user.createdAt]
      );
    }

    for (const payment of json.payments || []) {
      await client.query(
        `INSERT INTO payments (id, office_id, payment_hash, amount_usd, amount_sats, btc_price, status, created_at, settled_at, expires_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
         ON CONFLICT (id) DO NOTHING`,
        [
          payment.id,
          payment.officeId,
          payment.paymentHash,
          payment.amountUsd,
          payment.amountSats,
          payment.btcPrice ?? null,
          payment.status,
          payment.createdAt,
          payment.settledAt,
          payment.expiresAt,
        ]
      );
    }

    await client.query("COMMIT");
    console.log("✓ Migrated existing JSON data into PostgreSQL");
  } catch (err) {
    await client.query("ROLLBACK");
    console.warn("JSON migration skipped:", err.message);
  } finally {
    client.release();
  }
}

async function createSession(userId, ttlMs = 7 * 24 * 60 * 60 * 1000) {
  const token = crypto.randomBytes(32).toString("hex");
  const expiresAt = Date.now() + ttlMs;
  await pool.query("DELETE FROM sessions WHERE expires_at <= $1", [Date.now()]);
  await pool.query("INSERT INTO sessions (token, user_id, expires_at) VALUES ($1, $2, $3)", [
    token,
    userId,
    expiresAt,
  ]);
  return { token, expiresAt };
}

async function getSession(token) {
  if (!token) return null;
  const { rows } = await pool.query(
    `SELECT s.token, s.user_id, s.expires_at,
            u.id, u.username, u.password_hash, u.role, u.office_id, u.created_at
     FROM sessions s
     JOIN users u ON u.id = s.user_id
     WHERE s.token = $1 AND s.expires_at > $2`,
    [token, Date.now()]
  );
  if (!rows.length) return null;
  const row = rows[0];
  return {
    session: { token: row.token, userId: row.user_id, expiresAt: Number(row.expires_at) },
    user: mapUser(row),
  };
}

async function deleteSession(token) {
  await pool.query("DELETE FROM sessions WHERE token = $1", [token]);
}

async function seedAdmin(username, password) {
  const { rows } = await pool.query("SELECT id FROM users WHERE role = 'admin' LIMIT 1");
  if (rows.length) return null;
  if (!username || !password) return null;

  const id = crypto.randomUUID();
  const passwordHash = hashPassword(password);
  await pool.query(
    `INSERT INTO users (id, username, password_hash, role, office_id)
     VALUES ($1, $2, $3, 'admin', NULL)`,
    [id, username, passwordHash]
  );

  return {
    id,
    username,
    passwordHash,
    role: "admin",
    officeId: null,
    createdAt: new Date().toISOString(),
  };
}

async function findUserByUsername(username) {
  const { rows } = await pool.query(
    "SELECT * FROM users WHERE LOWER(username) = LOWER($1) LIMIT 1",
    [username]
  );
  return mapUser(rows[0]);
}

async function listOffices() {
  const { rows } = await pool.query("SELECT * FROM offices ORDER BY name ASC");
  return rows.map(mapOffice);
}

async function getOfficeBySlug(slug) {
  const { rows } = await pool.query(
    "SELECT * FROM offices WHERE slug = $1 AND active = TRUE LIMIT 1",
    [slug]
  );
  return mapOffice(rows[0]);
}

async function getOfficeById(id) {
  const { rows } = await pool.query("SELECT * FROM offices WHERE id = $1 LIMIT 1", [id]);
  return mapOffice(rows[0]);
}

async function createOffice(name, slug, commissionPercent = 0) {
  const cleanSlug = slug || slugify(name);
  if (!cleanSlug) throw new Error("Invalid office name");
  const pct = Math.min(100, Math.max(0, Number(commissionPercent) || 0));

  const existing = await pool.query("SELECT id FROM offices WHERE slug = $1", [cleanSlug]);
  if (existing.rows.length) throw new Error("Office slug already exists");

  const id = crypto.randomUUID();
  const { rows } = await pool.query(
    `INSERT INTO offices (id, name, slug, active, commission_percent)
     VALUES ($1, $2, $3, TRUE, $4)
     RETURNING *`,
    [id, name.trim(), cleanSlug, pct]
  );
  return mapOffice(rows[0]);
}

async function updateOfficeCommission(officeId, commissionPercent) {
  const office = await getOfficeById(officeId);
  if (!office) throw new Error("Office not found");
  const pct = Math.min(100, Math.max(0, Number(commissionPercent) || 0));
  const { rows } = await pool.query(
    `UPDATE offices SET commission_percent = $1 WHERE id = $2 RETURNING *`,
    [pct, officeId]
  );
  return mapOffice(rows[0]);
}

function netUsd(gross, commissionPercent) {
  return gross * (1 - commissionPercent / 100);
}

async function getDashboardStats(officeId) {
  const office = await getOfficeById(officeId);
  if (!office) throw new Error("Office not found");
  const pct = office.commissionPercent;

  const { rows } = await pool.query(
    `SELECT amount_usd, status, settled_at, created_at
     FROM payments
     WHERE office_id = $1`,
    [officeId]
  );

  const now = new Date();
  const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);

  let todayGross = 0;
  let todayNet = 0;
  let todayCount = 0;
  let monthGross = 0;
  let monthNet = 0;
  let monthCount = 0;

  for (const row of rows) {
    if (row.status !== "paid") continue;
    const gross = Number(row.amount_usd);
    const net = netUsd(gross, pct);
    const paidAt = new Date(row.settled_at || row.created_at);

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
    totalPayments: rows.length,
    paidCount: rows.filter((r) => r.status === "paid").length,
    pendingCount: rows.filter((r) => r.status === "pending").length,
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
  const office = await getOfficeById(officeId);
  if (!office) throw new Error("Office not found");

  const existing = await pool.query(
    "SELECT id FROM users WHERE LOWER(username) = LOWER($1)",
    [username]
  );
  if (existing.rows.length) {
    throw new Error(`Username "${username}" already exists — use a different name or reset that user's password`);
  }

  const id = crypto.randomUUID();
  const { rows } = await pool.query(
    `INSERT INTO users (id, username, password_hash, role, office_id)
     VALUES ($1, $2, $3, 'office', $4)
     RETURNING *`,
    [id, username.trim(), hashPassword(password), officeId]
  );
  return mapUser(rows[0]);
}

async function getUserById(id) {
  const { rows } = await pool.query("SELECT * FROM users WHERE id = $1 LIMIT 1", [id]);
  return mapUser(rows[0]);
}

async function updateOfficeUserPassword(userId, password) {
  const user = await getUserById(userId);
  if (!user || user.role !== "office") throw new Error("Office user not found");
  await pool.query("UPDATE users SET password_hash = $1 WHERE id = $2", [
    hashPassword(password),
    userId,
  ]);
  await pool.query("DELETE FROM sessions WHERE user_id = $1", [userId]);
  return true;
}

async function deleteOfficeUser(userId) {
  const user = await getUserById(userId);
  if (!user || user.role !== "office") throw new Error("Office user not found");
  await pool.query("DELETE FROM users WHERE id = $1", [userId]);
  return true;
}

async function listUsers() {
  const { rows } = await pool.query(
    "SELECT id, username, role, office_id, created_at FROM users ORDER BY created_at DESC"
  );
  return rows.map((row) => ({
    id: row.id,
    username: row.username,
    role: row.role,
    officeId: row.office_id,
    createdAt: row.created_at.toISOString(),
  }));
}

async function createPayment(record) {
  const id = crypto.randomUUID();
  const { rows } = await pool.query(
    `INSERT INTO payments (id, office_id, payment_hash, amount_usd, amount_sats, btc_price, status, expires_at)
     VALUES ($1, $2, $3, $4, $5, $6, 'pending', $7)
     RETURNING *`,
    [
      id,
      record.officeId,
      record.paymentHash,
      record.amountUsd,
      record.amountSats,
      record.btcPrice ?? null,
      record.expiresAt,
    ]
  );
  return mapPayment(rows[0]);
}

async function updatePaymentByHash(paymentHash, patch) {
  const fields = [];
  const values = [];
  let idx = 1;

  if (patch.status !== undefined) {
    fields.push(`status = $${idx++}`);
    values.push(patch.status);
  }
  if (patch.settledAt !== undefined) {
    fields.push(`settled_at = $${idx++}`);
    values.push(patch.settledAt);
  }

  if (!fields.length) return getPaymentByHash(paymentHash);

  values.push(paymentHash);
  const { rows } = await pool.query(
    `UPDATE payments SET ${fields.join(", ")} WHERE payment_hash = $${idx} RETURNING *`,
    values
  );
  return mapPayment(rows[0]);
}

async function getPaymentByHash(paymentHash) {
  const { rows } = await pool.query(
    "SELECT * FROM payments WHERE payment_hash = $1 ORDER BY created_at DESC LIMIT 1",
    [paymentHash]
  );
  return mapPayment(rows[0]);
}

async function listPaymentsForOffice(officeId, limit = 100) {
  const { rows } = await pool.query(
    `SELECT * FROM payments WHERE office_id = $1 ORDER BY created_at DESC LIMIT $2`,
    [officeId, limit]
  );
  return rows.map(mapPayment);
}

async function listAllPayments(limit = 200) {
  const { rows } = await pool.query(
    "SELECT * FROM payments ORDER BY created_at DESC LIMIT $1",
    [limit]
  );
  return rows.map(mapPayment);
}

async function getOfficeStats(officeId) {
  const { rows } = await pool.query(
    `SELECT
       COUNT(*)::int AS total_payments,
       COUNT(*) FILTER (WHERE status = 'paid')::int AS paid_count,
       COUNT(*) FILTER (WHERE status = 'pending')::int AS pending_count,
       COALESCE(SUM(amount_usd) FILTER (WHERE status = 'paid'), 0)::float AS total_usd
     FROM payments
     WHERE office_id = $1`,
    [officeId]
  );
  const row = rows[0];
  return {
    totalPayments: row.total_payments,
    paidCount: row.paid_count,
    pendingCount: row.pending_count,
    totalUsd: Number(row.total_usd),
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
  getOfficeById,
  createOffice,
  updateOfficeCommission,
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
  getOfficeStats,
  slugify,
};
