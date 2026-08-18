const env = process.env;

module.exports = {
  PORT: parseInt(env.PORT, 10) || 3000,
  NODE_ENV: env.NODE_ENV || "development",

  CONVERTER_URL: env.CONVERTER_URL || "https://ht.flvto.online/converter",
  CONVERTER_ORIGIN: env.CONVERTER_ORIGIN || "https://ht.flvto.online",

  // Scraper tuning
  MAX_RETRIES: parseInt(env.MAX_RETRIES, 10) || 12,
  RETRY_DELAY_MS: parseInt(env.RETRY_DELAY_MS, 10) || 5000,
  REQUEST_TIMEOUT_MS: parseInt(env.REQUEST_TIMEOUT_MS, 10) || 15000,

  // Response cache (keeps completed conversions fresh so the
  // converter isn't hammered by repeat requests)
  CACHE_TTL_MS: parseInt(env.CACHE_TTL_MS, 10) || 60 * 60 * 1000,

  // Rate limiting
  RATE_LIMIT_WINDOW_MS: parseInt(env.RATE_LIMIT_WINDOW_MS, 10) || 15 * 60 * 1000,
  RATE_LIMIT_MAX: parseInt(env.RATE_LIMIT_MAX, 10) || 100,

  // flvto's undocumented `fileType` values. The converter accepts
  // "mp3" for audio and numeric quality strings for video.
  // Override via env if the upstream API changes.
  FILE_TYPE_MAP: {
    audio: "mp3",
    video: {
      480: env.FILE_TYPE_480 || "480",
      720: env.FILE_TYPE_720 || "720",
      1080: env.FILE_TYPE_1080 || "1080",
    },
  },

  AUDIO_BITRATE_KBPS: 320,
  VIDEO_QUALITIES: ["1080", "720", "480"],
};
