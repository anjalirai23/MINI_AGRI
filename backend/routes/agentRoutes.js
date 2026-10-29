const express = require("express");
const router = express.Router();
const { chat, history, resetHistory, checkAlerts, status } = require("../controllers/agentController");
const requireAuth = require("../middleware/auth");

router.use(requireAuth);
router.get("/status", status);
router.post("/chat", chat);
router.get("/history", history);
router.delete("/history", resetHistory);
router.post("/check-alerts", checkAlerts);

module.exports = router;
