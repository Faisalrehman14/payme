const { NWCClient } = require("@getalby/sdk/nwc");
const { NWC_URL, ALBY_TOKEN } = require("../config");

function normalizeToken(value) {
  if (!value) return "";
  return value.trim().replace(/^["']|["']$/g, "");
}

function normalizeNwcUrl(url) {
  if (!url) return "";
  return url.trim().replace(/^["']|["']$/g, "");
}

function parseNwcUrl(url) {
  const cleaned = normalizeNwcUrl(url);
  if (!cleaned) return { valid: false, error: "NWC_URL is empty" };
  if (cleaned.includes("paste_here")) {
    return { valid: false, error: "NWC_URL still has placeholder text" };
  }
  if (!cleaned.startsWith("nostr+walletconnect://")) {
    return {
      valid: false,
      error: "NWC_URL must start with nostr+walletconnect://",
    };
  }

  const query = cleaned.split("?")[1];
  if (!query) {
    return { valid: false, error: "NWC_URL is incomplete (missing ?relay=...&secret=...)" };
  }

  const params = new URLSearchParams(query);
  const relays = params.getAll("relay");
  const secret = params.get("secret");

  if (!secret) {
    return {
      valid: false,
      error:
        "NWC_URL missing secret. Railway may have cut the URL at &. Paste the FULL string as one variable.",
    };
  }

  if (relays.length === 0) {
    return {
      valid: false,
      error: "NWC_URL missing relay. Paste the complete connection secret from Alby Hub.",
    };
  }

  for (const relay of relays) {
    if (!relay.startsWith("wss://")) {
      return { valid: false, error: `Invalid relay URL: ${relay}` };
    }
  }

  return { valid: true, cleaned };
}

function getNwcUrl() {
  const parsed = parseNwcUrl(NWC_URL);
  return parsed.valid ? parsed.cleaned : null;
}

function getAlbyToken() {
  const token = normalizeToken(ALBY_TOKEN);
  if (!token || token === "your_token_here") return "";
  if (token.startsWith("nostr+walletconnect://")) return "";
  return token;
}

function hasCredentials() {
  return Boolean(getNwcUrl()) || Boolean(getAlbyToken());
}

function requireCredentials(res) {
  if (!hasCredentials()) {
    const parsed = parseNwcUrl(NWC_URL || "");
    const token = normalizeToken(ALBY_TOKEN || "");
    let error = parsed.error || "Add NWC_URL or ALBY_API_TOKEN in Railway Variables.";

    if (token.startsWith("nostr+walletconnect://")) {
      error =
        "ALBY_API_TOKEN mein NWC string mat dalo. Woh NWC_URL mein jati hai. ALBY_API_TOKEN ke liye getalby.com/developer se access token lo.";
    }

    res.status(500).json({ error });
    return false;
  }
  return true;
}

function createNwcClient() {
  const url = getNwcUrl();
  if (!url) {
    throw new Error(parseNwcUrl(NWC_URL || "").error || "Invalid NWC_URL");
  }
  return new NWCClient({ nostrWalletConnectUrl: url });
}

async function albyFetch(endpoint, options = {}) {
  const token = getAlbyToken();
  if (!token) {
    throw new Error(
      "Invalid ALBY_API_TOKEN. Use access token from getalby.com/developer — not NWC string."
    );
  }

  const response = await fetch(`https://api.getalby.com${endpoint}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      ...(options.headers || {}),
    },
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data.message || data.error || `Alby API error (${response.status})`);
  }
  return data;
}

async function lookupInvoiceSettled(paymentHash) {
  if (getNwcUrl()) {
    const client = createNwcClient();
    try {
      const result = await client.lookupInvoice({ payment_hash: paymentHash });
      const settled = result.invoice?.settled ?? result.settled ?? false;
      return {
        settled: Boolean(settled),
        amount: result.invoice?.amount ?? result.amount,
      };
    } finally {
      client.close();
    }
  }

  const invoice = await albyFetch(`/invoices/${paymentHash}`);
  return {
    settled: Boolean(invoice.settled_at),
    amount: invoice.amount,
    settledAt: invoice.settled_at || null,
  };
}

module.exports = {
  parseNwcUrl,
  getNwcUrl,
  getAlbyToken,
  hasCredentials,
  requireCredentials,
  createNwcClient,
  albyFetch,
  lookupInvoiceSettled,
};
