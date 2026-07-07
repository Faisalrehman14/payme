const loginSection = document.getElementById("loginSection");
const appSection = document.getElementById("appSection");
const loginUser = document.getElementById("loginUser");
const loginPass = document.getElementById("loginPass");
const loginBtn = document.getElementById("loginBtn");
const loginError = document.getElementById("loginError");
const logoutBtn = document.getElementById("logoutBtn");

const officeName = document.getElementById("officeName");
const officeSlug = document.getElementById("officeSlug");
const createOfficeBtn = document.getElementById("createOfficeBtn");
const officeError = document.getElementById("officeError");
const officesTable = document.getElementById("officesTable");

const userOffice = document.getElementById("userOffice");
const userName = document.getElementById("userName");
const userPass = document.getElementById("userPass");
const createUserBtn = document.getElementById("createUserBtn");
const userError = document.getElementById("userError");
const usersTable = document.getElementById("usersTable");
const paymentsTable = document.getElementById("paymentsTable");

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
}

function showApp() {
  loginSection.classList.add("hidden");
  appSection.classList.remove("hidden");
}

async function loadAll() {
  const [officesData, usersData, paymentsData] = await Promise.all([
    api("/api/admin/offices"),
    api("/api/admin/users"),
    api("/api/admin/payments"),
  ]);

  userOffice.innerHTML = officesData.offices
    .map((o) => `<option value="${o.id}">${o.name}</option>`)
    .join("");

  officesTable.innerHTML = officesData.offices
    .map(
      (o) => `
      <tr>
        <td>${o.name}</td>
        <td><div class="link-box">${o.payLink}</div></td>
        <td>${o.stats.paidCount}</td>
        <td>${o.stats.pendingCount}</td>
        <td>$${o.stats.totalUsd.toFixed(2)}</td>
      </tr>`
    )
    .join("") || `<tr><td colspan="5">No offices yet</td></tr>`;

  usersTable.innerHTML = usersData.users
    .map(
      (u) => `
      <tr>
        <td>${u.username}</td>
        <td>${u.officeName || "—"}</td>
        <td>${fmtTime(u.createdAt)}</td>
      </tr>`
    )
    .join("") || `<tr><td colspan="3">No office users yet</td></tr>`;

  paymentsTable.innerHTML = paymentsData.payments
    .map(
      (p) => `
      <tr>
        <td>${fmtTime(p.settledAt || p.createdAt)}</td>
        <td>${p.officeName}</td>
        <td>$${Number(p.amountUsd).toFixed(2)}</td>
        <td>${statusBadge(p.status)}</td>
      </tr>`
    )
    .join("") || `<tr><td colspan="4">No payments yet</td></tr>`;
}

async function boot() {
  try {
    const me = await api("/api/auth/me");
    if (me.user.role !== "admin") {
      window.location.href = "/dashboard";
      return;
    }
    showApp();
    await loadAll();
  } catch {
    showLogin();
  }
}

loginBtn.addEventListener("click", async () => {
  loginError.textContent = "";
  try {
    await api("/api/auth/login", {
      method: "POST",
      body: JSON.stringify({
        username: loginUser.value.trim(),
        password: loginPass.value,
      }),
    });
    showApp();
    await loadAll();
  } catch (err) {
    loginError.textContent = err.message;
  }
});

logoutBtn.addEventListener("click", async () => {
  await api("/api/auth/logout", { method: "POST" });
  showLogin();
});

createOfficeBtn.addEventListener("click", async () => {
  officeError.textContent = "";
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
    await loadAll();
  } catch (err) {
    officeError.textContent = err.message;
  }
});

createUserBtn.addEventListener("click", async () => {
  userError.textContent = "";
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
    await loadAll();
  } catch (err) {
    userError.textContent = err.message;
  }
});

boot();
