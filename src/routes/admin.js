const express = require("express");
const db = require("../../db");
const { requireAuth, requireAdmin, reqBaseUrl } = require("../middleware/auth");
const { officePublicView, paymentView, payoutView } = require("../services/views");
const { logAudit } = require("../services/audit");
const { syncOfficePayments } = require("../services/payment-sync");
const { parseNwcUrl, testPaymentProvider, getPlatformWalletBalance } = require("../services/nwc");
const { getSyncStatus } = require("../worker/sync-worker");
const { getLedgerBalance } = require("../services/ledger-sync");
const {
  validatePasswordStrength,
  validateUsername,
  generateOfficePassword,
} = require("../utils/password");

const router = express.Router();

router.get("/overview", requireAuth, requireAdmin, async (_req, res) => {
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

    const nwc = parseNwcUrl(process.env.NWC_URL || "");
    const paymentProvider = await testPaymentProvider();
    const wallet = await getPlatformWalletBalance().catch((err) => ({
      ok: false,
      balanceSats: null,
      error: err.message,
    }));
    const database = await db.healthCheck();
    const sync = getSyncStatus();

    res.json({
      offices: offices.length,
      activeOffices: offices.filter((o) => o.active !== false).length,
      users: users.length,
      paidCount: paid.length,
      pendingCount: payments.filter((p) => p.status === "pending").length,
      totalRevenue: paid.reduce((sum, p) => sum + (p.amountUsd || 0), 0),
      todayRevenue: todayPaid.reduce((sum, p) => sum + (p.amountUsd || 0), 0),
      todayCount: todayPaid.length,
      recentPayments: payments.slice(0, 8),
      health: {
        nwc: nwc.valid,
        nwcError: nwc.valid ? null : nwc.error,
        paymentProvider: paymentProvider.provider,
        paymentProviderOk: paymentProvider.ok,
        paymentProviderError: paymentProvider.error,
        walletOk: wallet.ok,
        walletBalanceSats: wallet.balanceSats,
        walletError: wallet.error || null,
        database,
        sync,
      },
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get("/offices", requireAuth, requireAdmin, async (req, res) => {
  try {
    const offices = await db.listOffices();
    const staffByOffice = {};
    for (const user of (await db.listUsers()).filter((u) => u.role === "office")) {
      if (!user.officeId) continue;
      if (!staffByOffice[user.officeId]) staffByOffice[user.officeId] = [];
      staffByOffice[user.officeId].push({ id: user.id, username: user.username });
    }
    const result = await Promise.all(
      offices.map(async (office) => ({
        ...officePublicView(office),
        payLink: `${reqBaseUrl(req)}/pay/${office.slug}`,
        staff: staffByOffice[office.id] || [],
        stats: await db.getOfficeStats(office.id),
        payoutBalance: await getLedgerBalance(office.id).catch(() =>
          db.getOfficePayoutBalance(office.id)
        ),
      }))
    );
    res.json({ offices: result });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post("/offices", requireAuth, requireAdmin, async (req, res) => {
  try {
    const { name, slug } = req.body || {};
    if (!name || !name.trim()) {
      return res.status(400).json({ error: "Office name required" });
    }
    const office = await db.createOffice(name.trim(), slug ? slug.trim() : undefined);
    await logAudit(req, "office.create", {
      targetType: "office",
      targetId: office.id,
      details: { name: office.name, slug: office.slug },
    });
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

router.patch("/offices/:id/active", requireAuth, requireAdmin, async (req, res) => {
  try {
    const { active } = req.body || {};
    if (active === undefined || active === null) {
      return res.status(400).json({ error: "Active status required" });
    }
    const office = await db.updateOfficeActive(req.params.id, active);
    await logAudit(req, active ? "office.activate" : "office.deactivate", {
      targetType: "office",
      targetId: office.id,
      details: { name: office.name, slug: office.slug },
    });
    res.json({ office: officePublicView(office) });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.patch("/offices/:id/payouts", requireAuth, requireAdmin, async (req, res) => {
  try {
    const { enabled } = req.body || {};
    if (enabled === undefined || enabled === null) {
      return res.status(400).json({ error: "Payouts enabled status required" });
    }
    const office = await db.updateOfficePayoutsEnabled(req.params.id, enabled);
    await logAudit(req, enabled ? "office.payouts_enable" : "office.payouts_disable", {
      targetType: "office",
      targetId: office.id,
      details: { name: office.name, slug: office.slug, payoutsEnabled: Boolean(enabled) },
    });
    res.json({ office: officePublicView(office) });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.patch("/offices/:id/commission", requireAuth, requireAdmin, async (req, res) => {
  try {
    const { commissionPercent } = req.body || {};
    if (commissionPercent === undefined || commissionPercent === null) {
      return res.status(400).json({ error: "Commission percent required" });
    }
    const office = await db.updateOfficeCommission(req.params.id, commissionPercent);
    await logAudit(req, "office.commission_update", {
      targetType: "office",
      targetId: office.id,
      details: {
        name: office.name,
        slug: office.slug,
        commissionPercent: office.commissionPercent,
      },
    });
    res.json({ office: officePublicView(office) });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.get("/payouts", requireAuth, requireAdmin, async (_req, res) => {
  try {
    const offices = await db.listOffices();
    const officesById = Object.fromEntries(offices.map((o) => [o.id, o]));
    const payouts = (await db.listAllPayouts()).map((p) => payoutView(p, officesById));
    res.json({ payouts });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.delete("/offices/:id", requireAuth, requireAdmin, async (req, res) => {
  try {
    const office = await db.getOfficeById(req.params.id);
    if (!office) return res.status(404).json({ error: "Office not found" });
    await db.deleteOffice(req.params.id);
    await logAudit(req, "office.delete", {
      targetType: "office",
      targetId: office.id,
      details: { name: office.name, slug: office.slug },
    });
    res.json({ ok: true });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.get("/users", requireAuth, requireAdmin, async (req, res) => {
  try {
    const offices = await db.listOffices();
    const officesById = Object.fromEntries(offices.map((o) => [o.id, o]));
    const baseUrl = reqBaseUrl(req);
    const users = (await db.listUsers())
      .filter((u) => u.role === "office")
      .map((u) => {
        const office = officesById[u.officeId];
        return {
          ...u,
          officeName: office?.name || null,
          officeSlug: office?.slug || null,
          payLink: office ? `${baseUrl}/pay/${office.slug}` : null,
        };
      });
    res.json({ users });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post("/users", requireAuth, requireAdmin, async (req, res) => {
  try {
    const { username, password, officeId, generatePassword } = req.body || {};
    if (!username || !officeId) {
      return res.status(400).json({ error: "Username and office required" });
    }

    const usernameCheck = validateUsername(username);
    if (!usernameCheck.ok) {
      return res.status(400).json({ error: usernameCheck.error });
    }

    let plainPassword = password;
    if (generatePassword || !plainPassword) {
      plainPassword = generateOfficePassword();
    }
    const strength = validatePasswordStrength(plainPassword, { minLength: 10 });
    if (!strength.ok) {
      return res.status(400).json({ error: strength.error });
    }

    const user = await db.createOfficeUser(usernameCheck.username, plainPassword, officeId);
    const office = await db.getOfficeById(officeId);
    await logAudit(req, "user.create", {
      targetType: "user",
      targetId: user.id,
      details: { username: user.username, officeId, officeName: office?.name || null },
    });
    const { passwordHash, ...safeUser } = user;
    res.status(201).json({
      user: {
        ...safeUser,
        officeName: office?.name || null,
        officeSlug: office?.slug || null,
        payLink: office ? `${reqBaseUrl(req)}/pay/${office.slug}` : null,
      },
      // Shown once so admin can share credentials with the office
      temporaryPassword: plainPassword,
    });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.post("/users/generate-password", requireAuth, requireAdmin, async (_req, res) => {
  res.json({ password: generateOfficePassword() });
});

router.patch("/users/:id/password", requireAuth, requireAdmin, async (req, res) => {
  try {
    let { password, generatePassword } = req.body || {};
    if (generatePassword || !password) {
      password = generateOfficePassword();
    }
    const strength = validatePasswordStrength(password, { minLength: 10 });
    if (!strength.ok) {
      return res.status(400).json({ error: strength.error });
    }
    await db.updateOfficeUserPassword(req.params.id, password);
    await logAudit(req, "user.password_reset", {
      targetType: "user",
      targetId: req.params.id,
    });
    res.json({ ok: true, temporaryPassword: password });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.delete("/users/:id", requireAuth, requireAdmin, async (req, res) => {
  try {
    await db.deleteOfficeUser(req.params.id);
    await logAudit(req, "user.delete", {
      targetType: "user",
      targetId: req.params.id,
    });
    res.json({ ok: true });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.get("/payments", requireAuth, requireAdmin, async (_req, res) => {
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

router.get("/audit", requireAuth, requireAdmin, async (req, res) => {
  try {
    const limit = Math.min(200, Number(req.query.limit) || 100);
    const logs = await db.listAuditLogs(limit);
    res.json({ logs });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get("/settings", requireAuth, requireAdmin, async (_req, res) => {
  try {
    const settings = await db.getPlatformSettings();
    res.json({ settings });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.patch("/settings", requireAuth, requireAdmin, async (req, res) => {
  try {
    const { contactEmail, contactHeadline, contactMessage } = req.body || {};
    const settings = await db.updatePlatformSettings({
      contactEmail,
      contactHeadline,
      contactMessage,
    });
    await logAudit(req, "settings.update", {
      targetType: "platform",
      targetId: "settings",
      details: { contactEmail: settings.contactEmail },
    });
    res.json({ settings });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

module.exports = router;
