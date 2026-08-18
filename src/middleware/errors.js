const { NODE_ENV } = require("../config/constants");

function notFoundHandler(req, res) {
  res.status(404).json({ success: false, error: `Route not found: ${req.method} ${req.path}` });
}

// eslint-disable-next-line no-unused-vars
function errorHandler(err, req, res, next) {
  // Known scraper failures carry a statusCode (502/504)
  const status = Number.isInteger(err.statusCode) ? err.statusCode : 500;

  if (status >= 500) {
    console.error(`[error] ${err.stack || err.message}`);
  }

  res.status(status).json({
    success: false,
    error: status >= 500 && NODE_ENV === "production" ? "Upstream conversion failed" : err.message,
  });
}

module.exports = { notFoundHandler, errorHandler };
