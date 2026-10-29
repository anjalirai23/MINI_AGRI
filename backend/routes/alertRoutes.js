const express = require("express");
const router = express.Router();
const { createAlert, listAlerts, deleteAlert } = require("../controllers/alertController");
const requireAuth = require("../middleware/auth");

router.use(requireAuth);
router.post("/", createAlert);
router.get("/", listAlerts);
router.delete("/:id", deleteAlert);

module.exports = router;
