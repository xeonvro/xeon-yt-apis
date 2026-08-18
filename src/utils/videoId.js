const YT_ID_REGEX = /^[A-Za-z0-9_-]{11}$/;

// Ordered: most specific first. All tolerate query strings & extra params.
const URL_PATTERNS = [
  // youtube.com/watch?v=ID (with optional params before/after &list= etc.)
  /[?&]v=([A-Za-z0-9_-]{11})(?:&|$)/,
  // youtu.be/ID
  /youtu\.be\/([A-Za-z0-9_-]{11})(?:[?/]|$)/,
  // youtube.com/embed|shorts|live|v|e/ID
  /(?:youtube\.com|music\.youtube\.com)\/(?:embed|shorts|live|v|e)\/([A-Za-z0-9_-]{11})(?:[?/]|$)/,
  // attribution_link?u=/watch?v%3DID
  /youtube\.com\/attribution_link\?.*u=\/watch\?v%3D([A-Za-z0-9_-]{11})/,
];

/**
 * Extract an 11-character YouTube video ID from any supported input.
 * Accepts full URLs (all schemes/subdomains), or a bare ID.
 * Returns null when nothing valid is found.
 */
function extractVideoId(input) {
  if (!input || typeof input !== "string") return null;

  const candidate = input.trim();
  if (!candidate) return null;

  // Bare ID already
  if (YT_ID_REGEX.test(candidate)) return candidate;

  // Substring match against known URL shapes
  for (const pattern of URL_PATTERNS) {
    const match = candidate.match(pattern);
    if (match) return match[1];
  }
  return null;
}

module.exports = { extractVideoId, YT_ID_REGEX };
