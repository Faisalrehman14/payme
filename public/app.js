const payScreen = document.getElementById("payScreen");
const invoiceScreen = document.getElementById("invoiceScreen");
const amountDisplay = document.getElementById("amountDisplay");
const payBtn = document.getElementById("payBtn");
const errorEl = document.getElementById("error");
const minusBtn = document.getElementById("minusBtn");
const plusBtn = document.getElementById("plusBtn");
const keypad = document.getElementById("keypad");
const chips = document.querySelectorAll(".chip");
const backBtn = document.getElementById("backBtn");
const displayAmount = document.getElementById("displayAmount");
const displaySats = document.getElementById("displaySats");
const qrCode = document.getElementById("qrCode");
const statusEl = document.getElementById("status");
const invoiceText = document.getElementById("invoiceText");
const cashAppBtn = document.getElementById("cashAppBtn");
const copyInvoiceBtn = document.getElementById("copyInvoiceBtn");
const expiryTimer = document.getElementById("expiryTimer");
const invoiceBottom = document.getElementById("invoiceBottom");
const merchantName = document.querySelector(".merchant-name");

const officeSlugMatch = window.location.pathname.match(/^\/pay\/([^/]+)/i);
const officeSlug = officeSlugMatch
  ? decodeURIComponent(officeSlugMatch[1]).trim().toLowerCase()
  : null;
let officeInfo = null;

let amountStr = "0";
let pollTimer = null;
let expiryTimerId = null;
let expiresAt = 0;
const INVOICE_EXPIRY_SEC = 600;

function getLightningUrl(invoice) {
  const bolt11 = invoice.replace(/^lightning:/i, "");
  return `lightning:${bolt11}`;
}

function openInCashApp(invoice) {
  const uri = getLightningUrl(invoice);
  const link = document.createElement("a");
  link.href = uri;
  link.style.display = "none";
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}

function isMobile() {
  return /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);
}

function getAmountUsd() {
  return parseFloat(amountStr) || 0;
}

function renderAmount() {
  const val = getAmountUsd();
  amountDisplay.textContent = val % 1 === 0 ? `$${val}` : `$${val.toFixed(2)}`;

  chips.forEach((chip) => {
    chip.classList.toggle("active", parseInt(chip.dataset.amount, 10) === val);
  });
}

function showError(msg) {
  errorEl.textContent = msg || "";
}

function stopPolling() {
  if (pollTimer) {
    clearInterval(pollTimer);
    pollTimer = null;
  }
}

function stopExpiryTimer() {
  if (expiryTimerId) {
    clearInterval(expiryTimerId);
    expiryTimerId = null;
  }
}

function formatCountdown(msLeft) {
  if (!Number.isFinite(msLeft) || msLeft < 0) msLeft = 0;
  const totalSec = Math.max(0, Math.ceil(msLeft / 1000));
  const min = Math.floor(totalSec / 60);
  const sec = totalSec % 60;
  return `${min}:${sec.toString().padStart(2, "0")}`;
}

function markInvoiceExpired() {
  stopPolling();
  stopExpiryTimer();
  expiryTimer.textContent = "QR expired";
  expiryTimer.className = "expiry-timer expired";
  invoiceBottom.classList.add("expired");
  statusEl.className = "status expired";
  statusEl.innerHTML = "Invoice expired — go back and try again";
  cashAppBtn.disabled = true;
}

function startExpiryTimer(expiresAtMs) {
  stopExpiryTimer();
  if (!Number.isFinite(expiresAtMs)) {
    expiresAtMs = Date.now() + INVOICE_EXPIRY_SEC * 1000;
  }
  expiresAt = expiresAtMs;
  expiryTimer.className = "expiry-timer";
  invoiceBottom.classList.remove("expired");
  cashAppBtn.disabled = false;

  const tick = () => {
    const left = expiresAt - Date.now();
    if (left <= 0) {
      markInvoiceExpired();
      return;
    }
    expiryTimer.textContent = `Expires in ${formatCountdown(left)}`;
    expiryTimer.classList.toggle("urgent", left <= 60000);
  };

  tick();
  expiryTimerId = setInterval(tick, 1000);
}

function pressKey(key) {
  showError("");

  if (key === "back") {
    if (amountStr.length <= 1) {
      amountStr = "0";
    } else {
      amountStr = amountStr.slice(0, -1);
      if (amountStr === "" || amountStr === ".") amountStr = "0";
    }
    renderAmount();
    return;
  }

  if (key === ".") {
    if (amountStr.includes(".")) return;
    amountStr = amountStr === "0" ? "0." : amountStr + ".";
    renderAmount();
    return;
  }

  if (amountStr === "0") {
    amountStr = key;
  } else {
    if (amountStr.includes(".")) {
      const decimals = amountStr.split(".")[1];
      if (decimals && decimals.length >= 2) return;
    }
    amountStr += key;
  }

  if (getAmountUsd() > 9999) {
    amountStr = "9999";
  }

  renderAmount();
}

function setQuickAmount(value) {
  amountStr = String(value);
  showError("");
  renderAmount();
}

function adjustAmount(delta) {
  let val = Math.max(0, getAmountUsd() + delta);
  amountStr = val % 1 === 0 ? String(val) : val.toFixed(2);
  renderAmount();
}

function showInvoiceScreen() {
  payScreen.classList.add("hidden");
  invoiceScreen.classList.remove("hidden");
}

function showPayScreen() {
  stopPolling();
  stopExpiryTimer();
  invoiceBottom.classList.remove("expired");
  cashAppBtn.disabled = false;
  invoiceScreen.classList.add("hidden");
  payScreen.classList.remove("hidden");
  statusEl.className = "status waiting";
  statusEl.innerHTML = '<span class="dot"></span> Waiting for payment...';
}

function openCashApp(invoice) {
  openInCashApp(invoice);
}

async function createInvoice() {
  showError("");
  const amountUsd = getAmountUsd();

  if (!officeSlug) {
    showError("Invalid payment link — ask the office for the correct URL");
    return;
  }

  if (amountUsd < 1) {
    showError("Minimum $1");
    return;
  }

  payBtn.disabled = true;
  payBtn.textContent = "...";

  try {
    const res = await fetch("/api/invoice", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ amountUsd, officeSlug }),
    });

    let data;
    try {
      data = await res.json();
    } catch {
      throw new Error("Server not running");
    }
    if (!res.ok) throw new Error(data.error || "Failed to create invoice");

    displayAmount.textContent = `$${data.amountUsd.toFixed(2)}`;
    displaySats.textContent = `${data.amountSats.toLocaleString()} sats`;
    qrCode.src = data.qrDataUrl;
    invoiceText.value = data.paymentRequest;

    showInvoiceScreen();

    const expiryMs =
      Number(data.expiresAt) ||
      Date.now() + (Number(data.expirySec) || INVOICE_EXPIRY_SEC) * 1000;
    startExpiryTimer(expiryMs);

    stopPolling();
    pollTimer = setInterval(() => checkStatus(data.paymentHash), 3000);

    if (isMobile()) {
      setTimeout(() => openCashApp(data.paymentRequest), 600);
    }
  } catch (err) {
    const isLocal =
      location.hostname === "localhost" || location.hostname === "127.0.0.1";
    if (err.message === "Failed to fetch" || err.message === "Server not running") {
      showError(
        isLocal
          ? "Server band hai — npm start chalao"
          : "Payment system is temporarily unavailable. Please try again shortly."
      );
    } else {
      showError(err.message);
    }
  } finally {
    payBtn.disabled = false;
    payBtn.textContent = "PAY";
  }
}

async function checkStatus(hash) {
  try {
    const res = await fetch(`/api/invoice/${hash}/status`);
    const data = await res.json();

    if (data.settled) {
      stopPolling();
      stopExpiryTimer();
      expiryTimer.textContent = "Paid ✓";
      expiryTimer.className = "expiry-timer";
      statusEl.className = "status paid";
      statusEl.innerHTML = "✓ Payment received!";
      cashAppBtn.disabled = true;
    }
  } catch {
    // keep polling
  }
}

keypad.addEventListener("click", (e) => {
  const btn = e.target.closest("button[data-key]");
  if (btn) pressKey(btn.dataset.key);
});

chips.forEach((chip) => {
  chip.addEventListener("click", () => setQuickAmount(chip.dataset.amount));
});

minusBtn.addEventListener("click", () => adjustAmount(-1));
plusBtn.addEventListener("click", () => adjustAmount(1));
payBtn.addEventListener("click", createInvoice);
backBtn.addEventListener("click", showPayScreen);

cashAppBtn.addEventListener("click", () => {
  if (invoiceText.value && !invoiceBottom.classList.contains("expired")) {
    openInCashApp(invoiceText.value);
  }
});

copyInvoiceBtn.addEventListener("click", async () => {
  if (!invoiceText.value) return;
  await navigator.clipboard.writeText(invoiceText.value);
  copyInvoiceBtn.textContent = "Copied!";
  setTimeout(() => {
    copyInvoiceBtn.textContent = "Copy Invoice";
  }, 2000);
});

renderAmount();

async function loadOffice() {
  if (!officeSlug) {
    showError("Use your office payment link from the office (e.g. /pay/your-office)");
    payBtn.disabled = true;
    return;
  }

  try {
    const res = await fetch(`/api/offices/${encodeURIComponent(officeSlug)}`);
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Office not found");
    officeInfo = data.office;
    if (merchantName) merchantName.textContent = officeInfo.name;
    document.title = `${officeInfo.name} — Globa Pay`;

    if (officeInfo.active === false) {
      showError("This office is not accepting payments right now. Contact your office.");
      payBtn.disabled = true;
      document.querySelectorAll(".chip, .amount-btn, #keypad button").forEach((el) => {
        el.disabled = true;
        el.style.opacity = "0.4";
      });
    }
  } catch (err) {
    showError(err.message);
    payBtn.disabled = true;
  }
}

loadOffice();
