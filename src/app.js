const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const morgan = require("morgan");
const rateLimit = require("express-rate-limit");

const healthRouter = require("./routes/health");
const downloadRouter = require("./routes/download");
const { notFoundHandler, errorHandler } = require("./middleware/errors");
const {
  NODE_ENV,
  RATE_LIMIT_WINDOW_MS,
  RATE_LIMIT_MAX,
} = require("./config/constants");

const app = express();

// Render terminates TLS and proxies requests — required for the
// rate limiter to see real client IPs.
app.set("trust proxy", 1);

app.disable("x-powered-by");
app.use(helmet());
app.use(express.json({ limit: "100kb" }));

// CORS — allow-list via env, or reflect any origin in dev.
const corsOrigins = process.env.CORS_ORIGIN
  ? process.env.CORS_ORIGIN.split(",").map((s) => s.trim())
  : true;
app.use(cors({ origin: corsOrigins }));

if (NODE_ENV !== "test") {
  app.use(morgan("combined"));
}

// Coarse global rate limit (protects the upstream converter budget)
const apiLimiter = rateLimit({
  windowMs: RATE_LIMIT_WINDOW_MS,
  limit: RATE_LIMIT_MAX,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  message: { success: false, error: "Too many requests, please retry later" },
});
app.use("/api", apiLimiter);

// Routes
app.use("/health", healthRouter);
app.use("/api/download", downloadRouter);

// 404 + central error handling
app.use(notFoundHandler);
app.use(errorHandler);

module.exports = app;
