const db = require("../../db");
const { getClientIp } = require("../middleware/auth");

async function logAudit(req, action, { targetType, targetId, details } = {}) {
  const user = req.user || null;
  try {
    await db.createAuditLog({
      userId: user?.id || null,
      username: user?.username || null,
      action,
      targetType: targetType || null,
      targetId: targetId || null,
      details: details || null,
      ip: getClientIp(req),
    });
  } catch (err) {
    console.warn("Audit log failed:", err.message);
  }
}

module.exports = { logAudit };
