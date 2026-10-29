const mlService = require("./mlService");
const Alert = require("../models/Alert");
const { logActivity } = require("./activity");

async function checkAlertsForUser(userId) {
  const alerts = await Alert.find({ user: userId, active: true, triggered: false });
  const triggered = [];

  for (const alert of alerts) {
    try {
      const result = await mlService.predictPrice({ crop: alert.crop, model: "auto", horizonDays: 30 });
      const forecastPrice = result.data.forecast_price;
      const hit =
        alert.condition === "above" ? forecastPrice >= alert.targetPrice : forecastPrice <= alert.targetPrice;

      if (hit) {
        alert.triggered = true;
        alert.triggeredAt = new Date();
        alert.active = false;
        await alert.save();

        const message = `Price alert: ${alert.crop} forecast (₹${forecastPrice}/quintal) is now ${alert.condition} your target of ₹${alert.targetPrice}/quintal.`;
        await logActivity(userId, message);

        triggered.push({ id: alert._id, crop: alert.crop, targetPrice: alert.targetPrice, forecastPrice, message });
      }
    } catch (err) {
      console.error(`Alert check failed for alert ${alert._id}:`, err.message);
    }
  }

  return triggered;
}

async function checkAllActiveAlerts() {
  const userIds = await Alert.distinct("user", { active: true, triggered: false });
  let totalTriggered = 0;
  for (const userId of userIds) {
    const triggered = await checkAlertsForUser(userId);
    totalTriggered += triggered.length;
  }
  console.log(`[agent] alert sweep complete — ${totalTriggered} alert(s) triggered across ${userIds.length} user(s)`);
  return totalTriggered;
}

module.exports = { checkAlertsForUser, checkAllActiveAlerts };
