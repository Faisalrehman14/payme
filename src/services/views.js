function officePublicView(office) {
  return {
    id: office.id,
    name: office.name,
    slug: office.slug,
    active: office.active !== false,
    payoutsEnabled: office.payoutsEnabled === true,
  };
}

function paymentView(payment, officesById) {
  const office = officesById[payment.officeId];
  const amountUsd = Number(payment.amountUsd) || 0;
  return {
    id: payment.id,
    officeId: payment.officeId,
    officeName: office ? office.name : "Unknown",
    officeSlug: office ? office.slug : null,
    paymentHash: payment.paymentHash,
    amountUsd,
    amountSats: payment.amountSats,
    method: "Cash App",
    status: payment.status,
    createdAt: payment.createdAt,
    settledAt: payment.settledAt,
    expiresAt: payment.expiresAt,
  };
}

function payoutView(payout, officesById) {
  const office = officesById?.[payout.officeId];
  return {
    id: payout.id,
    officeId: payout.officeId,
    officeName: office ? office.name : "Unknown",
    amountUsd: Number(payout.amountUsd) || 0,
    amountSats: payout.amountSats,
    paymentHash: payout.paymentHash,
    status: payout.status,
    errorMessage: payout.errorMessage || null,
    createdAt: payout.createdAt,
    settledAt: payout.settledAt,
  };
}

module.exports = { officePublicView, paymentView, payoutView };
