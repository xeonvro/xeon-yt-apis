const {
  CONVERTER_URL,
  CONVERTER_ORIGIN,
  MAX_RETRIES,
  RETRY_DELAY_MS,
  REQUEST_TIMEOUT_MS,
  CACHE_TTL_MS,
  VIDEO_CACHE_TTL_MS,
  FILE_TYPE_MAP,
  AUDIO_BITRATE_KBPS,
} = require("../config/constants");

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

const resultCache = new Map();
const inflight = new Map();

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

async function postConverter(body, timeoutMs) {
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
      throw new ScraperError(`Converter responded with HTTP ${response.status}`);
    }
    let json;
    try {
      json = await response.json();
    } catch {
      throw new ScraperError("Converter returned an invalid JSON response");
    }
    return json;
  } finally {
    clearTimeout(timer);
  }
}

function heightOf(format) {
  const h = Number(format.height) || 0;
  if (h > 0) return h;
  // fallback: estimate from 16:9 width
  return format.width ? Math.round((Number(format.width) * 9) / 16) : 0;
}

function labelOf(format) {
  if (format.qualityLabel) return String(format.qualityLabel);
  const h = heightOf(format);
  return h ? `${h}p` : "unknown";
}

/**
 * Best available MP4 ≤ requested quality; exact match preferred;
 * if none is lower, falls back to the smallest higher one; then first.
 */
function pickFormat(formats, requestedQuality) {
  const mp4 = formats.filter((f) => (f.mimeType || "").includes("video/mp4"));
  const pool = mp4.length > 0 ? mp4 : formats;
  const target = parseInt(requestedQuality, 10) || 720;

  const withHeight = pool
    .map((f) => ({ f, h: heightOf(f) }))
    .filter((s) => s.h > 0);

  const exact = withHeight.find((s) => s.h === target);
  if (exact) return exact.f;

  const lower = withHeight.filter((s) => s.h < target).sort((a, b) => b.h - a.h)[0];
  if (lower) return lower.f;

  const higher = withHeight.sort((a, b) => a.h - b.h)[0];
  if (higher) return higher.f;

  return pool[0];
}

/**
 * AUDIO: converter transcodes → poll until { status:"ok", link }.
 */
async function downloadAudio(videoId, opts = {}) {
  const fileType = FILE_TYPE_MAP.audio;
  const body = JSON.stringify({ id: videoId, fileType });

  const maxRetries = opts.maxRetries ?? MAX_RETRIES;
  const retryDelay = opts.retryDelayMs ?? RETRY_DELAY_MS;
  const timeoutMs = opts.timeoutMs ?? REQUEST_TIMEOUT_MS;

  let lastError = null;

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      const json = await postConverter(body, timeoutMs);

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
          quality: `${AUDIO_BITRATE_KBPS}k`,
          bitrateKbps: AUDIO_BITRATE_KBPS,
          cachedAt: new Date().toISOString(),
        };
      }

      lastError = new ScraperError(`Conversion pending (attempt ${attempt + 1}/${maxRetries})`);
    } catch (err) {
      lastError = err;
      if (attempt === maxRetries - 1) break;
    }

    await delay(retryDelay);
  }

  if (lastError && lastError.name === "ScraperError" && lastError.message.startsWith("Conversion pending")) {
    throw new ConversionTimeoutError();
  }
  throw lastError || new ScraperError("Unknown converter failure");
}

/**
 * VIDEO: converter resolves formats[] immediately (no transcode).
 * Returns the best matching MP4 + the full list of available ones.
 */
async function downloadVideo(videoId, quality, opts = {}) {
  const fileType = FILE_TYPE_MAP.video[quality] || "mp4";
  const body = JSON.stringify({ id: videoId, fileType });

  const maxRetries = opts.maxRetries ?? MAX_RETRIES;
  const retryDelay = opts.retryDelayMs ?? RETRY_DELAY_MS;
  const timeoutMs = opts.timeoutMs ?? REQUEST_TIMEOUT_MS;

  let lastError = null;

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      const json = await postConverter(body, timeoutMs);

      if (json.status === "ok" || json.status === "success") {
        // Standard video response: formats[] with direct CDN urls
        if (Array.isArray(json.formats) && json.formats.length > 0) {
          const chosen = pickFormat(json.formats, quality);
          const durationMs = Number(chosen.approxDurationMs) || 0;

          return {
            id: videoId,
            title: json.title || `YouTube video ${videoId}`,
            thumbnail: `https://i.ytimg.com/vi/${videoId}/mqdefault.jpg`,
            url: chosen.url,
            duration: durationMs ? Math.round(durationMs / 1000) : null,
            format: "mp4",
            quality: labelOf(chosen),
            requestedQuality: `${quality}p`,
            bitrateKbps: null,
            filesize: chosen.contentLength ? Number(chosen.contentLength) : null,
            availableFormats: json.formats.map((f) => ({
              itag: f.itag,
              quality: labelOf(f),
              mimeType: f.mimeType,
              width: f.width || null,
              height: f.height || null,
              filesize: f.contentLength ? Number(f.contentLength) : null,
            })),
            cachedAt: new Date().toISOString(),
          };
        }

        // Rare: audio-style success for video
        if (json.link) {
          return {
            id: videoId,
            title: json.title || `YouTube video ${videoId}`,
            thumbnail: `https://i.ytimg.com/vi/${videoId}/mqdefault.jpg`,
            url: json.link,
            duration: json.duration || null,
            format: fileType,
            quality: `${quality}p`,
            bitrateKbps: null,
            availableFormats: [],
            cachedAt: new Date().toISOString(),
          };
        }

        lastError = new ScraperError(
          `Converter returned success but no usable video format (attempt ${attempt + 1}/${maxRetries})`
        );
      } else {
        lastError = new ScraperError(`Conversion pending (attempt ${attempt + 1}/${maxRetries})`);
      }
    } catch (err) {
      lastError = err;
      if (attempt === maxRetries - 1) break;
    }

    await delay(retryDelay);
  }

  if (lastError && lastError.name === "ScraperError" && lastError.message.includes("pending")) {
    throw new ConversionTimeoutError();
  }
  throw lastError || new ScraperError("Unknown converter failure");
}

async function downloadFromYtmp4(videoId, type, quality, opts = {}) {
  if (type === "video") return downloadVideo(videoId, quality, opts);
  return downloadAudio(videoId, opts);
}

async function getDownload(videoId, type, quality) {
  const key = `${type}:${quality}:${videoId}`;
  const ttl = type === "video" ? VIDEO_CACHE_TTL_MS : CACHE_TTL_MS;

  const cached = resultCache.get(key);
  if (cached && cached.expiresAt > Date.now()) {
    return { ...cached.value, servedFromCache: true };
  }

  if (inflight.has(key)) return inflight.get(key);

  const promise = downloadFromYtmp4(videoId, type, quality)
    .then((value) => {
      resultCache.set(key, { value, expiresAt: Date.now() + ttl });
      return { ...value, servedFromCache: false };
    })
    .finally(() => inflight.delete(key));

  inflight.set(key, promise);
  return promise;
}

module.exports = { getDownload, downloadFromYtmp4 };
