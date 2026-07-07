const loginSection = document.getElementById("loginSection");
const appSection = document.getElementById("appSection");
const loginUser = document.getElementById("loginUser");
const loginPass = document.getElementById("loginPass");
const loginBtn = document.getElementById("loginBtn");
const loginError = document.getElementById("loginError");
const logoutBtn = document.getElementById("logoutBtn");
const refreshBtn = document.getElementById("refreshBtn");
const liveBadge = document.getElementById("liveBadge");
const adminName = document.getElementById("adminName");
const adminAvatar = document.getElementById("adminAvatar");
const overviewStats = document.getElementById("overviewStats");
const recentPaymentsTable = document.getElementById("recentPaymentsTable");
const systemStats = document.getElementById("systemStats");
const paymentSearch = document.getElementById("paymentSearch");

const officeName = document.getElementById("officeName");
const officeSlug = document.getElementById("officeSlug");
const officeCommission = document.getElementById("officeCommission");
const createOfficeBtn = document.getElementById("createOfficeBtn");
const officeError = document.getElementById("officeError");
const officeSuccess = document.getElementById("officeSuccess");
const officesTable = document.getElementById("officesTable");

const userOffice = document.getElementById("userOffice");
const userName = document.getElementById("userName");
const userPass = document.getElementById("userPass");
const createUserBtn = document.getElementById("createUserBtn");
const userError = document.getElementById("userError");
const userSuccess = document.getElementById("userSuccess");
const usersTable = document.getElementById("usersTable");
const paymentsTable = document.getElementById("paymentsTable");

let refreshTimer = null;
let allPayments = [];
const REFRESH_MS = 10000;

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

function setView(view) {
  document.querySelectorAll(".admin-view").forEach((el) => el.classList.add("hidden"));
  document.getElementById(`view-${view}`).classList.remove("hidden");
  document.querySelectorAll(".admin-nav .nav-item").forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.view === view);
  });
}

function showLogin() {
  loginSection.classList.remove("hidden");
  appSection.classList.add("hidden");
  stopRefresh();
}

function showApp() {
  loginSection.classList.add("hidden");
  appSection.classList.remove("hidden");
}

function stopRefresh() {
  if (refreshTimer) {
    clearInterval(refreshTimer);
    refreshTimer = null;
  }
}

function startRefresh() {
  stopRefresh();
  refreshTimer = setInterval(loadAll, REFRESH_MS);
}

function renderOverview(overview) {
  overviewStats.innerHTML = `
    <div class="stat-card"><div class="stat-label">Offices</div><div class="stat-value">${overview.offices}</div></div>
    <div class="stat-card"><div class="stat-label">Staff Users</div><div class="stat-value">${overview.users}</div></div>
    <div class="stat-card"><div class="stat-label">Today's Revenue</div><div class="stat-value">${money(overview.todayRevenue)}</div></div>
    <div class="stat-card"><div class="stat-label">Total Revenue</div><div class="stat-value">${money(overview.totalRevenue)}</div></div>
    <div class="stat-card"><div class="stat-label">Paid</div><div class="stat-value">${overview.paidCount}</div></div>
    <div class="stat-card"><div class="stat-label">Pending</div><div class="stat-value">${overview.pendingCount}</div></div>
  `;

  recentPaymentsTable.innerHTML =
    overview.recentPayments
      .map(
        (p) => `
      <tr>
        <td>${fmtTime(p.settledAt || p.createdAt)}</td>
        <td>${p.officeName}</td>
        <td>${money(p.grossUsd)}</td>
        <td>Cash App</td>
        <td>${statusBadge(p.status)}</td>
      </tr>`
      )
      .join("") || `<tr><td colspan="5">No payments yet</td></tr>`;

  systemStats.innerHTML = `
    <div class="stat-card"><div class="stat-label">Alby NWC</div><div class="stat-value">${overview.health.nwc ? "Online" : "Offline"}</div></div>
    <div class="stat-card"><div class="stat-label">Database</div><div class="stat-value">${overview.health.database?.ok ? "OK" : "Error"}</div></div>
    <div class="stat-card"><div class="stat-label">Backend</div><div class="stat-value">${overview.health.database?.backend || "—"}</div></div>
    <div class="stat-card"><div class="stat-label">Auto Sync</div><div class="stat-value">Active</div></div>
  `;

  liveBadge.textContent = `Live · ${new Date().toLocaleTimeString()}`;
}

function renderOffices(offices) {
  userOffice.innerHTML = offices
    .map((o) => `<option value="${o.id}">${o.name}</option>`)
    .join("");

  officesTable.innerHTML = offices
    .map(
      (o) => `
    <tr>
      <td><strong>${o.name}</strong><br><span class="sub">/${o.slug}</span></td>
      <td><div class="link-box">${o.payLink}</div></td>
      <td>
        <div class="inline-actions">
          <input type="number" min="0" max="100" step="0.01" value="${o.commissionPercent ?? 0}" data-commission="${o.id}" class="commission-input" />
          <button class="btn btn-secondary" type="button" data-save-commission="${o.id}">Save</button>
        </div>
      </td>
      <td>${o.stats.paidCount}</td>
      <td>${o.stats.pendingCount}</td>
      <td>${money(o.stats.totalUsd)}</td>
    </tr>`
    )
    .join("") || `<tr><td colspan="6">No offices yet</td></tr>`;
}

function renderUsers(users) {
  usersTable.innerHTML = users
    .map(
      (u) => `
    <tr>
      <td>${u.username}</td>
      <td>${u.officeName || "—"}</td>
      <td>${fmtTime(u.createdAt)}</td>
      <td>
        <div class="inline-actions">
          <button class="btn btn-secondary" type="button" data-reset="${u.id}" data-user="${u.username}">Reset Password</button>
          <button class="btn btn-danger" type="button" data-delete="${u.id}" data-user="${u.username}">Delete</button>
        </div>
      </td>
    </tr>`
    )
    .join("") || `<tr><td colspan="4">No office users yet</td></tr>`;
}

function renderPayments(payments) {
  const q = (paymentSearch?.value || "").trim().toLowerCase();
  const filtered = payments.filter((p) => {
    if (!q) return true;
    return (
      (p.officeName || "").toLowerCase().includes(q) ||
      (p.status || "").toLowerCase().includes(q)
    );
  });

  paymentsTable.innerHTML = filtered
    .map(
      (p) => `
    <tr>
      <td>${fmtTime(p.settledAt || p.createdAt)}</td>
      <td>${p.officeName}</td>
      <td>${money(p.grossUsd)}</td>
      <td>${money(p.netUsd)}</td>
      <td>Cash App</td>
      <td>${statusBadge(p.status)}</td>
    </tr>`
    )
    .join("") || `<tr><td colspan="6">No payments found</td></tr>`;
}

async function loadAll() {
  const [overview, officesData, usersData, paymentsData] = await Promise.all([
    api("/api/admin/overview"),
    api("/api/admin/offices"),
    api("/api/admin/users"),
    api("/api/admin/payments"),
  ]);

  allPayments = paymentsData.payments;
  renderOverview(overview);
  renderOffices(officesData.offices);
  renderUsers(usersData.users);
  renderPayments(allPayments);
}

async function boot() {
  try {
    const me = await api("/api/auth/me");
    if (me.user.role !== "admin") {
      window.location.href = "/dashboard";
      return;
    }
    adminName.textContent = me.user.username;
    adminAvatar.textContent = me.user.username.charAt(0).toUpperCase();
    showApp();
    await loadAll();
    startRefresh();
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
    if (data.user.role !== "admin") {
      window.location.href = "/dashboard";
      return;
    }
    adminName.textContent = data.user.username;
    adminAvatar.textContent = data.user.username.charAt(0).toUpperCase();
    showApp();
    await loadAll();
    startRefresh();
  } catch (err) {
    loginError.textContent = err.message;
  }
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

refreshBtn.addEventListener("click", loadAll);
paymentSearch?.addEventListener("input", () => renderPayments(allPayments));

document.querySelectorAll(".admin-nav .nav-item").forEach((btn) => {
  btn.addEventListener("click", () => setView(btn.dataset.view));
});

createOfficeBtn.addEventListener("click", async () => {
  officeError.textContent = "";
  officeSuccess.textContent = "";
  try {
    await api("/api/admin/offices", {
      method: "POST",
      body: JSON.stringify({
        name: officeName.value.trim(),
        slug: officeSlug.value.trim() || undefined,
        commissionPercent: Number(officeCommission.value) || 0,
      }),
    });
    officeName.value = "";
    officeSlug.value = "";
    officeCommission.value = "0";
    officeSuccess.textContent = "Office created successfully";
    await loadAll();
  } catch (err) {
    officeError.textContent = err.message;
  }
});

createUserBtn.addEventListener("click", async () => {
  userError.textContent = "";
  userSuccess.textContent = "";
  try {
    await api("/api/admin/users", {
      method: "POST",
      body: JSON.stringify({
        officeId: userOffice.value,
        username: userName.value.trim(),
        password: userPass.value,
      }),
    });
    userName.value = "";
    userPass.value = "";
    userSuccess.textContent = "User created successfully";
    await loadAll();
  } catch (err) {
    userError.textContent = err.message;
  }
});

officesTable.addEventListener("click", async (e) => {
  const btn = e.target.closest("[data-save-commission]");
  if (!btn) return;
  const officeId = btn.dataset.saveCommission;
  const input = officesTable.querySelector(`input[data-commission="${officeId}"]`);
  try {
    await api(`/api/admin/offices/${officeId}/commission`, {
      method: "PATCH",
      body: JSON.stringify({ commissionPercent: Number(input.value) || 0 }),
    });
    btn.textContent = "Saved";
    setTimeout(() => { btn.textContent = "Save"; }, 1500);
    await loadAll();
  } catch (err) {
    alert(err.message);
  }
});

usersTable.addEventListener("click", async (e) => {
  const resetBtn = e.target.closest("[data-reset]");
  const deleteBtn = e.target.closest("[data-delete]");

  if (resetBtn) {
    const password = prompt(`New password for "${resetBtn.dataset.user}" (min 8 chars):`);
    if (!password) return;
    if (password.length < 8) {
      alert("Password must be at least 8 characters");
      return;
    }
    try {
      await api(`/api/admin/users/${resetBtn.dataset.reset}/password`, {
        method: "PATCH",
        body: JSON.stringify({ password }),
      });
      alert("Password updated");
    } catch (err) {
      alert(err.message);
    }
    return;
  }

  if (deleteBtn) {
    if (!confirm(`Delete user "${deleteBtn.dataset.user}"?`)) return;
    try {
      await api(`/api/admin/users/${deleteBtn.dataset.delete}`, { method: "DELETE" });
      await loadAll();
    } catch (err) {
      alert(err.message);
    }
  }
});

document.addEventListener("visibilitychange", () => {
  if (!document.hidden && !appSection.classList.contains("hidden")) loadAll();
});

boot();
