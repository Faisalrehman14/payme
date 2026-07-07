const express = require("express");
const db = require("../../db");
const { requireAuth, requireOffice, reqBaseUrl } = require("../middleware/auth");
const { officePublicView, paymentView } = require("../services/views");
const { syncOfficePayments } = require("../services/payment-sync");

const router = express.Router();

router.get("/summary", requireAuth, requireOffice, async (req, res) => {
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

router.patch("/password", requireAuth, requireOffice, async (req, res) => {
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

module.exports = router;
