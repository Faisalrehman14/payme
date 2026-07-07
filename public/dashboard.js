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
const infoCommission = document.getElementById("infoCommission");

const PREF_KEY = "globapay_prefs";

let refreshTimer = null;
let dashboardData = null;
let allPayments = [];
let monthlyData = null;
let selectedTheme = "light";

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

function pct(n) {
  return `${Number(n || 0).toFixed(2)}%`;
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

function paymentRow(p, commission) {
  const gross = Number(p.grossUsd ?? p.amountUsd) || 0;
  const net = Number(p.netUsd ?? gross * (1 - commission / 100));
  return `
    <tr>
      <td>${money(gross)}</td>
      <td>${money(net)}</td>
      <td>${p.method || "Cash App"}</td>
      <td>${fmtTime(p.settledAt || p.createdAt)}</td>
      <td>${statusBadge(p.status)}</td>
    </tr>`;
}

function renderPaymentsTable(tbody, payments, commission, filter = "") {
  const q = filter.trim().toLowerCase();
  const rows = payments.filter((p) => {
    if (!q) return true;
    return p.status.toLowerCase().includes(q) || (p.method || "").toLowerCase().includes(q);
  });

  tbody.innerHTML =
    rows.map((p) => paymentRow(p, commission)).join("") ||
    `<tr><td colspan="5">No payments yet</td></tr>`;
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
  return theme === "dark" ? "Dark Mode" : "Light Mode";
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
  infoCommission.textContent = pct(dashboardData.stats.commissionPercent || 0);
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
  const maxGross = Math.max(...daily.map((d) => d.gross), 1);
  const maxTxn = Math.max(...daily.map((d) => d.transactions), 1);
  const step = (w - pad * 2) / Math.max(daily.length - 1, 1);

  const grossPoints = daily
    .map((d, i) => {
      const x = pad + i * step;
      const y = h - pad - (d.gross / maxGross) * (h - pad * 2);
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
      <polyline fill="none" stroke="#2563eb" stroke-width="2.5" points="${grossPoints}" />
      <polyline fill="none" stroke="#22c55e" stroke-width="2" points="${txnPoints}" />
      ${labels}
      <text x="12" y="16" font-size="11" fill="#2563eb">Revenue ($)</text>
      <text x="100" y="16" font-size="11" fill="#22c55e">Transactions</text>
    </svg>`;
}

function renderMonthly() {
  if (!monthlyData) return;
  const c = monthlyData.commissionPercent || 0;

  document.getElementById("mGross").textContent = money(monthlyData.grossRevenue);
  document.getElementById("mTxnCount").textContent = `${monthlyData.transactionCount} transactions`;
  document.getElementById("mNetLabel").textContent = `Your Balance (After ${pct(c)})`;
  document.getElementById("mNet").textContent = money(monthlyData.netRevenue);
  document.getElementById("mAvg").textContent = money(monthlyData.avgTransaction);
  document.getElementById("mHigh").textContent = money(monthlyData.highest);
  document.getElementById("mLow").textContent = money(monthlyData.lowest);
  document.getElementById("monthlyAfterHeader").textContent = `AFTER ${pct(c)}`;

  drawRevenueChart(monthlyData.dailyBreakdown);

  const method = monthlyData.paymentMethods[0] || {
    name: "Cash App",
    percent: 100,
    gross: 0,
    count: 0,
  };
  document.getElementById("methodBreakdown").innerHTML = `
    <div class="method-row">
      <div>
        <strong>${method.name}</strong>
        <div class="method-meta">${method.percent.toFixed(1)}% of total revenue</div>
      </div>
      <div style="text-align:right">
        <strong>${money(method.gross)}</strong>
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
        <td class="gross-text">${money(d.gross)}</td>
        <td class="net-text">${money(d.net)}</td>
        <td><span class="badge paid">completed</span></td>
      </tr>`
      )
      .join("") || `<tr><td colspan="5">No payments this month</td></tr>`;
}

async function loadMonthly() {
  const month = Number(monthSelect.value);
  const year = Number(yearSelect.value);
  monthlyData = await api(`/api/dashboard/monthly?month=${month}&year=${year}`);
  renderMonthly();
}

function exportMonthlyCsv() {
  if (!monthlyData) return;
  const c = monthlyData.commissionPercent || 0;
  const lines = [
    ["Date", "Transactions", "Gross", `After ${c}%`, "Status"].join(","),
    ...monthlyData.dailyBreakdown.map((d) =>
      [d.date, d.transactions, d.gross.toFixed(2), d.net.toFixed(2), "Completed"].join(",")
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
  const { user, office, payLink, stats } = dashboardData;
  const commission = stats.commissionPercent || 0;

  document.getElementById("greeting").textContent = `${greeting()}, ${user.username}`;
  document.getElementById("userName").textContent = user.username;
  document.getElementById("userAvatar").textContent = user.username.charAt(0).toUpperCase();
  document.getElementById("sidebarCommission").textContent = pct(commission);

  document.getElementById("todayGross").textContent = money(stats.todayGross);
  document.getElementById("todayGrossSub").textContent = `Before ${pct(commission)} commission`;
  document.getElementById("todayNet").textContent = money(stats.todayNet);
  document.getElementById("todayNetTag").textContent = `- ${pct(commission)}`;
  document.getElementById("todayCount").textContent = stats.todayCount;
  document.getElementById("monthNet").textContent = money(stats.monthNet);
  document.getElementById("monthSub").textContent =
    `Gross ${money(stats.monthGross)} · ${stats.monthCount} txns`;

  document.getElementById("bannerCommission").textContent = pct(commission);
  document.getElementById("flowGross").textContent = money(stats.todayGross);
  document.getElementById("flowNet").textContent = money(stats.todayNet);
  document.getElementById("afterPctHeader").textContent = `AFTER ${pct(commission)}`;
  document.getElementById("historyAfterHeader").textContent = `AFTER ${pct(commission)}`;

  const todayPayments = allPayments.filter((p) => isToday(p.settledAt || p.createdAt));
  renderPaymentsTable(
    document.getElementById("todayPaymentsTable"),
    todayPayments,
    commission,
    searchInput.value
  );
  renderPaymentsTable(document.getElementById("historyPaymentsTable"), allPayments, commission);
  renderCheckout();
  renderSettings();
}

async function loadDashboard() {
  const [summary, paymentsData] = await Promise.all([
    api("/api/dashboard/summary"),
    api("/api/dashboard/payments"),
  ]);
  dashboardData = summary;
  allPayments = paymentsData.payments;
  renderDashboard();
  initMonthFilters();
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
      await loadDashboard();
      refreshTimer = setInterval(loadDashboard, 15000);
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
    await loadDashboard();
    refreshTimer = setInterval(loadDashboard, 15000);
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

loginPass.addEventListener("keydown", (e) => {
  if (e.key === "Enter") loginBtn.click();
});
loginUser.addEventListener("keydown", (e) => {
  if (e.key === "Enter") loginBtn.click();
});

applyTheme(loadPrefs().theme);
boot();
