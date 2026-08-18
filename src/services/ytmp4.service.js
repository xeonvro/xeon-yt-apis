const {
  CONVERTER_URL,
  CONVERTER_ORIGIN,
  MAX_RETRIES,
  RETRY_DELAY_MS,
  REQUEST_TIMEOUT_MS,
  CACHE_TTL_MS,
  FILE_TYPE_MAP,
  AUDIO_BITRATE_KBPS,
} = require("../config/constants");

// ---------- Error taxonomy ----------
class ScraperError extends Error {
  constructor(message, statusCode = 502) {
    super(message);
    this.name = "ScraperError";
    this.statusCode = statusCode;
  }
}

class ConversionTimeoutError extends Error {
  constructor(message = "Conversion timed out after maximum retries") {
    super(message);
    this.name = "ConversionTimeoutError";
    this.statusCode = 504;
  }
}

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// ---------- Cache (TTL + in-flight dedupe) ----------
const resultCache = new Map(); // key -> { value, expiresAt }
const inflight = new Map();    // key -> Promise (dedupes concurrent calls)

function resolveFileType(type, quality) {
  if (type === "audio") return FILE_TYPE_MAP.audio;
  return FILE_TYPE_MAP.video[quality];
}

function browserHeaders() {
  return {
    "accept-encoding": "gzip, deflate, br, zstd",
    accept: "application/json, text/plain, */*",
    "content-type": "application/json",
    origin: CONVERTER_ORIGIN,
    referer: CONVERTER_ORIGIN + "/",
    "user-agent":
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
      "(KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
  };
}

/**
 * Core scraper. POSTs {id, fileType} to the converter and polls
 * for a success status. Retries on network errors, non-200s,
 * timeouts, and "pending" statuses.
 */
async function downloadFromYtmp4(videoId, type, quality, opts = {}) {
  const fileType = resolveFileType(type, quality);
  const body = JSON.stringify({ id: videoId, fileType });

  const maxRetries = opts.maxRetries ?? MAX_RETRIES;
  const retryDelay = opts.retryDelayMs ?? RETRY_DELAY_MS;
  const timeoutMs = opts.timeoutMs ?? REQUEST_TIMEOUT_MS;

  let lastError = null;

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await fetch(CONVERTER_URL, {
        method: "POST",
        headers: browserHeaders(),
        body,
        signal: controller.signal,
      });

      if (!response.ok) {
        throw new ScraperError(
          `Converter responded with HTTP ${response.status}`,
          response.status >= 500 ? 502 : 502
        );
      }

      let json;
      try {
        json = await response.json();
      } catch {
        throw new ScraperError("Converter returned an invalid JSON response");
      }

      if (json.status === "ok" || json.status === "success") {
        if (!json.link) {
          throw new ScraperError("Converter reported success but no download link");
        }
        return {
          id: videoId,
          title: json.title || `YouTube video ${videoId}`,
          thumbnail: `https://i.ytimg.com/vi/${videoId}/mqdefault.jpg`,
          url: json.link,
          duration: json.duration || null,
          format: fileType,
          quality: type === "audio" ? `${AUDIO_BITRATE_KBPS}k` : `${quality}p`,
          bitrateKbps: type === "audio" ? AUDIO_BITRATE_KBPS : null,
          cachedAt: new Date().toISOString(),
        };
      }

      // status is still "pending" — keep polling
      lastError = new ScraperError(`Conversion pending (attempt ${attempt + 1}/${maxRetries})`);
    } catch (err) {
      // AbortError = our own timeout; keep everything retryable
      lastError = err;
      if (attempt === maxRetries - 1) break;
    } finally {
      clearTimeout(timer);
    }

    await delay(retryDelay);
  }

  if (lastError && lastError.name === "ScraperError" && lastError.message.startsWith("Conversion pending")) {
    throw new ConversionTimeoutError();
  }
  throw lastError || new ScraperError("Unknown converter failure");
}

/**
 * Public entry point: TTL cache + in-flight dedupe around the scraper.
 */
async function getDownload(videoId, type, quality) {
  const key = `${type}:${quality}:${videoId}`;

  const cached = resultCache.get(key);
  if (cached && cached.expiresAt > Date.now()) {
    return { ...cached.value, servedFromCache: true };
  }

  // Reuse an in-flight request so N concurrent clients don't
  // trigger N converter polls.
  if (inflight.has(key)) return inflight.get(key);

  const promise = downloadFromYtmp4(videoId, type, quality)
    .then((value) => {
      resultCache.set(key, { value, expiresAt: Date.now() + CACHE_TTL_MS });
      return { ...value, servedFromCache: false };
    })
    .finally(() => inflight.delete(key));

  inflight.set(key, promise);
  return promise;
}

module.exports = { getDownload, downloadFromYtmp4 };
