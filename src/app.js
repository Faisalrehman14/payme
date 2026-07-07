const express = require("express");
const { PUBLIC_DIR } = require("./config");
const { securityHeaders } = require("./middleware/security");

const authRoutes = require("./routes/auth");
const adminRoutes = require("./routes/admin");
const dashboardRoutes = require("./routes/dashboard");
const publicRoutes = require("./routes/public");
const pageRoutes = require("./routes/pages");

function createApp() {
  const app = express();

  app.set("trust proxy", 1);
  app.use(securityHeaders);
  app.use(express.json());

  app.use(pageRoutes);
  app.use(express.static(PUBLIC_DIR));

  app.use("/api/auth", authRoutes);
  app.use("/api/admin", adminRoutes);
  app.use("/api/dashboard", dashboardRoutes);
  app.use("/api", publicRoutes);

  return app;
}

module.exports = { createApp };
