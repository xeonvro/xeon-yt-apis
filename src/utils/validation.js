const { extractVideoId } = require("./videoId");
const { AUDIO_BITRATE_KBPS, VIDEO_QUALITIES } = require("../config/constants");

const VALID_TYPES = new Set(["audio", "video"]);
const VALID_QUALITIES = new Set(VIDEO_QUALITIES);

/**
 * Validate and normalize /api/download query params.
 * Returns { errors: string[], params } where params is null-safe.
 */
function parseDownloadParams(query = {}) {
  const errors = [];

  // 1. ID — accept either `id` or `url`
  const rawInput = (query.id || query.url || "").toString().trim();
  const videoId = extractVideoId(rawInput);
  if (!videoId) {
    errors.push(
      '"id" or "url" must be a valid YouTube URL or an 11-character video ID'
    );
  }

  // 2. Type
  let type = (query.type || "audio").toString().toLowerCase();
  if (!VALID_TYPES.has(type)) {
    errors.push('"type" must be either "audio" or "video"');
  }

  // 3. Quality — only meaningful for video
  let quality = "720"; // default
  if (type === "video") {
    quality = (query.quality || "720").toString();
    if (!VALID_QUALITIES.has(quality)) {
      errors.push(`"quality" must be one of: ${VIDEO_QUALITIES.join(", ")}`);
    }
  }

  // 4. Bitrate — audio only, hard-capped at 320kbps
  let bitrate = AUDIO_BITRATE_KBPS; // default
  if (type === "audio" && query.bitrate != null) {
    bitrate = parseInt(query.bitrate, 10);
    if (!Number.isFinite(bitrate) || bitrate <= 0 || bitrate > AUDIO_BITRATE_KBPS) {
      errors.push(`"bitrate" must be an integer between 1 and ${AUDIO_BITRATE_KBPS} kbps`);
    }
  }

  return {
    errors,
    params: { videoId, type, quality, bitrate: bitrate || AUDIO_BITRATE_KBPS },
  };
}

module.exports = { parseDownloadParams };
