function officePublicView(office) {
  return {
    id: office.id,
    name: office.name,
    slug: office.slug,
    active: office.active !== false,
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

module.exports = { officePublicView, paymentView };
