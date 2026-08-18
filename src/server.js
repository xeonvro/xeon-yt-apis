require("dotenv").config();

const app = require("./app");
const { PORT, NODE_ENV } = require("./config/constants");

const server = app.listen(PORT, () => {
  console.log(`[server] listening on :${PORT} (${NODE_ENV})`);
});

// Graceful shutdown for Render's SIGTERM on deploys/restarts
function shutdown(signal) {
  console.log(`[server] received ${signal}, closing...`);
  server.close(() => {
    console.log("[server] closed cleanly");
    process.exit(0);
  });
  // Hard-exit if connections won't drain
  setTimeout(() => process.exit(1), 10_000).unref();
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
