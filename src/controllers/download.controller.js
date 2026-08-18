const { getDownload } = require("../services/ytmp4.service");
const { parseDownloadParams } = require("../utils/validation");

async function downloadHandler(req, res, next) {
  const { errors, params } = parseDownloadParams(req.query);

  if (errors.length > 0) {
    return res.status(400).json({
      success: false,
      errors,
      hint: "Example: /api/download?url=https://youtu.be/dQw4w9WgXcQ&type=video&quality=720",
    });
  }

  try {
    const result = await getDownload(params.videoId, params.type, params.quality);
    return res.json({ success: true, ...result });
  } catch (err) {
    return next(err); // centralized error handler decides the status
  }
}

module.exports = { downloadHandler };
