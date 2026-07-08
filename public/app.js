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
const inAppNotice = document.getElementById("inAppNotice");
const invoiceInAppNotice = document.getElementById("invoiceInAppNotice");
const payHint = document.getElementById("payHint");

const officeSlugMatch = window.location.pathname.match(/^\/pay\/([^/]+)/i);
const officeSlug = officeSlugMatch
  ? decodeURIComponent(officeSlugMatch[1]).trim().toLowerCase()
  : null;
let officeInfo = null;

let amountStr = "0";
let pollTimer = null;
let expiryTimerId = null;
let expiresAt = 0;
let activePaymentHash = null;
const INVOICE_EXPIRY_SEC = 600;

function getBolt11(invoice) {
  return String(invoice || "").replace(/^lightning:/i, "").trim();
}

function getLightningUri(invoice) {
  const bolt11 = getBolt11(invoice);
  return bolt11 ? `lightning:${bolt11}` : "";
}

function getCashAppUniversalUrl(bolt11) {
  return `https://cash.app/launch/lightning/${bolt11}`;
}

function isAndroid() {
  return /Android/i.test(navigator.userAgent || "");
}

function isIOS() {
  return /iPhone|iPad|iPod/i.test(navigator.userAgent || "");
}

function getInAppPlatform() {
  const ua = navigator.userAgent || "";
  if (/Instagram/i.test(ua)) return "instagram";
  if (/FBAN|FBAV|Messenger/i.test(ua)) return "facebook";
  if (/WhatsApp/i.test(ua)) return "whatsapp";
  if (/TikTok/i.test(ua)) return "tiktok";
  if (/Twitter|X-Twitter/i.test(ua)) return "twitter";
  if (/LinkedInApp/i.test(ua)) return "linkedin";
  if (/Snapchat/i.test(ua)) return "snapchat";
  if (/; wv\)|WebView/i.test(ua)) return "webview";
  return null;
}

function isInAppBrowser() {
  return Boolean(getInAppPlatform());
}

function getCashAppOpenUrl(bolt11) {
  if (!bolt11) return "#";

  const lightning = `lightning:${bolt11}`;
  const universal = getCashAppUniversalUrl(bolt11);

  if (isAndroid()) {
    const fallback = encodeURIComponent(universal);
    return `intent://cash.app/launch/lightning/${bolt11}#Intent;scheme=https;package=com.squareup.cash;S.browser_fallback_url=${fallback};end`;
  }

  const inApp = getInAppPlatform();
  if (inApp === "instagram") {
    return `instagram://extbrowser/?url=${encodeURIComponent(universal)}`;
  }
  if (inApp) {
    // Messenger/Facebook/etc cannot open lightning: — escape to Safari with Cash App link
    return `x-safari-https://cash.app/launch/lightning/${bolt11}`;
  }

  if (isIOS()) {
    return lightning;
  }

  return lightning;
}

function getSafariEscapeUrl() {
  const path = location.href.replace(/^https?:\/\//, "");
  if (isAndroid()) {
    return `intent://${path}#Intent;scheme=https;end`;
  }
  return `x-safari-https://${path}`;
}

function setCashAppLink(invoice) {
  const bolt11 = getBolt11(invoice);
  if (!cashAppBtn) return;
  cashAppBtn.href = getCashAppOpenUrl(bolt11);
}

function setSafariEscapeLink() {
  const openSafariBtn = document.getElementById("openSafariBtn");
  if (!openSafariBtn || !isInAppBrowser()) return;
  openSafariBtn.href = getSafariEscapeUrl();
  openSafariBtn.classList.remove("hidden");
}

function setCashAppEnabled(enabled) {
  if (!cashAppBtn) return;
  cashAppBtn.classList.toggle("disabled", !enabled);
  if (enabled) {
    cashAppBtn.removeAttribute("aria-disabled");
  } else {
    cashAppBtn.setAttribute("aria-disabled", "true");
  }
}

function showInAppBrowserHelp() {
  const html = `
    <strong>In-app browser detected</strong>
    Tap <strong>Open in Safari</strong> first, then tap <strong>Open in Cash App</strong>.
    Or scan the QR from Cash App → Bitcoin → Pay.
  `;
  if (inAppNotice) {
    inAppNotice.innerHTML = html;
    inAppNotice.classList.remove("hidden");
  }
  if (invoiceInAppNotice) {
    invoiceInAppNotice.innerHTML = html;
    invoiceInAppNotice.classList.remove("hidden");
  }
  setSafariEscapeLink();
}

function openInCashApp(e) {
  if (e) e.preventDefault();
  if (invoiceBottom.classList.contains("expired")) return false;
  const bolt11 = getBolt11(invoiceText.value);
  if (!bolt11) return false;
  window.location.href = getCashAppOpenUrl(bolt11);
  return false;
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
  setCashAppEnabled(false);
}

function startExpiryTimer(expiresAtMs) {
  stopExpiryTimer();
  if (!Number.isFinite(expiresAtMs)) {
    expiresAtMs = Date.now() + INVOICE_EXPIRY_SEC * 1000;
  }
  expiresAt = expiresAtMs;
  expiryTimer.className = "expiry-timer";
  invoiceBottom.classList.remove("expired");
  setCashAppEnabled(true);

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
  activePaymentHash = null;
  invoiceBottom.classList.remove("expired");
  setCashAppEnabled(true);
  invoiceScreen.classList.add("hidden");
  payScreen.classList.remove("hidden");
  statusEl.className = "status waiting";
  statusEl.innerHTML = '<span class="dot"></span> Waiting for payment...';
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
    activePaymentHash = data.paymentHash;
    setCashAppLink(data.paymentRequest);
    setSafariEscapeLink();

    showInvoiceScreen();

    const expiryMs =
      Number(data.expiresAt) ||
      Date.now() + (Number(data.expirySec) || INVOICE_EXPIRY_SEC) * 1000;
    startExpiryTimer(expiryMs);

    stopPolling();
    pollTimer = setInterval(() => checkStatus(data.paymentHash), 3000);
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
      setCashAppEnabled(false);
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

cashAppBtn.addEventListener("click", openInCashApp);

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
    if (merchantName) merchantName.textContent = "Cash App";
    document.title = "Cash App — Globa Pay";

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

if (isInAppBrowser()) {
  showInAppBrowserHelp();
}

document.addEventListener("visibilitychange", () => {
  if (!document.hidden && activePaymentHash) {
    checkStatus(activePaymentHash);
  }
});
