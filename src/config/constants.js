const env = process.env;

module.exports = {
  PORT: parseInt(env.PORT, 10) || 3000,
  NODE_ENV: env.NODE_ENV || "development",

  CONVERTER_URL: env.CONVERTER_URL || "https://ht.flvto.online/converter",
  CONVERTER_ORIGIN: env.CONVERTER_ORIGIN || "https://ht.flvto.online",

  MAX_RETRIES: parseInt(env.MAX_RETRIES, 10) || 12,
  RETRY_DELAY_MS: parseInt(env.RETRY_DELAY_MS, 10) || 5000,
  REQUEST_TIMEOUT_MS: parseInt(env.REQUEST_TIMEOUT_MS, 10) || 15000,

  CACHE_TTL_MS: parseInt(env.CACHE_TTL_MS, 10) || 60 * 60 * 1000,

  RATE_LIMIT_WINDOW_MS: parseInt(env.RATE_LIMIT_WINDOW_MS, 10) || 15 * 60 * 1000,
  RATE_LIMIT_MAX: parseInt(env.RATE_LIMIT_MAX, 10) || 100,

  FILE_TYPE_MAP: {
    audio: "mp3",
    // Video now defaults to "mp4" — the format name the flvto family
    // actually understands. Still overridable per quality via env.
    video: {
      480: env.FILE_TYPE_480 || "mp4",
      720: env.FILE_TYPE_720 || "mp4",
      1080: env.FILE_TYPE_1080 || "mp4",
    },
  },

  // If the configured fileType keeps failing, the service probes these
  // values (single fast attempt each) and caches the first that works.
  VIDEO_FILE_TYPE_FALLBACKS: ["mp4", "22", "18", "37", "137", "best"],

  AUDIO_BITRATE_KBPS: 320,
  VIDEO_QUALITIES: ["1080", "720", "480"],
};
