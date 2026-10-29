const Alert = require("../models/Alert");
const { logActivity } = require("../services/activity");

const VALID_CROPS = ["wheat", "paddy", "cotton", "maize"];

async function createAlert(req, res, next) {
  try {
    const { crop, targetPrice, condition } = req.body;
    if (!crop || !VALID_CROPS.includes(crop.toLowerCase()) || !targetPrice) {
      return res.status(400).json({ success: false, message: "crop and targetPrice are required" });
    }
    const alert = await Alert.create({
      user: req.userId,
      crop: crop.toLowerCase(),
      targetPrice,
      condition: condition === "below" ? "below" : "above",
    });
    await logActivity(req.userId, `Created a price alert: ${alert.crop} ${alert.condition} ₹${alert.targetPrice}/quintal`);
    res.status(201).json({ success: true, data: alert, message: "Alert created" });
  } catch (err) {
    next(err);
  }
}

async function listAlerts(req, res, next) {
  try {
    const alerts = await Alert.find({ user: req.userId }).sort({ createdAt: -1 });
    res.json({ success: true, data: alerts });
  } catch (err) {
    next(err);
  }
}

async function deleteAlert(req, res, next) {
  try {
    const alert = await Alert.findOneAndDelete({ _id: req.params.id, user: req.userId });
    if (!alert) return res.status(404).json({ success: false, message: "Alert not found" });
    await logActivity(req.userId, `Deleted a price alert: ${alert.crop} ${alert.condition} ₹${alert.targetPrice}/quintal`);
    res.json({ success: true, message: "Alert deleted" });
  } catch (err) {
    next(err);
  }
}

module.exports = { createAlert, listAlerts, deleteAlert };
