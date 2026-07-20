const { USE_SECURE_COOKIES, IS_PRODUCTION } = require("../config");

function securityHeaders(_req, res, next) {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  res.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
  res.setHeader("X-DNS-Prefetch-Control", "off");
  res.setHeader("Cross-Origin-Opener-Policy", "same-origin");
  res.setHeader(
    "Content-Security-Policy",
    [
      "default-src 'self'",
      "base-uri 'self'",
      "form-action 'self'",
      "frame-ancestors 'none'",
      "object-src 'none'",
      "img-src 'self' data: https:",
      "font-src 'self' data: https://fonts.gstatic.com",
      "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
      "script-src 'self' 'unsafe-inline' https://cdnjs.cloudflare.com",
      "connect-src 'self' https://mempool.space https://api.qrserver.com https://getalby.com https://api.getalby.com",
      IS_PRODUCTION ? "upgrade-insecure-requests" : "",
    ]
      .filter(Boolean)
      .join("; ")
  );
  if (USE_SECURE_COOKIES) {
    res.setHeader("Strict-Transport-Security", "max-age=31536000; includeSubDomains; preload");
  }
  next();
}

module.exports = { securityHeaders };
