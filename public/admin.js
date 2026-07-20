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
const adminPayoutsTable = document.getElementById("adminPayoutsTable");
const auditTable = document.getElementById("auditTable");
const siteContactEmail = document.getElementById("siteContactEmail");
const siteContactHeadline = document.getElementById("siteContactHeadline");
const siteContactMessage = document.getElementById("siteContactMessage");
const saveSiteSettingsBtn = document.getElementById("saveSiteSettingsBtn");
const siteSettingsError = document.getElementById("siteSettingsError");
const siteSettingsSuccess = document.getElementById("siteSettingsSuccess");
const siteSettingsUpdated = document.getElementById("siteSettingsUpdated");

let refreshTimer = null;
let allPayments = [];
let allPayouts = [];
let allUsers = [];
let allOffices = [];
let auditLogs = [];
let adminInitialLoad = false;
const REFRESH_MS = 10000;

function skeletonRows(cols, rows = 4) {
  return Array.from({ length: rows })
    .map(() => `<tr class="skeleton-row">${"<td><div class=\"skeleton\"></div></td>".repeat(cols)}</tr>`)
    .join("");
}

function setLoading() {
  overviewStats.innerHTML = Array.from({ length: 6 })
    .map(() => `<div class="stat-card skeleton-card"><div class="skeleton"></div></div>`)
    .join("");
  recentPaymentsTable.innerHTML = skeletonRows(5);
  officesTable.innerHTML = skeletonRows(9);
  usersTable.innerHTML = skeletonRows(5);
  paymentsTable.innerHTML = skeletonRows(5);
  if (adminPayoutsTable) adminPayoutsTable.innerHTML = skeletonRows(5);
  if (auditTable) auditTable.innerHTML = skeletonRows(5);
}

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

function officeStatusBadge(active) {
  return active
    ? `<span class="badge paid">Active</span>`
    : `<span class="badge expired">Inactive</span>`;
}

function payoutEnabledBadge(enabled) {
  return enabled
    ? `<span class="badge paid">Enabled</span>`
    : `<span class="badge expired">Disabled</span>`;
}

function formatAction(action) {
  return (action || "").replace(/\./g, " · ");
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
  adminInitialLoad = false;
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
  refreshTimer = setInterval(() => loadAll({ showLoading: false }), REFRESH_MS);
}

function renderStaffList(staff) {
  if (!staff?.length) return `<span class="sub">No staff</span>`;
  return staff.map((s) => `<span class="staff-tag">${s.username}</span>`).join(" ");
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
        <td>${money(p.amountUsd)}</td>
        <td>Cash App</td>
        <td>${statusBadge(p.status)}</td>
      </tr>`
      )
      .join("") || `<tr><td colspan="5">No payments yet</td></tr>`;

  systemStats.innerHTML = `
    <div class="stat-card"><div class="stat-label">Payments</div><div class="stat-value">${overview.health.paymentProviderOk ? "Online" : "Offline"}</div></div>
    <div class="stat-card"><div class="stat-label">Provider</div><div class="stat-value">${overview.health.paymentProvider || "—"}</div></div>
    <div class="stat-card"><div class="stat-label">Database</div><div class="stat-value">${overview.health.database?.ok ? "OK" : "Error"}</div></div>
    <div class="stat-card"><div class="stat-label">Auto Sync</div><div class="stat-value">${overview.health.sync?.lastSyncAt ? "Active" : "Starting"}</div></div>
  `;

  liveBadge.textContent = `Live · ${new Date().toLocaleTimeString()}`;
}

function renderSiteSettings(settings) {
  if (!settings || !siteContactEmail) return;
  siteContactEmail.value = settings.contactEmail || "";
  siteContactHeadline.value = settings.contactHeadline || "";
  siteContactMessage.value = settings.contactMessage || "";
  if (siteSettingsUpdated && settings.updatedAt) {
    siteSettingsUpdated.textContent = `Last updated: ${fmtTime(settings.updatedAt)}`;
  }
}

function renderAudit(logs) {
  if (!auditTable) return;
  auditTable.innerHTML =
    logs
      .map(
        (log) => `
      <tr>
        <td>${fmtTime(log.createdAt)}</td>
        <td>${log.username || "—"}</td>
        <td><code>${formatAction(log.action)}</code></td>
        <td>${log.targetType || "—"} ${log.targetId ? `<span class="sub">${log.targetId.slice(0, 8)}…</span>` : ""}</td>
        <td>${log.ip || "—"}</td>
      </tr>`
      )
      .join("") || `<tr><td colspan="5">No admin actions logged yet</td></tr>`;
}

function renderOffices(offices) {
  const previousOffice = userOffice.value;
  userOffice.innerHTML = offices
    .map((o) => `<option value="${o.id}">${o.name}</option>`)
    .join("");
  if (previousOffice && offices.some((o) => o.id === previousOffice)) {
    userOffice.value = previousOffice;
  }

  officesTable.innerHTML = offices
    .map(
      (o) => `
    <tr>
      <td><strong>${o.name}</strong><br><span class="sub">/${o.slug}</span></td>
      <td>${renderStaffList(o.staff)}</td>
      <td>
        <div class="inline-actions">
          ${officeStatusBadge(o.active !== false)}
          <button class="btn btn-secondary btn-sm" type="button" data-toggle-active="${o.id}" data-active="${o.active !== false}">
            ${o.active !== false ? "Deactivate" : "Activate"}
          </button>
        </div>
      </td>
      <td>
        <div class="inline-actions">
          ${payoutEnabledBadge(o.payoutsEnabled === true)}
          <button class="btn btn-secondary btn-sm" type="button" data-toggle-payouts="${o.id}" data-enabled="${o.payoutsEnabled === true}">
            ${o.payoutsEnabled === true ? "Disable" : "Enable"}
          </button>
        </div>
        <div class="sub" style="margin-top:6px">Avail ${money(o.payoutBalance?.availableUsd || 0)}</div>
      </td>
      <td><div class="link-box">${o.payLink}</div></td>
      <td>${o.stats.paidCount}</td>
      <td>${o.stats.pendingCount}</td>
      <td>${money(o.stats.totalUsd)}</td>
      <td>
        <button class="btn btn-danger btn-sm" type="button" data-delete-office="${o.id}" data-office-name="${o.name}">Delete</button>
      </td>
    </tr>`
    )
    .join("") || `<tr><td colspan="9">No offices yet — create your first office above.</td></tr>`;
}

function renderUsers(users) {
  usersTable.innerHTML = users
    .map(
      (u) => `
    <tr>
      <td>${u.username}</td>
      <td>${u.officeName || "—"}</td>
      <td>${u.payLink ? `<div class="link-box">${u.payLink}</div>` : "—"}</td>
      <td>${fmtTime(u.createdAt)}</td>
      <td>
        <div class="inline-actions">
          <button class="btn btn-secondary" type="button" data-reset-id="${u.id}" data-user="${u.username}">Reset Password</button>
          <button class="btn btn-danger" type="button" data-user-id="${u.id}" data-user="${u.username}">Delete</button>
        </div>
      </td>
    </tr>`
    )
    .join("") || `<tr><td colspan="5">No office users yet</td></tr>`;
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
      <td>${money(p.amountUsd)}</td>
      <td>Cash App</td>
      <td>${statusBadge(p.status)}</td>
    </tr>`
    )
    .join("") || `<tr><td colspan="5">No payments found</td></tr>`;
}

function renderAdminPayouts(payouts) {
  if (!adminPayoutsTable) return;
  adminPayoutsTable.innerHTML =
    (payouts || [])
      .map(
        (p) => `
    <tr>
      <td>${fmtTime(p.settledAt || p.createdAt)}</td>
      <td>${p.officeName || "—"}</td>
      <td>${money(p.amountUsd)}</td>
      <td>${Number(p.amountSats || 0).toLocaleString()}</td>
      <td>${statusBadge(p.status)}${
        p.errorMessage ? `<div class="sub">${p.errorMessage}</div>` : ""
      }</td>
    </tr>`
      )
      .join("") || `<tr><td colspan="5">No payouts yet</td></tr>`;
}

async function loadAll({ showLoading = false } = {}) {
  if (showLoading || !adminInitialLoad) {
    setLoading();
  }
  const [overview, officesData, usersData, paymentsData, payoutsData, auditData, settingsData] =
    await Promise.all([
      api("/api/admin/overview"),
      api("/api/admin/offices"),
      api("/api/admin/users"),
      api("/api/admin/payments"),
      api("/api/admin/payouts").catch(() => ({ payouts: [] })),
      api("/api/admin/audit").catch(() => ({ logs: [] })),
      api("/api/admin/settings").catch(() => ({ settings: null })),
    ]);

  allPayments = paymentsData.payments;
  allPayouts = payoutsData.payouts || [];
  allUsers = usersData.users;
  allOffices = officesData.offices;
  auditLogs = auditData.logs || [];
  renderOverview(overview);
  renderOffices(allOffices);
  renderUsers(allUsers);
  renderPayments(allPayments);
  renderAdminPayouts(allPayouts);
  renderAudit(auditLogs);
  renderSiteSettings(settingsData.settings);
  adminInitialLoad = true;
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
    await loadAll({ showLoading: true });
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
    await loadAll({ showLoading: true });
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

refreshBtn.addEventListener("click", () => loadAll({ showLoading: true }));
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
      }),
    });
    officeName.value = "";
    officeSlug.value = "";
    officeSuccess.textContent = "Office created successfully";
    await loadAll({ showLoading: false });
  } catch (err) {
    officeError.textContent = err.message;
  }
});

createUserBtn.addEventListener("click", async () => {
  userError.textContent = "";
  userSuccess.textContent = "";
  const officeId = userOffice.value;
  if (!officeId) {
    userError.textContent = "Select an office first";
    return;
  }
  try {
    const data = await api("/api/admin/users", {
      method: "POST",
      body: JSON.stringify({
        officeId,
        username: userName.value.trim(),
        password: userPass.value,
      }),
    });
    userName.value = "";
    userPass.value = "";
    const linkNote = data.user.payLink ? ` Payment link: ${data.user.payLink}` : "";
    userSuccess.textContent = `User created for ${data.user.officeName || "office"}.${linkNote}`;
    await loadAll({ showLoading: false });
    if (officeId) userOffice.value = officeId;
  } catch (err) {
    userError.textContent = err.message;
  }
});

officesTable.addEventListener("click", async (e) => {
  const toggleBtn = e.target.closest("[data-toggle-active]");
  if (toggleBtn) {
    const officeId = toggleBtn.dataset.toggleActive;
    const currentlyActive = toggleBtn.dataset.active === "true";
    const action = currentlyActive ? "deactivate" : "activate";
    if (!confirm(`${action.charAt(0).toUpperCase() + action.slice(1)} this office?`)) return;
    try {
      await api(`/api/admin/offices/${officeId}/active`, {
        method: "PATCH",
        body: JSON.stringify({ active: !currentlyActive }),
      });
      await loadAll({ showLoading: false });
    } catch (err) {
      alert(err.message);
    }
    return;
  }

  const payoutToggleBtn = e.target.closest("[data-toggle-payouts]");
  if (payoutToggleBtn) {
    const officeId = payoutToggleBtn.dataset.togglePayouts;
    const currentlyEnabled = payoutToggleBtn.dataset.enabled === "true";
    const action = currentlyEnabled ? "disable" : "enable";
    if (!confirm(`${action.charAt(0).toUpperCase() + action.slice(1)} payouts for this office?`)) {
      return;
    }
    try {
      await api(`/api/admin/offices/${officeId}/payouts`, {
        method: "PATCH",
        body: JSON.stringify({ enabled: !currentlyEnabled }),
      });
      await loadAll({ showLoading: false });
    } catch (err) {
      alert(err.message);
    }
    return;
  }

  const deleteOfficeBtn = e.target.closest("[data-delete-office]");
  if (deleteOfficeBtn) {
    const officeId = deleteOfficeBtn.getAttribute("data-delete-office");
    const officeName = deleteOfficeBtn.getAttribute("data-office-name") || "this office";
    const office = allOffices.find((o) => o.id === officeId);
    const staffNote = office?.staff?.length
      ? ` This will also remove ${office.staff.length} staff account(s) and all payment history.`
      : " This will remove the office and all its payment history.";
    if (!confirm(`Delete "${officeName}"?${staffNote}`)) return;
    try {
      await api(`/api/admin/offices/${officeId}`, { method: "DELETE" });
      allOffices = allOffices.filter((o) => o.id !== officeId);
      allUsers = allUsers.filter((u) => u.officeId !== officeId);
      renderOffices(allOffices);
      renderUsers(allUsers);
      officeSuccess.textContent = `Office "${officeName}" deleted.`;
      await loadAll({ showLoading: false });
    } catch (err) {
      alert(err.message);
    }
  }
});

usersTable.addEventListener("click", async (e) => {
  const resetBtn = e.target.closest("[data-reset-id]");
  const deleteBtn = e.target.closest("[data-user-id]");

  if (resetBtn) {
    const userId = resetBtn.getAttribute("data-reset-id");
    const password = prompt(`New password for "${resetBtn.dataset.user}" (min 8 chars):`);
    if (!password) return;
    if (password.length < 8) {
      alert("Password must be at least 8 characters");
      return;
    }
    try {
      await api(`/api/admin/users/${userId}/password`, {
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
    const userId = deleteBtn.getAttribute("data-user-id");
    if (!userId) return;
    if (!confirm(`Delete user "${deleteBtn.dataset.user}"? This cannot be undone.`)) return;
    try {
      await api(`/api/admin/users/${userId}`, { method: "DELETE" });
      allUsers = allUsers.filter((u) => u.id !== userId);
      allOffices = allOffices.map((o) => ({
        ...o,
        staff: (o.staff || []).filter((s) => s.id !== userId),
      }));
      renderUsers(allUsers);
      renderOffices(allOffices);
      userSuccess.textContent = `User "${deleteBtn.dataset.user}" deleted.`;
      await loadAll({ showLoading: false });
    } catch (err) {
      alert(err.message);
    }
  }
});

document.addEventListener("visibilitychange", () => {
  if (!document.hidden && !appSection.classList.contains("hidden")) {
    loadAll({ showLoading: false });
  }
});

saveSiteSettingsBtn?.addEventListener("click", async () => {
  siteSettingsError.textContent = "";
  siteSettingsSuccess.textContent = "";
  try {
    const data = await api("/api/admin/settings", {
      method: "PATCH",
      body: JSON.stringify({
        contactEmail: siteContactEmail.value.trim(),
        contactHeadline: siteContactHeadline.value.trim(),
        contactMessage: siteContactMessage.value.trim(),
      }),
    });
    renderSiteSettings(data.settings);
    siteSettingsSuccess.textContent = "Site settings saved — landing page updated.";
  } catch (err) {
    siteSettingsError.textContent = err.message;
  }
});

boot();
