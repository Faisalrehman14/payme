const express = require("express");
const path = require("path");
const { PUBLIC_DIR } = require("../config");

const router = express.Router();

router.get("/favicon.ico", (_req, res) => {
  res.redirect(301, "/favicon.svg");
});

router.get("/", (_req, res) => {
  res.sendFile(path.join(PUBLIC_DIR, "landing.html"));
});

router.get("/pay/:slug", (_req, res) => {
  res.sendFile(path.join(PUBLIC_DIR, "index.html"));
});

router.get("/admin", (_req, res) => {
  res.sendFile(path.join(PUBLIC_DIR, "admin.html"));
});

router.get("/dashboard", (_req, res) => {
  res.sendFile(path.join(PUBLIC_DIR, "dashboard.html"));
});

router.get("/privacy", (_req, res) => {
  res.sendFile(path.join(PUBLIC_DIR, "privacy.html"));
});

router.get("/terms", (_req, res) => {
  res.sendFile(path.join(PUBLIC_DIR, "terms.html"));
});

module.exports = router;
