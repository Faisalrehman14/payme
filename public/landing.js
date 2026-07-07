async function loadLandingSettings() {
  const headline = document.getElementById("contactHeadline");
  const message = document.getElementById("contactMessage");
  const emailLink = document.getElementById("contactEmailLink");
  const emailText = document.getElementById("contactEmailText");
  const footerLink = document.getElementById("footerEmailLink");
  const copyBtn = document.getElementById("copyEmailBtn");

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
        footerLink.textContent = data.contactEmail;
      }
      if (copyBtn) {
        copyBtn.addEventListener("click", async () => {
          await navigator.clipboard.writeText(data.contactEmail);
          copyBtn.textContent = "Copied!";
          setTimeout(() => {
            copyBtn.textContent = "Copy Email";
          }, 2000);
        });
      }
    }
  } catch {
    if (copyBtn) {
      const fallback = emailText?.textContent || "payments@globapay.com";
      copyBtn.addEventListener("click", async () => {
        await navigator.clipboard.writeText(fallback);
        copyBtn.textContent = "Copied!";
        setTimeout(() => {
          copyBtn.textContent = "Copy Email";
        }, 2000);
      });
    }
  }
}

loadLandingSettings();
