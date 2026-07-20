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

function fmtTime(iso) {
  if (!iso) return "—";
  return new Date(iso).toLocaleString();
}

function statusBadge(status) {
  const label = status === "paid" ? "completed" : status;
  return `<span class="badge ${status === "paid" ? "paid" : status}">${label}</span>`;
}

function greeting() {
  const h = new Date().getHours();
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

function isToday(iso) {
  const d = new Date(iso);
  const now = new Date();
  return (
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate()
  );
}

function paymentRow(p) {
  const amount = Number(p.amountUsd) || 0;
  return `
    <tr>
      <td>${money(amount)}</td>
      <td>${p.method || "Cash App"}</td>
      <td>${fmtTime(p.settledAt || p.createdAt)}</td>
      <td>${statusBadge(p.status)}</td>
    </tr>`;
}

function renderPaymentsTable(tbody, payments, filter = "") {
  const q = filter.trim().toLowerCase();
  const rows = payments.filter((p) => {
    if (!q) return true;
    return p.status.toLowerCase().includes(q) || (p.method || "").toLowerCase().includes(q);
  });

  tbody.innerHTML =
    rows.map((p) => paymentRow(p)).join("") ||
    `<tr><td colspan="4"><div class="empty-state"><div class="empty-state-icon">📭</div>No payments yet — share your checkout link to get started.</div></td></tr>`;
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
  document.querySelectorAll(".view").forEach((el) => el.classList.add("hidden"));
  document.getElementById(`view-${view}`).classList.remove("hidden");
  document.querySelectorAll(".nav-item").forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.view === view);
  });
  if (view === "monthly") loadMonthly();
  if (view === "checkout") renderCheckout();
  if (view === "settings") renderSettings();
  if (view === "payouts") loadPayouts();
}

function syncPayoutNav() {
  const nav = document.getElementById("navPayouts");
  if (!nav) return;
  const enabled = Boolean(dashboardData?.office?.payoutsEnabled);
  nav.classList.toggle("hidden", !enabled);
  if (!enabled && getCurrentView() === "payouts") {
    setView("dashboard");
  }
}

function payoutStatusBadge(status) {
  const map = {
    paid: { className: "paid", label: "completed" },
    pending: { className: "pending", label: "pending" },
    failed: { className: "expired", label: "failed" },
  };
  const info = map[status] || { className: status, label: status };
  return `<span class="badge ${info.className}">${info.label}</span>`;
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
  tbody.innerHTML =
    (payouts || [])
      .map(
        (p) => `
      <tr>
        <td>${money(p.amountUsd)}</td>
        <td>${Number(p.amountSats || 0).toLocaleString()} sats</td>
        <td>${fmtTime(p.settledAt || p.createdAt)}</td>
        <td>${payoutStatusBadge(p.status)}${
          p.errorMessage ? `<div class="sub">${p.errorMessage}</div>` : ""
        }</td>
      </tr>`
      )
      .join("") ||
    `<tr><td colspan="4"><div class="empty-state"><div class="empty-state-icon">💸</div>No payouts yet.</div></td></tr>`;
}

async function loadPayouts() {
  if (!dashboardData?.office?.payoutsEnabled) return;
  try {
    payoutData = await api("/api/dashboard/payouts");
    renderPayouts();
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

function renderDashboard() {
  if (!dashboardData) return;
  const { user, office, stats } = dashboardData;

  document.getElementById("greeting").textContent = `${greeting()}, ${user.username}`;
  document.getElementById("userName").textContent = user.username;
  document.getElementById("userAvatar").textContent = user.username.charAt(0).toUpperCase();

  const topbarOffice = document.getElementById("topbarOfficeName");
  if (topbarOffice) topbarOffice.textContent = office?.name || "—";

  const livePill = document.getElementById("livePill");
  if (livePill) livePill.textContent = `Live · ${new Date().toLocaleTimeString()}`;

  document.getElementById("todayTotal").textContent = money(stats.todayTotal);
  document.getElementById("todayCount").textContent = stats.todayCount;
  document.getElementById("monthTotal").textContent = money(stats.monthTotal);
  document.getElementById("monthSub").textContent = `${stats.monthCount} txns this month`;
  document.getElementById("pendingCount").textContent = stats.pendingCount;

  const todayPayments = allPayments.filter((p) => isToday(p.settledAt || p.createdAt));
  renderPaymentsTable(
    document.getElementById("todayPaymentsTable"),
    todayPayments,
    searchInput.value
  );
  renderPaymentsTable(document.getElementById("historyPaymentsTable"), allPayments);
  renderCheckout();
  renderSettings();
  syncPayoutNav();
  if (dashboardData.payoutBalance) {
    payoutData = {
      balance: dashboardData.payoutBalance,
      payouts: payoutData?.payouts || [],
    };
    if (getCurrentView() === "payouts") {
      renderPayouts();
    }
  }
}

function setDashboardLoading() {
  if (dashboardInitialLoad) return;
  document.querySelectorAll("#view-dashboard .stat-value").forEach((el) => {
    el.classList.add("is-loading");
    el.dataset.prev = el.textContent;
    el.innerHTML = '<span class="stat-skeleton" aria-hidden="true"></span>';
  });
}

function clearDashboardLoading() {
  document.querySelectorAll("#view-dashboard .stat-value.is-loading").forEach((el) => {
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
  const active = document.querySelector(".nav-item.active");
  return active?.dataset.view || "dashboard";
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

searchInput.addEventListener("input", () => renderDashboard());

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
  if (newPassword.value.length < 8) {
    passwordMsg.textContent = "New password must be at least 8 characters";
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
  btn.addEventListener("click", () => setView(btn.dataset.view));
});

document.querySelectorAll("[data-view-jump]").forEach((btn) => {
  btn.addEventListener("click", () => setView(btn.dataset.viewJump));
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
    await loadDashboard({ showLoading: false });
  } catch (err) {
    payoutError.textContent = err.message;
  } finally {
    payoutSubmitting = false;
    requestPayoutBtn.disabled = false;
    requestPayoutBtn.textContent = "Withdraw Now";
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
