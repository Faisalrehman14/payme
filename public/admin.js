const loginSection = document.getElementById("loginSection");
const appSection = document.getElementById("appSection");
const loginUser = document.getElementById("loginUser");
const loginPass = document.getElementById("loginPass");
const loginBtn = document.getElementById("loginBtn");
const loginError = document.getElementById("loginError");
const logoutBtn = document.getElementById("logoutBtn");

const officeName = document.getElementById("officeName");
const officeSlug = document.getElementById("officeSlug");
const officeCommission = document.getElementById("officeCommission");
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
        <td>
          <input type="number" min="0" max="100" step="0.01" value="${o.commissionPercent ?? 0}"
            data-commission="${o.id}" style="width:90px" />
          <button class="secondary" type="button" data-save-commission="${o.id}">Save</button>
        </td>
        <td>${o.stats.paidCount}</td>
        <td>${o.stats.pendingCount}</td>
        <td>$${o.stats.totalUsd.toFixed(2)}</td>
      </tr>`
    )
    .join("") || `<tr><td colspan="6">No offices yet</td></tr>`;

  usersTable.innerHTML = usersData.users
    .map(
      (u) => `
      <tr>
        <td>${u.username}</td>
        <td>${u.officeName || "—"}</td>
        <td>${fmtTime(u.createdAt)}</td>
        <td>
          <button class="secondary" type="button" data-reset="${u.id}" data-user="${u.username}">Reset Password</button>
          <button class="danger" type="button" data-delete="${u.id}" data-user="${u.username}">Delete</button>
        </td>
      </tr>`
    )
    .join("") || `<tr><td colspan="4">No office users yet</td></tr>`;

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
    showApp();
    await loadAll();
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

createOfficeBtn.addEventListener("click", async () => {
  officeError.textContent = "";
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
    btn.textContent = "Saved!";
    setTimeout(() => { btn.textContent = "Save"; }, 1500);
  } catch (err) {
    alert(err.message);
  }
});

usersTable.addEventListener("click", async (e) => {
  const resetBtn = e.target.closest("[data-reset]");
  const deleteBtn = e.target.closest("[data-delete]");

  if (resetBtn) {
    const password = prompt(`New password for "${resetBtn.dataset.user}" (min 6 chars):`);
    if (!password) return;
    if (password.length < 6) {
      alert("Password must be at least 6 characters");
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

boot();
