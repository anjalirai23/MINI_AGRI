require("dotenv").config();
const express = require("express");
const cors = require("cors");
const connectDB = require("./config/db");
const { errorHandler, notFound } = require("./middleware/errorHandler");

const authRoutes = require("./routes/authRoutes");
const mlRoutes = require("./routes/mlRoutes");
const alertRoutes = require("./routes/alertRoutes");
const weatherRoutes = require("./routes/weatherRoutes");
const agentRoutes = require("./routes/agentRoutes");

const app = express();

app.use(cors());
app.use(express.json());

app.get("/api/health", (req, res) => res.json({ success: true, message: "AgriMarket AI backend is running" }));

app.use("/api/auth", authRoutes);
app.use("/api/ml", mlRoutes);
app.use("/api/alerts", alertRoutes);
app.use("/api/weather", weatherRoutes);
app.use("/api/agent", agentRoutes);

app.use(notFound);
app.use(errorHandler);

const PORT = process.env.PORT || 5000;

connectDB().then(() => {
  app.listen(PORT, () => console.log(`AgriMarket AI backend listening on port ${PORT}`));

  if (process.env.ENABLE_ALERT_CRON === "true") {
    const cron = require("node-cron");
    const { checkAllActiveAlerts } = require("./services/agentAutomation");
    cron.schedule("0 * * * *", () => {
      checkAllActiveAlerts().catch((err) => console.error("[agent] scheduled alert sweep failed:", err.message));
    });
    console.log("[agent] hourly alert-check cron enabled");
  }
});
