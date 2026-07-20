const express = require("express");
const { PUBLIC_DIR, JSON_BODY_LIMIT } = require("./config");
const { securityHeaders } = require("./middleware/security");
const { createRateLimiter } = require("./middleware/rate-limit");
const { notFoundHandler, errorHandler } = require("./middleware/errors");
const { getClientIp } = require("./middleware/auth");

const authRoutes = require("./routes/auth");
const adminRoutes = require("./routes/admin");
const dashboardRoutes = require("./routes/dashboard");
const publicRoutes = require("./routes/public");
const pageRoutes = require("./routes/pages");

function createApp() {
  const app = express();

  app.disable("x-powered-by");
  app.set("trust proxy", 1);

  app.use(securityHeaders);
  app.use(
    express.json({
      limit: JSON_BODY_LIMIT,
      strict: true,
    })
  );

  // Global API throttle (per IP)
  app.use(
    "/api",
    createRateLimiter({
      windowMs: 60_000,
      max: 180,
      keyFn: (req) => getClientIp(req),
      message: "Too many API requests. Please slow down.",
    })
  );

  app.use(pageRoutes);
  app.use(
    express.static(PUBLIC_DIR, {
      index: false,
      maxAge: process.env.NODE_ENV === "production" ? "1h" : 0,
      setHeaders(res, filePath) {
        if (filePath.endsWith(".html")) {
          res.setHeader("Cache-Control", "no-store");
        }
      },
    })
  );

  app.use("/api/auth", authRoutes);
  app.use("/api/admin", adminRoutes);
  app.use("/api/dashboard", dashboardRoutes);
  app.use("/api", publicRoutes);

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}

module.exports = { createApp };
