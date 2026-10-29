const express = require("express");
const router = express.Router();
const { priceForecast, demandForecast, history } = require("../controllers/mlController");
const requireAuth = require("../middleware/auth");

router.post("/price-forecast", requireAuth, priceForecast);
router.post("/demand-forecast", requireAuth, demandForecast);
router.get("/history", requireAuth, history);

module.exports = router;
