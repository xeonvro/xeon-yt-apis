const {
  CONVERTER_URL,
  CONVERTER_ORIGIN,
  MAX_RETRIES,
  RETRY_DELAY_MS,
  REQUEST_TIMEOUT_MS,
  CACHE_TTL_MS,
  FILE_TYPE_MAP,
  VIDEO_FILE_TYPE_FALLBACKS,
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
// type -> fileType string that actually worked (discovered at runtime)
const fileTypeWinner = new Map();

function resolveFileType(type, quality) {
  if (type === "audio") return FILE_TYPE_MAP.audio;
  // Prefer a previously discovered working value
  return fileTypeWinner.get("video") || FILE_TYPE_MAP.video[quality];
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
 * One-shot probe: POSTs a single fileType and returns true only if the
 * converter answers with a success status AND a usable download link.
 */
async function probeFileType(videoId, fileType, timeoutMs = 10000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(CONVERTER_URL, {
      method: "POST",
      headers: browserHeaders(),
      body: JSON.stringify({ id: videoId, fileType }),
      signal: controller.signal,
    });
    if (!response.ok) return false;
    const json = await response.json();
    return (json.status === "ok" || json.status === "success") && Boolean(json.link);
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Finds the first fileType the converter accepts for this video.
 * One fast attempt per candidate; result is cached for the process lifetime.
 */
async function discoverWorkingFileType(videoId) {
  const winner = fileTypeWinner.get("video");
  if (winner) return winner;

  for (const candidate of VIDEO_FILE_TYPE_FALLBACKS) {
    // Skip if it's already the configured default (already failed upstream)
    if (candidate === FILE_TYPE_MAP.video["720"]) continue;
    console.log(`[probe] trying fileType "${candidate}" for ${videoId}...`);
    // eslint-disable-next-line no-await-in-loop
    if (await probeFileType(videoId, candidate)) {
      console.log(`[probe] fileType "${candidate}" works — caching`);
      fileTypeWinner.set("video", candidate);
      return candidate;
    }
  }
  return null;
}

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
        throw new ScraperError(`Converter responded with HTTP ${response.status}`);
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

      lastError = new ScraperError(`Conversion pending (attempt ${attempt + 1}/${maxRetries})`);
    } catch (err) {
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

async function getDownload(videoId, type, quality) {
  const key = `${type}:${quality}:${videoId}`;

  const cached = resultCache.get(key);
  if (cached && cached.expiresAt > Date.now()) {
    return { ...cached.value, servedFromCache: true };
  }

  if (inflight.has(key)) return inflight.get(key);

  const promise = (async () => {
    try {
      return await downloadFromYtmp4(videoId, type, quality);
    } catch (err) {
      // Video only: the configured fileType failed — discover one that works
      if (type === "video" && fileTypeWinner.get("video") === undefined) {
        const working = await discoverWorkingFileType(videoId);
        if (working) {
          const result = await downloadFromYtmp4(videoId, type, quality);
          result.fileTypeUsed = working;
          return result;
        }
      }
      throw err;
    }
  })().then((value) => {
    resultCache.set(key, { value, expiresAt: Date.now() + CACHE_TTL_MS });
    return { ...value, servedFromCache: false };
  }).finally(() => inflight.delete(key));

  inflight.set(key, promise);
  return promise;
}

module.exports = { getDownload, downloadFromYtmp4 };
