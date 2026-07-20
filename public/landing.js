async function loadLandingSettings() {
  const headline = document.getElementById("contactHeadline");
  const message = document.getElementById("contactMessage");
  const emailLink = document.getElementById("contactEmailLink");
  const emailText = document.getElementById("contactEmailText");
  const footerLink = document.getElementById("footerEmailLink");
  const copyBtn = document.getElementById("copyEmailBtn");
  const yearEl = document.getElementById("footerYear");

  if (yearEl) yearEl.textContent = String(new Date().getFullYear());

  const bindCopy = (email) => {
    if (!copyBtn) return;
    copyBtn.addEventListener("click", async () => {
      await navigator.clipboard.writeText(email);
      copyBtn.textContent = "Copied!";
      setTimeout(() => {
        copyBtn.textContent = "Copy Email";
      }, 2000);
    });
  };

  try {
    const res = await fetch("/api/settings/landing");
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);

    if (headline && data.contactHeadline) {
      headline.textContent = data.contactHeadline;
    }
    if (message && data.contactMessage) {
      message.textContent = data.contactMessage;
    }
    if (data.contactEmail) {
      const mailto = `mailto:${data.contactEmail}`;
      if (emailLink) emailLink.href = mailto;
      if (emailText) emailText.textContent = data.contactEmail;
      if (footerLink) {
        footerLink.href = mailto;
        footerLink.textContent = "Contact";
      }
      bindCopy(data.contactEmail);
    }
  } catch {
    bindCopy(emailText?.textContent || "payments@globapay.com");
  }
}

document.querySelectorAll('a[href^="#"]').forEach((anchor) => {
  anchor.addEventListener("click", (e) => {
    const id = anchor.getAttribute("href");
    if (!id || id === "#") return;
    const target = document.querySelector(id);
    if (!target) return;
    e.preventDefault();
    target.scrollIntoView({ behavior: "smooth", block: "start" });
  });
});

loadLandingSettings();
