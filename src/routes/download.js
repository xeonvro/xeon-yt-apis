const { Router } = require("express");
const { downloadHandler } = require("../controllers/download.controller");

const router = Router();

// GET /api/download?url=...|id=...&type=audio|video&quality=480|720|1080&bitrate=320
router.get("/", downloadHandler);

module.exports = router;
