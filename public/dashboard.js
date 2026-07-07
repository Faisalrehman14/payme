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

let refreshTimer = null;
let dashboardData = null;
let allPayments = [];

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
  return `<span class="badge ${status}">${status}</span>`;
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
      <td>${p.method || "Lightning"}</td>
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

function setView(view) {
  document.querySelectorAll(".view").forEach((el) => el.classList.add("hidden"));
  document.getElementById(`view-${view}`).classList.remove("hidden");
  document.querySelectorAll(".nav-item").forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.view === view);
  });
}

function renderDashboard() {
  if (!dashboardData) return;
  const { user, office, payLink, stats } = dashboardData;
  const commission = stats.commissionPercent || 0;

  document.getElementById("greeting").textContent = `${greeting()}, ${user.username}`;
  document.getElementById("userName").textContent = user.username;
  document.getElementById("userAvatar").textContent = user.username.charAt(0).toUpperCase();
  document.getElementById("sidebarCommission").textContent = pct(commission);
  document.getElementById("payLink").textContent = payLink;

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

  document.getElementById("settingsUser").textContent = user.username;
  document.getElementById("settingsOffice").textContent = office.name;
  document.getElementById("settingsCommission").textContent = pct(commission);

  const todayPayments = allPayments.filter((p) => isToday(p.settledAt || p.createdAt));
  renderPaymentsTable(
    document.getElementById("todayPaymentsTable"),
    todayPayments,
    commission,
    searchInput.value
  );
  renderPaymentsTable(document.getElementById("historyPaymentsTable"), allPayments, commission);
}

async function loadDashboard() {
  const [summary, paymentsData] = await Promise.all([
    api("/api/dashboard/summary"),
    api("/api/dashboard/payments"),
  ]);
  dashboardData = summary;
  allPayments = paymentsData.payments;
  renderDashboard();
}

async function copyPayLink() {
  if (!dashboardData?.payLink) return;
  await navigator.clipboard.writeText(dashboardData.payLink);
  copyLinkBtn.textContent = "Copied!";
  setTimeout(() => {
    copyLinkBtn.textContent = "Copy Payment Link";
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
checkoutCopyBtn.addEventListener("click", copyPayLink);
heroShareBtn.addEventListener("click", copyPayLink);

searchInput.addEventListener("input", () => renderDashboard());

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

boot();
