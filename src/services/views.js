const db = require("../../db");

function officePublicView(office) {
  return {
    id: office.id,
    name: office.name,
    slug: office.slug,
    active: office.active !== false,
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

module.exports = { officePublicView, paymentView };
