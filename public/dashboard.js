const loginSection = document.getElementById("loginSection");
const appSection = document.getElementById("appSection");
const loginUser = document.getElementById("loginUser");
const loginPass = document.getElementById("loginPass");
const loginBtn = document.getElementById("loginBtn");
const loginError = document.getElementById("loginError");
const loginLogoutBtn = document.getElementById("loginLogoutBtn");
const adminNotice = document.getElementById("adminNotice");
const logoutBtn = document.getElementById("logoutBtn");
const copyLinkBtn = document.getElementById("copyLinkBtn");
const checkoutCopyBtn = document.getElementById("checkoutCopyBtn");
const heroShareBtn = document.getElementById("heroShareBtn");
const searchInput = document.getElementById("searchInput");
const monthSelect = document.getElementById("monthSelect");
const yearSelect = document.getElementById("yearSelect");
const monthFilterBtn = document.getElementById("monthFilterBtn");
const exportCsvBtn = document.getElementById("exportCsvBtn");
const checkoutLinkInput = document.getElementById("checkoutLinkInput");
const checkoutOpenBtn = document.getElementById("checkoutOpenBtn");
const checkoutShareBtn = document.getElementById("checkoutShareBtn");
const copyMessageBtn = document.getElementById("copyMessageBtn");
const customerMessage = document.getElementById("customerMessage");
const checkoutQr = document.getElementById("checkoutQr");
const timezoneSelect = document.getElementById("timezoneSelect");
const themeLightBtn = document.getElementById("themeLightBtn");
const themeDarkBtn = document.getElementById("themeDarkBtn");
const savePrefsBtn = document.getElementById("savePrefsBtn");
const prefsMsg = document.getElementById("prefsMsg");
const currentPassword = document.getElementById("currentPassword");
const newPassword = document.getElementById("newPassword");
const confirmPassword = document.getElementById("confirmPassword");
const updatePasswordBtn = document.getElementById("updatePasswordBtn");
const passwordMsg = document.getElementById("passwordMsg");
const infoUsername = document.getElementById("infoUsername");
const infoTimezone = document.getElementById("infoTimezone");
const infoTheme = document.getElementById("infoTheme");
const infoOffice = document.getElementById("infoOffice");

const PREF_KEY = "globapay_prefs";
const REFRESH_MS = 5000;

let refreshTimer = null;
let dashboardData = null;
let allPayments = [];
let monthlyData = null;
let payoutData = null;
let selectedTheme = "light";
let dashboardInitialLoad = false;
let payoutSubmitting = false;
let historyStatusFilter = "all";
let historyTab = "payments";
let payoutStatusFilter = "all";
let currentView = "dashboard";

const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

async function api(path, options = {}) {
  const res = await fetch(path, {
    credentials: "same-origin",
    headers: { "Content-Type": "application/json", ...(options.headers || {}) },
    ...options,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || "Request failed");
  return data;
}

function money(n) {
  return `$${Number(n || 0).toFixed(2)}`;
}

function activeTimezone() {
  return dashboardData?.stats?.timeZone || loadPrefs().timezone || "Asia/Karachi";
}

function dateKeyInTz(iso, timeZone = activeTimezone()) {
  if (!iso) return "";
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date(iso));
  const get = (type) => parts.find((p) => p.type === type)?.value;
  return `${get("year")}-${get("month")}-${get("day")}`;
}

function isToday(iso) {
  return dateKeyInTz(iso) === dateKeyInTz(new Date().toISOString());
}

function fmtTime(iso) {
  if (!iso) return "—";
  return new Date(iso).toLocaleString(undefined, {
    timeZone: activeTimezone(),
    year: "numeric",
    month: "numeric",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
  });
}

function displayName(username) {
  const raw = String(username || "").trim();
  if (!raw) return "—";
  return raw
    .split(/[\s._-]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
    .join(" ");
}

function initialsFromName(username) {
  const parts = String(username || "")
    .trim()
    .split(/[\s._-]+/)
    .filter(Boolean);
  if (parts.length >= 2) {
    return (parts[0][0] + parts[1][0]).toUpperCase();
  }
  const s = parts[0] || "GP";
  return s.slice(0, 2).toUpperCase();
}

function badgeIcon(kind) {
  const common =
    'class="badge-ico" viewBox="0 0 16 16" width="12" height="12" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"';
  if (kind === "paid") {
    return `<svg ${common}><path d="M3.5 8.5 6.5 11.5 12.5 4.5"/></svg>`;
  }
  if (kind === "pending") {
    return `<svg ${common}><circle cx="8" cy="8" r="5.5"/><path d="M8 5v3.2L10 10"/></svg>`;
  }
  return `<svg ${common}><path d="M5 5l6 6M11 5l-6 6"/></svg>`;
}

function statusBadge(status) {
  const key = status === "paid" ? "paid" : status;
  const label =
    status === "paid"
      ? "Succeeded"
      : status === "pending"
        ? "Pending"
        : status === "expired"
          ? "Expired"
          : status;
  const iconKind =
    status === "paid" ? "paid" : status === "pending" ? "pending" : "expired";
  return `<span class="badge ${key}">${badgeIcon(iconKind)}<span class="badge-label">${label}</span></span>`;
}

function greeting() {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: activeTimezone(),
    hour: "numeric",
    hourCycle: "h23",
  }).formatToParts(new Date());
  const h = Number(parts.find((p) => p.type === "hour")?.value || 0);
  if (h < 12) return "Good morning";
  if (h < 17) return "Good afternoon";
  return "Good evening";
}

function showLogin() {
  loginSection.classList.remove("hidden");
  appSection.classList.add("hidden");
  dashboardInitialLoad = false;
  if (refreshTimer) {
    clearInterval(refreshTimer);
    refreshTimer = null;
  }
}

function showApp() {
  loginSection.classList.add("hidden");
  appSection.classList.remove("hidden");
  adminNotice.classList.add("hidden");
  loginLogoutBtn.classList.add("hidden");
  applyTheme(loadPrefs().theme);
}

function showAdminLoggedInNotice() {
  adminNotice.classList.remove("hidden");
  loginLogoutBtn.classList.remove("hidden");
}

function shortId(p) {
  const raw = p.paymentHash || p.id || "";
  if (!raw) return "—";
  return raw.length > 14 ? `${raw.slice(0, 8)}…${raw.slice(-4)}` : raw;
}

function paymentKey(p) {
  return p.id || p.paymentHash || "";
}

function escapeHtml(str) {
  return String(str ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function fmtTxnDate(iso) {
  if (!iso) return "—";
  return new Date(iso).toLocaleString(undefined, {
    timeZone: activeTimezone(),
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function fmtDetailDate(iso) {
  if (!iso) return "—";
  return new Date(iso).toLocaleString(undefined, {
    timeZone: activeTimezone(),
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function paymentRow(p, { rich = false } = {}) {
  const amount = Number(p.amountUsd) || 0;
  const key = escapeHtml(paymentKey(p));
  if (!rich) {
    return `
    <tr class="txn-row" data-payment-id="${key}">
      <td><span class="txn-amount">${money(amount)}</span></td>
      <td>${statusBadge(p.status)}</td>
      <td><span class="method-pill">${p.method || "Cash App"}</span></td>
      <td class="txn-date">${fmtTxnDate(p.settledAt || p.createdAt)}</td>
    </tr>`;
  }
  return `
    <tr class="txn-row" data-payment-id="${key}">
      <td>
        <div class="txn-amount-cell">
          <strong>${money(amount)}</strong>
          <span>USD</span>
        </div>
      </td>
      <td>
        <div class="method-cell">
          <span class="method-mark" aria-hidden="true">$</span>
          <span>${p.method || "Cash App"}</span>
        </div>
      </td>
      <td>
        <code class="txn-id">${escapeHtml(shortId(p))}</code>
      </td>
      <td class="txn-date">${fmtTxnDate(p.settledAt || p.createdAt)}</td>
      <td>${statusBadge(p.status)}</td>
    </tr>`;
}

function renderPaymentsTable(tbody, payments, filter = "", { rich = false, emptyColspan = 4 } = {}) {
  if (!tbody) return 0;
  const q = filter.trim().toLowerCase();
  const rows = payments.filter((p) => {
    if (!q) return true;
    const hay = [p.status, p.method, String(p.amountUsd || ""), p.paymentHash || "", p.id || ""]
      .join(" ")
      .toLowerCase();
    return hay.includes(q);
  });

  tbody.innerHTML =
    rows.map((p) => paymentRow(p, { rich })).join("") ||
    `<tr><td colspan="${emptyColspan}"><div class="empty-state">No payments match this filter.</div></td></tr>`;
  return rows.length;
}

function loadPrefs() {
  try {
    const prefs = JSON.parse(localStorage.getItem(PREF_KEY));
    return prefs || { timezone: "Asia/Karachi", theme: "light" };
  } catch {
    return { timezone: "Asia/Karachi", theme: "light" };
  }
}

function savePrefs(prefs) {
  localStorage.setItem(PREF_KEY, JSON.stringify(prefs));
}

function timezoneLabel(tz) {
  return tz === "UTC" ? "UTC" : "GMT+5";
}

function themeLabel(theme) {
  return theme === "dark" ? "Dark" : "Light";
}

function applyTheme(theme) {
  selectedTheme = theme;
  document.body.classList.toggle("dashboard-dark", theme === "dark");
  themeLightBtn.classList.toggle("active", theme === "light");
  themeDarkBtn.classList.toggle("active", theme === "dark");
}

function renderSettings() {
  if (!dashboardData) return;
  const prefs = loadPrefs();
  timezoneSelect.value = prefs.timezone;
  applyTheme(prefs.theme);
  infoUsername.textContent = dashboardData.user.username;
  infoTimezone.textContent = timezoneLabel(prefs.timezone);
  infoTheme.textContent = themeLabel(prefs.theme);
  if (infoOffice) infoOffice.textContent = dashboardData.office?.name || "—";
}

function buildCustomerMessage(link) {
  return `Use this link to pay:

${link}

1. Open the payment link
2. Select the amount
3. Pay via Cash App
4. Complete the payment`;
}

function renderCheckout() {
  if (!dashboardData?.payLink) return;
  const link = dashboardData.payLink;
  checkoutLinkInput.value = link;
  customerMessage.textContent = buildCustomerMessage(link);
  checkoutQr.src = `https://api.qrserver.com/v1/create-qr-code/?size=220x220&data=${encodeURIComponent(link)}`;
}

function setView(view) {
  currentView = view || "dashboard";
  document.querySelectorAll(".view").forEach((el) => el.classList.add("hidden"));
  const target = document.getElementById(`view-${currentView}`);
  if (target) target.classList.remove("hidden");

  const onHistoryShell = currentView === "history" || currentView === "payment";
  document.querySelectorAll(".nav-item").forEach((btn) => {
    if (btn.id === "navPayouts") {
      btn.classList.toggle("active", onHistoryShell && historyTab === "payouts");
    } else if (btn.dataset.view === "history") {
      btn.classList.toggle("active", onHistoryShell && historyTab !== "payouts");
    } else {
      btn.classList.toggle("active", btn.dataset.view === currentView);
    }
  });

  if (currentView === "monthly") loadMonthly();
  if (currentView === "checkout") renderCheckout();
  if (currentView === "settings") renderSettings();
  if (currentView === "payouts") loadPayouts();
  if (currentView === "history") {
    // Paint the correct tab immediately (don't wait on payout fetch)
    renderHistoryView();
    if (historyTab === "payouts") {
      loadPayouts().then(() => renderHistoryView());
    }
  }
}

let selectedPaymentId = null;

function findPaymentByKey(key) {
  if (!key) return null;
  return (
    allPayments.find((p) => p.id === key || p.paymentHash === key) || null
  );
}

function paymentTimeline(p) {
  const items = [
    {
      tone: "neutral",
      title: "Payment started",
      detail: "Customer opened Cash App checkout",
      at: p.createdAt,
    },
  ];
  if (p.status === "paid") {
    items.push({
      tone: "success",
      title: `Payment using ${p.method || "Cash App"} succeeded`,
      detail: `${money(p.amountUsd)} received`,
      at: p.settledAt || p.createdAt,
    });
  } else if (p.status === "expired") {
    items.push({
      tone: "muted",
      title: "Payment expired",
      detail: "Invoice timed out before settlement",
      at: p.expiresAt || p.createdAt,
    });
  } else {
    items.push({
      tone: "pending",
      title: "Awaiting payment",
      detail: "Waiting for the customer to complete Cash App Pay",
      at: p.createdAt,
    });
  }
  return items.reverse();
}

function renderPaymentDetail(p) {
  if (!p) return;
  selectedPaymentId = paymentKey(p);
  const amount = money(p.amountUsd);
  const fullId = p.paymentHash || p.id || "—";

  setText("pdAmount", amount);
  const badgeHost = document.getElementById("pdStatusBadge");
  if (badgeHost) badgeHost.innerHTML = statusBadge(p.status);
  const asideStatus = document.getElementById("pdAsideStatus");
  if (asideStatus) asideStatus.innerHTML = statusBadge(p.status);

  setText("pdSummaryId", shortId(p));
  setText("pdSummaryMethod", p.method || "Cash App");
  setText("pdSummaryAmount", amount);
  setText("pdSummaryTotal", amount);
  setText("pdPaymentId", fullId.length > 28 ? `${fullId.slice(0, 18)}…${fullId.slice(-6)}` : fullId);
  const idEl = document.getElementById("pdPaymentId");
  if (idEl) idEl.title = fullId;
  setText("pdMethod", p.method || "Cash App");
  setText("pdOffice", p.officeName || dashboardData?.office?.name || "—");
  setText("pdCreated", fmtDetailDate(p.createdAt));
  setText("pdUpdated", fmtDetailDate(p.settledAt || p.createdAt));
  setText("pdExpires", fmtDetailDate(p.expiresAt));

  const breakdown = document.getElementById("pdBreakdown");
  if (breakdown) {
    const sats = Number(p.amountSats) || 0;
    breakdown.innerHTML = `
      <div><dt>Gross amount</dt><dd>${amount}</dd></div>
      <div><dt>Lightning amount</dt><dd>${sats ? `${sats.toLocaleString()} sats` : "—"}</dd></div>
      <div><dt>Payment method</dt><dd>${escapeHtml(p.method || "Cash App")}</dd></div>
      <div class="pd-breakdown-total"><dt>Net</dt><dd>${amount}</dd></div>`;
  }

  const timeline = document.getElementById("pdTimeline");
  if (timeline) {
    timeline.innerHTML = paymentTimeline(p)
      .map(
        (item) => `
      <li class="pd-timeline-item tone-${item.tone}">
        <span class="pd-timeline-dot" aria-hidden="true"></span>
        <div class="pd-timeline-body">
          <div class="pd-timeline-top">
            <strong>${escapeHtml(item.title)}</strong>
            <time>${fmtDetailDate(item.at)}</time>
          </div>
          <p>${escapeHtml(item.detail)}</p>
        </div>
      </li>`
      )
      .join("");
  }
}

function openPaymentDetail(key) {
  const payment = findPaymentByKey(key);
  if (!payment) return;
  renderPaymentDetail(payment);
  setView("payment");
}

async function copyPaymentId() {
  const payment = findPaymentByKey(selectedPaymentId);
  const value = payment?.paymentHash || payment?.id || selectedPaymentId;
  if (!value) return;
  try {
    await navigator.clipboard.writeText(value);
    const btn = document.getElementById("pdCopyIdBtn");
    if (btn) {
      const prev = btn.textContent;
      btn.textContent = "Copied!";
      setTimeout(() => {
        btn.textContent = prev;
      }, 1600);
    }
  } catch {
    /* ignore */
  }
}

function syncPayoutNav() {
  const nav = document.getElementById("navPayouts");
  const payoutsTab = document.getElementById("historyPayoutsTab");
  const enabled = Boolean(dashboardData?.office?.payoutsEnabled);
  if (nav) nav.classList.toggle("hidden", !enabled);
  if (payoutsTab) payoutsTab.classList.toggle("hidden", !enabled);
  if (!enabled && getCurrentView() === "payouts") {
    setView("dashboard");
  }
  if (!enabled && historyTab === "payouts") {
    historyTab = "payments";
    renderHistoryView();
  }
}

function payoutStatusBadge(status) {
  const map = {
    paid: { className: "paid", label: "Paid", icon: "paid" },
    pending: { className: "pending", label: "Pending", icon: "pending" },
    failed: { className: "expired", label: "Failed", icon: "expired" },
  };
  const info = map[status] || { className: status, label: status, icon: "pending" };
  return `<span class="badge ${info.className}">${badgeIcon(info.icon)}<span class="badge-label">${info.label}</span></span>`;
}

function renderPayouts() {
  if (!payoutData) return;
  const { balance, payouts } = payoutData;
  document.getElementById("payoutAvailable").textContent = money(balance.availableUsd);
  document.getElementById("payoutEarned").textContent = money(balance.totalEarnedUsd);
  document.getElementById("payoutWithdrawn").textContent = money(balance.totalWithdrawnUsd);

  const feeEl = document.getElementById("payoutFee");
  const feeSub = document.getElementById("payoutFeeSub");
  const availSub = document.getElementById("payoutAvailableSub");
  if (feeEl) feeEl.textContent = money(balance.platformFeeUsd || 0);
  if (feeSub) {
    feeSub.textContent = `${Number(balance.commissionPercent || 0).toFixed(1)}% platform fee`;
  }
  if (availSub) {
    const keep = (100 - Number(balance.commissionPercent || 0)).toFixed(1);
    availSub.textContent = `Your share (${keep}%) minus withdrawals`;
  }

  const tbody = document.getElementById("payoutHistoryTable");
  if (!tbody) return;
  tbody.innerHTML =
    (payouts || [])
      .map((p) => {
        const amount = Number(p.amountUsd) || 0;
        return `
      <tr>
        <td>
          <div class="txn-amount-cell">
            <strong>${money(amount)}</strong>
            <span>USD</span>
          </div>
        </td>
        <td class="txn-date">${Number(p.amountSats || 0).toLocaleString()} sats</td>
        <td class="txn-date">${fmtTxnDate(p.settledAt || p.createdAt)}</td>
        <td>${payoutStatusBadge(p.status)}${
          p.errorMessage ? `<div class="sub">${escapeHtml(p.errorMessage)}</div>` : ""
        }</td>
      </tr>`;
      })
      .join("") ||
    `<tr><td colspan="4"><div class="empty-state">No payouts yet.</div></td></tr>`;
}

async function loadPayouts() {
  if (!dashboardData?.office?.payoutsEnabled) return;
  try {
    payoutData = await api("/api/dashboard/payouts");
    renderPayouts();
    if (historyTab === "payouts") renderHistoryView();
  } catch (err) {
    const errEl = document.getElementById("payoutError");
    if (errEl) errEl.textContent = err.message;
  }
}

function initMonthFilters() {
  const now = new Date();
  monthSelect.innerHTML = MONTH_NAMES.map(
    (name, i) => `<option value="${i + 1}" ${i === now.getMonth() ? "selected" : ""}>${name}</option>`
  ).join("");
  const currentYear = now.getFullYear();
  yearSelect.innerHTML = [currentYear - 1, currentYear, currentYear + 1]
    .map((y) => `<option value="${y}" ${y === currentYear ? "selected" : ""}>${y}</option>`)
    .join("");
}

function fmtDateShort(iso) {
  const d = new Date(iso + "T12:00:00");
  return d.toLocaleDateString(undefined, { day: "2-digit", month: "short", year: "numeric" });
}

function drawRevenueChart(daily) {
  const el = document.getElementById("revenueChart");
  if (!daily.length) {
    el.innerHTML = '<p class="sub">No data for this month</p>';
    return;
  }

  const w = 640;
  const h = 200;
  const pad = 36;
  const maxTotal = Math.max(...daily.map((d) => d.total), 1);
  const maxTxn = Math.max(...daily.map((d) => d.transactions), 1);
  const step = (w - pad * 2) / Math.max(daily.length - 1, 1);

  const revenuePoints = daily
    .map((d, i) => {
      const x = pad + i * step;
      const y = h - pad - (d.total / maxTotal) * (h - pad * 2);
      return `${x},${y}`;
    })
    .join(" ");

  const txnPoints = daily
    .map((d, i) => {
      const x = pad + i * step;
      const y = h - pad - (d.transactions / maxTxn) * (h - pad * 2);
      return `${x},${y}`;
    })
    .join(" ");

  const labels = daily
    .map((d, i) => {
      const x = pad + i * step;
      const label = d.date.slice(8, 10);
      return `<text x="${x}" y="${h - 8}" text-anchor="middle" font-size="10" fill="#64748b">${label}</text>`;
    })
    .join("");

  el.innerHTML = `
    <svg viewBox="0 0 ${w} ${h}" width="100%" height="220">
      <polyline fill="none" stroke="#2563eb" stroke-width="2.5" points="${revenuePoints}" />
      <polyline fill="none" stroke="#22c55e" stroke-width="2" points="${txnPoints}" />
      ${labels}
      <text x="12" y="16" font-size="11" fill="#2563eb">Revenue ($)</text>
      <text x="100" y="16" font-size="11" fill="#22c55e">Transactions</text>
    </svg>`;
}

function renderMonthly() {
  if (!monthlyData) return;

  document.getElementById("mTotal").textContent = money(monthlyData.totalRevenue);
  document.getElementById("mTxnCount").textContent = `${monthlyData.transactionCount} transactions`;
  document.getElementById("mAvg").textContent = money(monthlyData.avgTransaction);
  document.getElementById("mHigh").textContent = money(monthlyData.highest);
  document.getElementById("mLow").textContent = money(monthlyData.lowest);

  drawRevenueChart(monthlyData.dailyBreakdown);

  const method = monthlyData.paymentMethods[0] || {
    name: "Cash App",
    percent: 100,
    total: 0,
    count: 0,
  };
  document.getElementById("methodBreakdown").innerHTML = `
    <div class="method-row">
      <div>
        <strong>${method.name}</strong>
        <div class="method-meta">${method.percent.toFixed(1)}% of total revenue</div>
      </div>
      <div style="text-align:right">
        <strong>${money(method.total)}</strong>
        <div class="method-meta">${method.count} payments</div>
      </div>
      <div class="method-bar"><span style="width:100%"></span></div>
    </div>`;

  document.getElementById("monthlyDailyTable").innerHTML =
    monthlyData.dailyBreakdown
      .map(
        (d) => `
      <tr>
        <td>${fmtDateShort(d.date)}</td>
        <td><span class="txn-link">${d.transactions}</span></td>
        <td class="gross-text">${money(d.total)}</td>
        <td><span class="badge paid">completed</span></td>
      </tr>`
      )
      .join("") || `<tr><td colspan="4">No payments this month</td></tr>`;
}

async function loadMonthly() {
  const month = Number(monthSelect.value);
  const year = Number(yearSelect.value);
  monthlyData = await api(`/api/dashboard/monthly?month=${month}&year=${year}`);
  renderMonthly();
}

function exportMonthlyCsv() {
  if (!monthlyData) return;
  const lines = [
    ["Date", "Transactions", "Total", "Status"].join(","),
    ...monthlyData.dailyBreakdown.map((d) =>
      [d.date, d.transactions, d.total.toFixed(2), "Completed"].join(",")
    ),
  ];
  const blob = new Blob([lines.join("\n")], { type: "text/csv" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `globa-pay-${monthlyData.year}-${String(monthlyData.month).padStart(2, "0")}.csv`;
  a.click();
  URL.revokeObjectURL(a.href);
}

function isYesterday(iso) {
  const todayKey = dateKeyInTz(new Date().toISOString());
  const [y, m, d] = todayKey.split("-").map(Number);
  const prev = new Date(Date.UTC(y, m - 1, d) - 24 * 60 * 60 * 1000);
  const yKey = `${prev.getUTCFullYear()}-${String(prev.getUTCMonth() + 1).padStart(2, "0")}-${String(prev.getUTCDate()).padStart(2, "0")}`;
  return dateKeyInTz(iso) === yKey;
}

function chartUid() {
  return `c${Math.random().toString(36).slice(2, 9)}`;
}

function smoothLinePath(points) {
  if (!points.length) return "";
  if (points.length === 1) return `M ${points[0].x} ${points[0].y}`;
  let d = `M ${points[0].x} ${points[0].y}`;
  for (let i = 0; i < points.length - 1; i += 1) {
    const p0 = points[i === 0 ? i : i - 1];
    const p1 = points[i];
    const p2 = points[i + 1];
    const p3 = points[i + 2] || p2;
    const cp1x = p1.x + (p2.x - p0.x) / 6;
    const cp1y = p1.y + (p2.y - p0.y) / 6;
    const cp2x = p2.x - (p3.x - p1.x) / 6;
    const cp2y = p2.y - (p3.y - p1.y) / 6;
    d += ` C ${cp1x} ${cp1y}, ${cp2x} ${cp2y}, ${p2.x} ${p2.y}`;
  }
  return d;
}

function renderProChart(options = {}) {
  const {
    values = [],
    labels = [],
    color = "#1d4ed8",
    height = 140,
    mode = "area",
    formatTip = (v) => String(v),
    showYAxis = true,
  } = options;
  const nums = values.length ? values.map((v) => Number(v) || 0) : [0, 0];
  const id = chartUid();
  const w = 560;
  const h = height;
  const padL = showYAxis ? 44 : 8;
  const padR = 10;
  const padT = 14;
  const padB = labels.length ? 26 : 12;
  const max = Math.max(...nums, 0.0001);
  const min = 0;
  const span = Math.max(max - min, 0.0001);
  const innerW = w - padL - padR;
  const innerH = h - padT - padB;
  const n = nums.length;
  const step = innerW / Math.max(n - 1, 1);

  const points = nums.map((v, i) => ({
    x: padL + (n === 1 ? innerW / 2 : i * step),
    y: padT + innerH - ((v - min) / span) * innerH,
    v,
    label: labels[i] || "",
  }));

  const yTicks = [0, 0.5, 1].map((t) => {
    const val = min + span * t;
    const y = padT + innerH * (1 - t);
    const tip = formatTip(val);
    let axisLabel = String(Math.round(val));
    if (String(tip).startsWith("$")) {
      axisLabel = val >= 1000 ? `$${(val / 1000).toFixed(1)}k` : `$${Math.round(val)}`;
    }
    return { y, axisLabel };
  });

  const grid = yTicks
    .map(
      ({ y, axisLabel }) => `
      <line x1="${padL}" y1="${y}" x2="${w - padR}" y2="${y}" stroke="currentColor" stroke-opacity="0.08" stroke-width="1" />
      ${
        showYAxis
          ? `<text x="${padL - 8}" y="${y + 3}" text-anchor="end" class="chart-axis">${axisLabel}</text>`
          : ""
      }`
    )
    .join("");

  const baselineY = padT + innerH;

  if (mode === "bars") {
    const gap = Math.min(10, innerW / n / 3);
    const barW = Math.max(3, innerW / n - gap);
    const bars = points
      .map((p, i) => {
        const x = padL + (i + 0.5) * (innerW / n) - barW / 2;
        const barH = Math.max(2, ((nums[i] - min) / span) * innerH);
        const y = baselineY - barH;
        const active = nums[i] > 0;
        return `<rect class="chart-bar${active ? " is-active" : ""}" x="${x}" y="${y}" width="${barW}" height="${barH}" rx="2.5"
          fill="url(#${id}bar)" fill-opacity="${active ? 1 : 0.16}">
          <title>${p.label ? `${p.label}: ` : ""}${formatTip(nums[i])}</title>
        </rect>`;
      })
      .join("");

    const xLabels = labels
      .map((label, i) => {
        if (!label) return "";
        const show = n <= 12 || i % Math.ceil(n / 6) === 0 || i === n - 1;
        if (!show) return "";
        const x = padL + (i + 0.5) * (innerW / n);
        return `<text x="${x}" y="${h - 6}" text-anchor="middle" class="chart-axis">${label}</text>`;
      })
      .join("");

    return `
      <div class="pro-chart">
        <svg viewBox="0 0 ${w} ${h}" width="100%" height="${h}" role="img">
          <defs>
            <linearGradient id="${id}bar" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stop-color="${color}"/>
              <stop offset="100%" stop-color="${color}" stop-opacity="0.55"/>
            </linearGradient>
          </defs>
          ${grid}
          <line x1="${padL}" y1="${baselineY}" x2="${w - padR}" y2="${baselineY}" stroke="currentColor" stroke-opacity="0.14" />
          ${bars}
          ${xLabels}
        </svg>
      </div>`;
  }

  const line = smoothLinePath(points);
  const area = `${line} L ${points[points.length - 1].x} ${baselineY} L ${points[0].x} ${baselineY} Z`;
  const last = points[points.length - 1];
  const dots = points
    .filter((p) => p.v > 0)
    .map(
      (p) =>
        `<circle cx="${p.x}" cy="${p.y}" r="3" fill="#fff" stroke="${color}" stroke-width="2">
          <title>${p.label ? `${p.label}: ` : ""}${formatTip(p.v)}</title>
        </circle>`
    )
    .join("");

  const xLabels = labels
    .map((label, i) => {
      if (!label) return "";
      const show = n <= 8 || i % Math.ceil(n / 5) === 0 || i === n - 1 || i === 0;
      if (!show) return "";
      return `<text x="${points[i].x}" y="${h - 6}" text-anchor="middle" class="chart-axis">${label}</text>`;
    })
    .join("");

  return `
    <div class="pro-chart">
      <svg viewBox="0 0 ${w} ${h}" width="100%" height="${h}" role="img">
        <defs>
          <linearGradient id="${id}fill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stop-color="${color}" stop-opacity="0.22"/>
            <stop offset="75%" stop-color="${color}" stop-opacity="0.05"/>
            <stop offset="100%" stop-color="${color}" stop-opacity="0"/>
          </linearGradient>
        </defs>
        ${grid}
        <line x1="${padL}" y1="${baselineY}" x2="${w - padR}" y2="${baselineY}" stroke="currentColor" stroke-opacity="0.14" />
        <path d="${area}" fill="url(#${id}fill)" />
        <path d="${line}" fill="none" stroke="${color}" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" />
        ${dots}
        <circle cx="${last.x}" cy="${last.y}" r="4" fill="${color}" />
        <circle cx="${last.x}" cy="${last.y}" r="7.5" fill="${color}" fill-opacity="0.12" />
        ${xLabels}
      </svg>
    </div>`;
}

function hourBucketsForDay(payments) {
  const buckets = Array.from({ length: 24 }, () => 0);
  for (const p of payments) {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: activeTimezone(),
      hour: "numeric",
      hourCycle: "h23",
    }).formatToParts(new Date(p.settledAt || p.createdAt));
    const hour = Number(parts.find((x) => x.type === "hour")?.value || 0);
    buckets[hour] += Number(p.amountUsd) || 0;
  }
  return buckets;
}

function hourLabels() {
  return Array.from({ length: 24 }, (_, h) => (h % 6 === 0 ? `${h}:00` : ""));
}

function lastNDayTotals(n = 14) {
  const days = [];
  const now = new Date();
  for (let i = n - 1; i >= 0; i -= 1) {
    const d = new Date(now);
    d.setDate(now.getDate() - i);
    const key = dateKeyInTz(d.toISOString());
    const label = new Date(key + "T12:00:00").toLocaleDateString(undefined, {
      month: "short",
      day: "numeric",
    });
    days.push({ key, total: 0, count: 0, label });
  }
  const byKey = Object.fromEntries(days.map((d) => [d.key, d]));
  for (const p of allPayments) {
    if (p.status !== "paid") continue;
    const key = dateKeyInTz(p.settledAt || p.createdAt);
    if (byKey[key]) {
      byKey[key].total += Number(p.amountUsd) || 0;
      byKey[key].count += 1;
    }
  }
  return days;
}

function renderHomeOverview() {
  const paidToday = allPayments.filter(
    (p) => p.status === "paid" && isToday(p.settledAt || p.createdAt)
  );
  const paidYesterday = allPayments.filter(
    (p) => p.status === "paid" && isYesterday(p.settledAt || p.createdAt)
  );
  const yesterdayTotal = paidYesterday.reduce((s, p) => s + (Number(p.amountUsd) || 0), 0);
  const delta = (dashboardData?.stats?.todayTotal || 0) - yesterdayTotal;
  const deltaLabel =
    yesterdayTotal === 0 && delta === 0
      ? "No activity yesterday"
      : `${delta >= 0 ? "+" : ""}${money(delta)} vs yesterday`;
  setText("todayVsYesterday", deltaLabel);
  setText("todayCountChip", `${paidToday.length} payment${paidToday.length === 1 ? "" : "s"}`);

  const todayChart = document.getElementById("todayVolumeChart");
  if (todayChart) {
    const hours = hourBucketsForDay(paidToday);
    const nonZero = hours.filter((v) => v > 0).length;
    todayChart.innerHTML = renderProChart({
      values: hours,
      labels: hourLabels(),
      color: "#1d4ed8",
      height: 168,
      mode: nonZero <= 6 ? "bars" : "area",
      formatTip: (v) => money(v),
    });
  }

  const daySeries = lastNDayTotals(14);
  const monthChart = document.getElementById("homeMonthChart");
  if (monthChart) {
    monthChart.innerHTML = renderProChart({
      values: daySeries.map((d) => d.total),
      labels: daySeries.map((d) => d.label),
      color: "#1d4ed8",
      height: 110,
      mode: "area",
      formatTip: (v) => money(v),
      showYAxis: false,
    });
  }
  const todayCountChart = document.getElementById("homeTodayCountChart");
  if (todayCountChart) {
    todayCountChart.innerHTML = renderProChart({
      values: daySeries.map((d) => d.count),
      labels: daySeries.map((d) => d.label),
      color: "#0f766e",
      height: 110,
      mode: "area",
      formatTip: (v) => `${v} txns`,
      showYAxis: false,
    });
  }

  const succeeded = allPayments.filter((p) => p.status === "paid");
  const pending = allPayments.filter((p) => p.status === "pending");
  const expired = allPayments.filter((p) => p.status === "expired");
  const succeededAmt = succeeded.reduce((s, p) => s + (Number(p.amountUsd) || 0), 0);
  const pendingAmt = pending.reduce((s, p) => s + (Number(p.amountUsd) || 0), 0);
  const expiredAmt = expired.reduce((s, p) => s + (Number(p.amountUsd) || 0), 0);
  const totalAmt = Math.max(succeededAmt + pendingAmt + expiredAmt, 0.0001);
  const sPct = (succeededAmt / totalAmt) * 100;
  const pPct = (pendingAmt / totalAmt) * 100;
  const ePct = (expiredAmt / totalAmt) * 100;

  const bar = document.getElementById("homePaymentsBar");
  if (bar) {
    const seg = (cls, pct, amt, label) =>
      `<span class="seg ${cls}${pct <= 0 ? " is-empty" : ""}" style="flex:${pct > 0 ? Math.max(pct, 2.5) : 0} 1 0" title="${label} ${money(amt)}"></span>`;
    bar.innerHTML = `
      ${seg("succeeded", sPct, succeededAmt, "Succeeded")}
      ${seg("pending", pPct, pendingAmt, "Pending")}
      ${seg("expired", ePct, expiredAmt, "Expired")}`;
  }
  const legend = document.getElementById("homePaymentsLegend");
  if (legend) {
    legend.innerHTML = `
      <div>
        <div class="legend-left"><i class="dot succeeded"></i><span>Succeeded</span></div>
        <strong>${money(succeededAmt)}</strong>
      </div>
      <div>
        <div class="legend-left"><i class="dot pending"></i><span>Pending</span></div>
        <strong>${money(pendingAmt)}</strong>
      </div>
      <div>
        <div class="legend-left"><i class="dot expired"></i><span>Expired</span></div>
        <strong>${money(expiredAmt)}</strong>
      </div>`;
  }

  setText("pendingCountPill", `${pending.length} pending`);
  setText("homeExpiredTotal", money(expiredAmt));
  setText(
    "homeAvgTicket",
    money(succeeded.length ? succeededAmt / succeeded.length : 0)
  );
  setText("homeCashAppShare", "Cash App");

  const bal = dashboardData?.payoutBalance || payoutData?.balance;
  if (bal) {
    setText("homeAvailable", money(bal.availableUsd));
    setText(
      "homeAvailableSub",
      `${Number(bal.commissionPercent || 0).toFixed(1)}% fee · your withdrawable share`
    );
  } else if (dashboardData?.office?.payoutsEnabled) {
    setText("homeAvailable", "—");
    setText("homeAvailableSub", "Loading balance…");
  } else {
    setText("homeAvailable", money(dashboardData?.stats?.monthTotal || 0));
    setText("homeAvailableSub", "Month revenue · payouts not enabled");
  }

  const recent = [...allPayments]
    .sort(
      (a, b) =>
        new Date(b.settledAt || b.createdAt) - new Date(a.settledAt || a.createdAt)
    )
    .slice(0, 5);
  const recentEl = document.getElementById("homeRecentList");
  if (recentEl) {
    recentEl.innerHTML =
      recent
        .map(
          (p) => `
        <div class="home-recent-row is-clickable" data-payment-id="${escapeHtml(paymentKey(p))}" role="button" tabindex="0">
          <div>
            <strong>${money(p.amountUsd)}</strong>
            <span>${fmtTxnDate(p.settledAt || p.createdAt)}</span>
          </div>
          ${statusBadge(p.status)}
        </div>`
        )
        .join("") || `<div class="empty-state">No recent payments yet.</div>`;
  }
}

function setText(id, value) {
  const el = document.getElementById(id);
  if (el) el.textContent = value;
}

function exportHistoryCsv() {
  if (historyTab === "payouts") {
    const payouts = payoutData?.payouts || [];
    const lines = [
      ["Amount", "Sats", "Status", "Date", "Error"].join(","),
      ...payouts.map((p) =>
        [
          Number(p.amountUsd || 0).toFixed(2),
          p.amountSats || 0,
          p.status,
          p.settledAt || p.createdAt || "",
          (p.errorMessage || "").replace(/,/g, " "),
        ].join(",")
      ),
    ];
    const blob = new Blob([lines.join("\n")], { type: "text/csv" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `globa-pay-payouts-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
    return;
  }

  const lines = [
    ["Amount", "Method", "Status", "Date", "PaymentHash"].join(","),
    ...allPayments.map((p) =>
      [
        Number(p.amountUsd || 0).toFixed(2),
        p.method || "Cash App",
        p.status,
        p.settledAt || p.createdAt || "",
        p.paymentHash || p.id || "",
      ].join(",")
    ),
  ];
  const blob = new Blob([lines.join("\n")], { type: "text/csv" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `globa-pay-transactions-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(a.href);
}

function payoutRow(p) {
  const amount = Number(p.amountUsd) || 0;
  return `
    <tr>
      <td>
        <div class="txn-amount-cell">
          <strong>${money(amount)}</strong>
          <span>USD</span>
        </div>
      </td>
      <td>${payoutStatusBadge(p.status)}${
        p.errorMessage ? `<div class="sub">${p.errorMessage}</div>` : ""
      }</td>
      <td>Lightning payout</td>
      <td class="txn-date">${Number(p.amountSats || 0).toLocaleString()} sats</td>
      <td class="txn-date">${fmtTxnDate(p.settledAt || p.createdAt)}</td>
    </tr>`;
}

function renderHistoryView() {
  const paymentsPanel = document.getElementById("historyPaymentsPanel");
  const payoutsPanel = document.getElementById("historyPayoutsPanel");
  const paymentSummary = document.getElementById("historySummary");
  const payoutSummary = document.getElementById("payoutSummary");
  const withdrawBtn = document.getElementById("historyWithdrawBtn");
  const searchInputEl = document.getElementById("historySearchInput");
  const showPayouts = historyTab === "payouts";

  document.querySelectorAll("[data-history-tab]").forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.historyTab === historyTab);
  });

  if (paymentsPanel) paymentsPanel.classList.toggle("hidden", showPayouts);
  if (payoutsPanel) payoutsPanel.classList.toggle("hidden", !showPayouts);
  if (paymentSummary) paymentSummary.classList.toggle("hidden", showPayouts);
  if (payoutSummary) payoutSummary.classList.toggle("hidden", !showPayouts);
  if (withdrawBtn) {
    withdrawBtn.classList.toggle(
      "hidden",
      !showPayouts || !dashboardData?.office?.payoutsEnabled
    );
  }
  if (searchInputEl) {
    searchInputEl.placeholder = showPayouts
      ? "Filter payouts by amount or status…"
      : "Filter by amount, status, or ID…";
  }

  // Keep sidebar highlighting correct while on payouts / payments tabs
  const onHistoryShell = currentView === "history" || currentView === "payment";
  document.querySelectorAll(".nav-item").forEach((btn) => {
    if (btn.id === "navPayouts") {
      btn.classList.toggle("active", onHistoryShell && showPayouts);
    } else if (btn.dataset.view === "history") {
      btn.classList.toggle("active", onHistoryShell && !showPayouts);
    }
  });

  if (showPayouts) {
    const payouts = payoutData?.payouts || [];
    const paid = payouts.filter((p) => p.status === "paid").length;
    const pending = payouts.filter((p) => p.status === "pending").length;
    const failed = payouts.filter((p) => p.status === "failed").length;
    setText("payoutCountAll", String(payouts.length));
    setText("payoutCountPaid", String(paid));
    setText("payoutCountPending", String(pending));
    setText("payoutCountFailed", String(failed));

    document.querySelectorAll("[data-payout-filter]").forEach((btn) => {
      btn.classList.toggle("active", btn.dataset.payoutFilter === payoutStatusFilter);
    });

    let list = payouts;
    if (payoutStatusFilter !== "all") {
      list = list.filter((p) => p.status === payoutStatusFilter);
    }

    const q = (
      document.getElementById("historySearchInput")?.value ||
      document.getElementById("globalSearchInput")?.value ||
      ""
    )
      .trim()
      .toLowerCase();
    if (q) {
      list = list.filter((p) =>
        [p.status, String(p.amountUsd || ""), String(p.amountSats || ""), p.errorMessage || ""]
          .join(" ")
          .toLowerCase()
          .includes(q)
      );
    }

    const tbody = document.getElementById("historyPayoutsTable");
    if (tbody) {
      tbody.innerHTML =
        list.map((p) => payoutRow(p)).join("") ||
        `<tr><td colspan="5"><div class="empty-state">No payouts yet.</div></td></tr>`;
    }
    setText(
      "payoutRangeLabel",
      list.length ? `Showing ${list.length} items` : "Showing 0 items"
    );
    return;
  }

  const paid = allPayments.filter((p) => p.status === "paid").length;
  const pending = allPayments.filter((p) => p.status === "pending").length;
  const expired = allPayments.filter((p) => p.status === "expired").length;
  setText("histCountAll", String(allPayments.length));
  setText("histCountPaid", String(paid));
  setText("histCountPending", String(pending));
  setText("histCountExpired", String(expired));

  document.querySelectorAll("[data-history-filter]").forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.historyFilter === historyStatusFilter);
  });

  let list = allPayments;
  if (historyStatusFilter !== "all") {
    list = list.filter((p) => p.status === historyStatusFilter);
  }

  const historySearch = document.getElementById("historySearchInput");
  const globalSearch = document.getElementById("globalSearchInput");
  const q = (historySearch?.value || globalSearch?.value || "").trim();
  const shown = renderPaymentsTable(
    document.getElementById("historyPaymentsTable"),
    list,
    q,
    { rich: true, emptyColspan: 5 }
  );
  setText(
    "historyRangeLabel",
    shown ? `Showing ${shown} of ${list.length} items` : `Showing 0 of ${list.length} items`
  );
}

function renderDashboard() {
  if (!dashboardData) return;
  const { user, office, stats } = dashboardData;

  document.getElementById("greeting").textContent = `${greeting()}, ${displayName(user.username)}`;
  setText("sidebarOfficeName", office?.name || "Office");
  setText("sidebarUserName", displayName(user.username));

  const livePill = document.getElementById("livePill");
  if (livePill) {
    livePill.textContent = `Live · ${new Date().toLocaleTimeString(undefined, {
      timeZone: activeTimezone(),
      hour: "numeric",
      minute: "2-digit",
      second: "2-digit",
    })}`;
  }

  document.getElementById("todayTotal").textContent = money(stats.todayTotal);
  document.getElementById("todayCount").textContent = stats.todayCount;
  document.getElementById("monthTotal").textContent = money(stats.monthTotal);
  document.getElementById("monthSub").textContent = `${stats.monthCount} txns this month`;
  document.getElementById("pendingCount").textContent = stats.pendingCount;

  const todayPayments = allPayments
    .filter((p) => p.status === "paid" && isToday(p.settledAt || p.createdAt))
    .sort(
      (a, b) =>
        new Date(b.settledAt || b.createdAt) - new Date(a.settledAt || a.createdAt)
    );
  renderPaymentsTable(
    document.getElementById("todayPaymentsTable"),
    todayPayments,
    searchInput?.value || ""
  );
  renderHomeOverview();
  renderHistoryView();
  renderCheckout();
  renderSettings();
  syncPayoutNav();

  if (dashboardData.payoutBalance) {
    payoutData = {
      balance: dashboardData.payoutBalance,
      payouts: payoutData?.payouts || [],
    };
    renderHomeOverview();
    if (getCurrentView() === "payouts" || historyTab === "payouts") {
      renderPayouts();
      if (historyTab === "payouts") renderHistoryView();
    }
  } else if (office?.payoutsEnabled) {
    loadPayouts().then(() => renderHomeOverview());
  }
}

function setDashboardLoading() {
  if (dashboardInitialLoad) return;
  document.querySelectorAll("#view-dashboard .home-metric, #todayTotal").forEach((el) => {
    el.classList.add("is-loading");
  });
}

function clearDashboardLoading() {
  document.querySelectorAll("#view-dashboard .is-loading").forEach((el) => {
    el.classList.remove("is-loading");
  });
}

async function loadDashboard({ showLoading = false } = {}) {
  if (showLoading || !dashboardInitialLoad) {
    setDashboardLoading();
  }
  try {
    const [summary, paymentsData] = await Promise.all([
      api("/api/dashboard/summary"),
      api("/api/dashboard/payments"),
    ]);
    dashboardData = summary;
    allPayments = paymentsData.payments;
    renderDashboard();
    if (!dashboardInitialLoad) {
      initMonthFilters();
    }
    dashboardInitialLoad = true;
  } finally {
    clearDashboardLoading();
  }
}

function getCurrentView() {
  return currentView || "dashboard";
}

async function refreshAll() {
  await loadDashboard({ showLoading: false });
  const view = getCurrentView();
  if (view === "monthly") await loadMonthly();
  if (view === "payouts") await loadPayouts();
}

function startAutoRefresh() {
  if (refreshTimer) clearInterval(refreshTimer);
  refreshTimer = setInterval(refreshAll, REFRESH_MS);
}

async function copyPayLink() {
  if (!dashboardData?.payLink) return;
  await navigator.clipboard.writeText(dashboardData.payLink);
  copyLinkBtn.textContent = "Copied!";
  setTimeout(() => {
    copyLinkBtn.textContent = "Copy Payment Link";
  }, 2000);
}

async function copyCheckoutLink() {
  if (!dashboardData?.payLink) return;
  await navigator.clipboard.writeText(dashboardData.payLink);
  checkoutCopyBtn.textContent = "Copied!";
  setTimeout(() => {
    checkoutCopyBtn.textContent = "Copy";
  }, 2000);
}

async function copyCustomerMessage() {
  if (!dashboardData?.payLink) return;
  await navigator.clipboard.writeText(buildCustomerMessage(dashboardData.payLink));
  copyMessageBtn.textContent = "Copied!";
  setTimeout(() => {
    copyMessageBtn.textContent = "Copy Message";
  }, 2000);
}

async function boot() {
  try {
    const me = await api("/api/auth/me");
    if (me.user.role === "office") {
      showApp();
      await loadDashboard({ showLoading: true });
      startAutoRefresh();
      return;
    }
    showLogin();
    if (me.user.role === "admin") showAdminLoggedInNotice();
  } catch {
    showLogin();
  }
}

loginBtn.addEventListener("click", async () => {
  loginError.textContent = "";
  try {
    const data = await api("/api/auth/login", {
      method: "POST",
      body: JSON.stringify({
        username: loginUser.value.trim(),
        password: loginPass.value,
      }),
    });
    if (data.user.role === "admin") {
      loginError.textContent = "This is an admin account. Use /admin instead.";
      showAdminLoggedInNotice();
      return;
    }
    if (data.user.role !== "office") throw new Error("Office account required");
    showApp();
    await loadDashboard({ showLoading: true });
    startAutoRefresh();
  } catch (err) {
    showLogin();
    loginError.textContent = err.message;
  }
});

loginLogoutBtn.addEventListener("click", async () => {
  await api("/api/auth/logout", { method: "POST" });
  adminNotice.classList.add("hidden");
  loginLogoutBtn.classList.add("hidden");
  loginError.textContent = "";
  loginUser.value = "";
  loginPass.value = "";
});

logoutBtn.addEventListener("click", async () => {
  await api("/api/auth/logout", { method: "POST" });
  showLogin();
});

copyLinkBtn.addEventListener("click", copyPayLink);
checkoutCopyBtn.addEventListener("click", copyCheckoutLink);
copyMessageBtn.addEventListener("click", copyCustomerMessage);
checkoutOpenBtn.addEventListener("click", () => {
  if (dashboardData?.payLink) window.open(dashboardData.payLink, "_blank");
});
checkoutShareBtn.addEventListener("click", async () => {
  if (!dashboardData?.payLink) return;
  const text = buildCustomerMessage(dashboardData.payLink);
  if (navigator.share) {
    try {
      await navigator.share({ title: "Globa Pay", text, url: dashboardData.payLink });
      return;
    } catch {
      // fall through to copy
    }
  }
  await navigator.clipboard.writeText(text);
  checkoutShareBtn.textContent = "Copied!";
  setTimeout(() => {
    checkoutShareBtn.textContent = "Share";
  }, 2000);
});
heroShareBtn.addEventListener("click", copyPayLink);

if (searchInput) {
  searchInput.addEventListener("input", () => renderDashboard());
}

const historySearchInput = document.getElementById("historySearchInput");
const globalSearchInput = document.getElementById("globalSearchInput");
if (historySearchInput) {
  historySearchInput.addEventListener("input", () => renderHistoryView());
}
if (globalSearchInput) {
  globalSearchInput.addEventListener("input", () => {
    if (historySearchInput) historySearchInput.value = globalSearchInput.value;
    renderHistoryView();
  });
}

document.querySelectorAll("[data-history-filter]").forEach((btn) => {
  btn.addEventListener("click", () => {
    historyStatusFilter = btn.dataset.historyFilter || "all";
    renderHistoryView();
  });
});

document.getElementById("paymentDetailBack")?.addEventListener("click", () => {
  setView("history");
});
document.getElementById("pdCopyIdBtn")?.addEventListener("click", copyPaymentId);
document.getElementById("pdCopyHashBtn")?.addEventListener("click", copyPaymentId);

// Whole payment row opens detail (history, today, home recent)
document.addEventListener("click", (e) => {
  const row = e.target.closest?.("tr.txn-row[data-payment-id], .home-recent-row[data-payment-id]");
  if (!row) return;
  const key = row.getAttribute("data-payment-id");
  if (!key) return;
  openPaymentDetail(key);
});

document.querySelectorAll("[data-history-tab]").forEach((btn) => {
  btn.addEventListener("click", async () => {
    historyTab = btn.dataset.historyTab || "payments";
    if (historyTab === "payouts") {
      await loadPayouts();
    }
    if (getCurrentView() !== "history") setView("history");
    else renderHistoryView();
  });
});

document.querySelectorAll("[data-payout-filter]").forEach((btn) => {
  btn.addEventListener("click", () => {
    payoutStatusFilter = btn.dataset.payoutFilter || "all";
    renderHistoryView();
  });
});

document.getElementById("historyWithdrawBtn")?.addEventListener("click", () => {
  setView("payouts");
});

["historyShareBtn"].forEach((id) => {
  document.getElementById(id)?.addEventListener("click", copyPayLink);
});
["historyExportBtn", "historyExportBtn2"].forEach((id) => {
  document.getElementById(id)?.addEventListener("click", exportHistoryCsv);
});

monthFilterBtn.addEventListener("click", loadMonthly);
exportCsvBtn.addEventListener("click", exportMonthlyCsv);

themeLightBtn.addEventListener("click", () => applyTheme("light"));
themeDarkBtn.addEventListener("click", () => applyTheme("dark"));

savePrefsBtn.addEventListener("click", () => {
  const prefs = { timezone: timezoneSelect.value, theme: selectedTheme };
  savePrefs(prefs);
  renderSettings();
  prefsMsg.style.color = "#16a34a";
  prefsMsg.textContent = "Preferences saved";
});

updatePasswordBtn.addEventListener("click", async () => {
  passwordMsg.textContent = "";
  passwordMsg.style.color = "#dc2626";
  if (newPassword.value !== confirmPassword.value) {
    passwordMsg.textContent = "New passwords do not match";
    return;
  }
  if (newPassword.value.length < 10) {
    passwordMsg.textContent = "New password must be at least 10 characters";
    return;
  }
  try {
    await api("/api/dashboard/password", {
      method: "PATCH",
      body: JSON.stringify({
        currentPassword: currentPassword.value,
        newPassword: newPassword.value,
      }),
    });
    currentPassword.value = "";
    newPassword.value = "";
    confirmPassword.value = "";
    passwordMsg.style.color = "#16a34a";
    passwordMsg.textContent = "Password updated successfully";
  } catch (err) {
    passwordMsg.textContent = err.message;
  }
});

document.querySelectorAll(".nav-item").forEach((btn) => {
  btn.addEventListener("click", () => {
    if (btn.id === "navPayouts" || btn.dataset.historyOpen === "payouts") {
      historyTab = "payouts";
    } else if (btn.dataset.view === "history") {
      historyTab = "payments";
    } else if (btn.dataset.historyOpen) {
      historyTab = btn.dataset.historyOpen;
    }
    setView(btn.dataset.view);
  });
});

document.querySelectorAll("[data-view-jump]").forEach((btn) => {
  btn.addEventListener("click", () => {
    if (btn.dataset.historyOpen) {
      historyTab = btn.dataset.historyOpen;
    }
    setView(btn.dataset.viewJump);
  });
});

const requestPayoutBtn = document.getElementById("requestPayoutBtn");
const payoutInvoice = document.getElementById("payoutInvoice");
const payoutError = document.getElementById("payoutError");
const payoutSuccess = document.getElementById("payoutSuccess");

requestPayoutBtn?.addEventListener("click", async () => {
  if (payoutSubmitting) return;
  payoutError.textContent = "";
  payoutSuccess.textContent = "";
  const invoice = (payoutInvoice?.value || "").trim();
  if (!invoice) {
    payoutError.textContent = "Paste a Lightning invoice first";
    return;
  }

  payoutSubmitting = true;
  requestPayoutBtn.disabled = true;
  requestPayoutBtn.textContent = "Sending…";
  try {
    const data = await api("/api/dashboard/payouts", {
      method: "POST",
      body: JSON.stringify({ invoice }),
    });
    payoutInvoice.value = "";
    payoutSuccess.textContent = `Payout of ${money(data.payout.amountUsd)} sent successfully.`;
    payoutData = {
      balance: data.balance,
      payouts: [data.payout, ...(payoutData?.payouts || [])],
    };
    if (dashboardData) dashboardData.payoutBalance = data.balance;
    renderPayouts();
    historyTab = "payouts";
    setView("history");
    await loadDashboard({ showLoading: false });
  } catch (err) {
    payoutError.textContent = err.message;
  } finally {
    payoutSubmitting = false;
    requestPayoutBtn.disabled = false;
    requestPayoutBtn.textContent = "Withdraw now";
  }
});

loginPass.addEventListener("keydown", (e) => {
  if (e.key === "Enter") loginBtn.click();
});
loginUser.addEventListener("keydown", (e) => {
  if (e.key === "Enter") loginBtn.click();
});

applyTheme(loadPrefs().theme);

document.addEventListener("visibilitychange", () => {
  if (!document.hidden && appSection && !appSection.classList.contains("hidden")) {
    refreshAll();
  }
});

boot();
