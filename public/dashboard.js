const loginSection = document.getElementById("loginSection");
const appSection = document.getElementById("appSection");
const loginUser = document.getElementById("loginUser");
const loginPass = document.getElementById("loginPass");
const loginBtn = document.getElementById("loginBtn");
const loginError = document.getElementById("loginError");
const loginLogoutBtn = document.getElementById("loginLogoutBtn");
const adminNotice = document.getElementById("adminNotice");
const logoutBtn = document.getElementById("logoutBtn");
const officeTitle = document.getElementById("officeTitle");
const payLink = document.getElementById("payLink");
const statsEl = document.getElementById("stats");
const paymentsTable = document.getElementById("paymentsTable");
const refreshBtn = document.getElementById("refreshBtn");

let refreshTimer = null;

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

function fmtTime(iso) {
  if (!iso) return "—";
  return new Date(iso).toLocaleString();
}

function statusBadge(status) {
  return `<span class="badge ${status}">${status}</span>`;
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

async function loadDashboard() {
  const [summary, paymentsData] = await Promise.all([
    api("/api/dashboard/summary"),
    api("/api/dashboard/payments"),
  ]);

  officeTitle.textContent = summary.office.name;
  payLink.textContent = summary.payLink;
  renderStats(summary.stats);

  paymentsTable.innerHTML = paymentsData.payments
    .map(
      (p) => `
      <tr>
        <td>${fmtTime(p.settledAt || p.createdAt)}</td>
        <td>$${Number(p.amountUsd).toFixed(2)}</td>
        <td>${Number(p.amountSats).toLocaleString()}</td>
        <td>${statusBadge(p.status)}</td>
      </tr>`
    )
    .join("") || `<tr><td colspan="4">No payments yet — share your link with customers</td></tr>`;
}

function renderStats(stats) {
  statsEl.innerHTML = `
    <div class="stat"><div class="label">Paid</div><div class="value">${stats.paidCount}</div></div>
    <div class="stat"><div class="label">Pending</div><div class="value">${stats.pendingCount}</div></div>
    <div class="stat"><div class="label">Total USD</div><div class="value">$${stats.totalUsd.toFixed(2)}</div></div>
    <div class="stat"><div class="label">All attempts</div><div class="value">${stats.totalPayments}</div></div>
  `;
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
    if (me.user.role === "admin") {
      showAdminLoggedInNotice();
    }
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
    if (data.user.role !== "office") {
      throw new Error("Office account required");
    }
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

loginPass.addEventListener("keydown", (e) => {
  if (e.key === "Enter") loginBtn.click();
});
loginUser.addEventListener("keydown", (e) => {
  if (e.key === "Enter") loginBtn.click();
});

logoutBtn.addEventListener("click", async () => {
  await api("/api/auth/logout", { method: "POST" });
  showLogin();
});

refreshBtn.addEventListener("click", loadDashboard);

boot();
