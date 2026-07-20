const { IS_PRODUCTION } = require("../config");

function notFoundHandler(req, res) {
  if (req.path.startsWith("/api/")) {
    return res.status(404).json({ error: "Not found" });
  }
  return res.status(404).send("Not found");
}

function errorHandler(err, _req, res, _next) {
  const status = Number(err.status || err.statusCode) || 500;
  const expose = Boolean(err.expose) || status < 500;
  const message =
    expose && err.message
      ? err.message
      : status === 429
        ? "Too many requests"
        : "Something went wrong. Please try again.";

  if (status >= 500) {
    console.error("[error]", err.stack || err.message || err);
  }

  if (res.headersSent) return;
  res.status(status).json({
    error: message,
    ...(IS_PRODUCTION ? {} : { detail: err.message }),
  });
}

function asyncHandler(fn) {
  return (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
}

module.exports = { notFoundHandler, errorHandler, asyncHandler };
