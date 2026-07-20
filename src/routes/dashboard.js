const express = require("express");
const db = require("../../db");
const { requireAuth, requireOffice, reqBaseUrl } = require("../middleware/auth");
const { officePublicView, paymentView, payoutView } = require("../services/views");
const { syncOfficePayments } = require("../services/payment-sync");
const {
  getPayoutBalance,
  listOfficePayouts,
  requestOfficePayout,
} = require("../services/payouts");
const { logAudit } = require("../services/audit");
const { validatePasswordStrength } = require("../utils/password");

const router = express.Router();

router.get("/summary", requireAuth, requireOffice, async (req, res) => {
  try {
    const office = await db.getOfficeById(req.user.officeId);
    if (!office) return res.status(404).json({ error: "Office not found" });

    await syncOfficePayments(office.id);

    const payload = {
      user: { username: req.user.username },
      office: officePublicView(office),
      payLink: `${reqBaseUrl(req)}/pay/${office.slug}`,
      stats: await db.getDashboardStats(office.id),
    };

    if (office.payoutsEnabled) {
      payload.payoutBalance = await getPayoutBalance(office.id);
    }

    res.json(payload);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get("/payments", requireAuth, requireOffice, async (req, res) => {
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

router.get("/monthly", requireAuth, requireOffice, async (req, res) => {
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

router.get("/payouts", requireAuth, requireOffice, async (req, res) => {
  try {
    const office = await db.getOfficeById(req.user.officeId);
    if (!office) return res.status(404).json({ error: "Office not found" });
    if (!office.payoutsEnabled) {
      return res.status(403).json({ error: "Payouts are not enabled for this office" });
    }

    const [balance, payouts] = await Promise.all([
      getPayoutBalance(office.id),
      listOfficePayouts(office.id),
    ]);

    res.json({
      balance,
      payouts: payouts.map((p) => payoutView(p)),
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post("/payouts", requireAuth, requireOffice, async (req, res) => {
  try {
    const { invoice } = req.body || {};
    if (!invoice || !String(invoice).trim()) {
      return res.status(400).json({ error: "Lightning invoice is required" });
    }

    const result = await requestOfficePayout({
      officeId: req.user.officeId,
      userId: req.user.id,
      invoice,
    });

    await logAudit(req, "payout.create", {
      targetType: "payout",
      targetId: result.payout.id,
      details: {
        amountUsd: result.payout.amountUsd,
        amountSats: result.payout.amountSats,
        status: result.payout.status,
      },
    });

    res.json({
      payout: payoutView(result.payout),
      balance: result.balance,
    });
  } catch (err) {
    const msg = err.message || "Payout failed";
    const status =
      /not enabled|insufficient|expired|invalid|minimum|already used|required/i.test(msg)
        ? 400
        : 500;
    res.status(status).json({ error: msg });
  }
});

router.patch("/password", requireAuth, requireOffice, async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body || {};
    if (!currentPassword || !newPassword) {
      return res.status(400).json({ error: "Current and new password required" });
    }
    const strength = validatePasswordStrength(newPassword, { minLength: 10 });
    if (!strength.ok) {
      return res.status(400).json({ error: strength.error });
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

module.exports = router;
