const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const User = require("../models/User");
const Prediction = require("../models/Prediction");
const Alert = require("../models/Alert");
const AgentConversation = require("../models/AgentConversation");
const { logActivity } = require("../services/activity");

function signToken(userId) {
  return jwt.sign({ userId }, process.env.JWT_SECRET, { expiresIn: "7d" });
}

function publicUser(user) {
  return {
    id: user._id,
    name: user.name,
    email: user.email,
    phone: user.phone || "",
    location: user.location || "",
    logins: user.logins,
    lastLogin: user.lastLogin,
    createdAt: user.createdAt,
    activity: user.activity.slice(-20).reverse(),
  };
}

async function register(req, res, next) {
  try {
    const { name, email, password, phone, location } = req.body;
    if (!name || !email || !password) {
      return res.status(400).json({ success: false, message: "Name, email and password are required" });
    }
    if (password.length < 6) {
      return res.status(400).json({ success: false, message: "Password must be at least 6 characters" });
    }
    const existing = await User.findOne({ email: email.toLowerCase() });
    if (existing) {
      return res.status(409).json({ success: false, message: "An account with this email already exists" });
    }
    const passwordHash = await bcrypt.hash(password, 10);
    const user = await User.create({
      name,
      email: email.toLowerCase(),
      passwordHash,
      phone,
      location,
      logins: 1,
      lastLogin: new Date(),
      activity: [{ message: "Account created" }],
    });
    const token = signToken(user._id);
    res.status(201).json({ success: true, data: { token, user: publicUser(user) }, message: "Account created" });
  } catch (err) {
    next(err);
  }
}

async function login(req, res, next) {
  try {
    const { email, password } = req.body;
    if (!email || !password) {
      return res.status(400).json({ success: false, message: "Email and password are required" });
    }
    const user = await User.findOne({ email: email.toLowerCase() });
    if (!user) {
      return res.status(401).json({ success: false, message: "Invalid email or password" });
    }
    const match = await bcrypt.compare(password, user.passwordHash);
    if (!match) {
      return res.status(401).json({ success: false, message: "Invalid email or password" });
    }
    user.logins += 1;
    user.lastLogin = new Date();
    user.activity.push({ message: "Logged in" });
    await user.save();
    const token = signToken(user._id);
    res.json({ success: true, data: { token, user: publicUser(user) }, message: "Logged in successfully" });
  } catch (err) {
    next(err);
  }
}

async function profile(req, res, next) {
  try {
    const user = await User.findById(req.userId);
    if (!user) return res.status(404).json({ success: false, message: "User not found" });
    res.json({ success: true, data: { user: publicUser(user) } });
  } catch (err) {
    next(err);
  }
}

async function updateProfile(req, res, next) {
  try {
    const { name, phone, location } = req.body || {};
    const update = {};
    if (name !== undefined) {
      if (!String(name).trim()) return res.status(400).json({ success: false, message: "Name can't be empty" });
      update.name = String(name).trim().slice(0, 80);
    }
    if (phone !== undefined) {
      const p = String(phone).trim();
      if (p && !/^[+\d][\d\s-]{6,17}$/.test(p)) return res.status(400).json({ success: false, message: "Enter a valid phone number" });
      update.phone = p;
    }
    if (location !== undefined) update.location = String(location).trim().slice(0, 120);
    const user = await User.findByIdAndUpdate(req.userId, update, { new: true });
    if (!user) return res.status(404).json({ success: false, message: "User not found" });
    await logActivity(req.userId, "Updated profile details");
    const fresh = await User.findById(req.userId);
    res.json({ success: true, data: { user: publicUser(fresh) }, message: "Profile updated" });
  } catch (err) {
    next(err);
  }
}

async function changePassword(req, res, next) {
  try {
    const { currentPassword, newPassword } = req.body || {};
    if (!currentPassword || !newPassword) return res.status(400).json({ success: false, message: "Current and new password are required" });
    if (newPassword.length < 6) return res.status(400).json({ success: false, message: "New password must be at least 6 characters" });
    const user = await User.findById(req.userId);
    if (!user) return res.status(404).json({ success: false, message: "User not found" });
    if (!(await bcrypt.compare(currentPassword, user.passwordHash))) {
      return res.status(401).json({ success: false, message: "Current password is incorrect" });
    }
    user.passwordHash = await bcrypt.hash(newPassword, 10);
    await user.save();
    await logActivity(req.userId, "Changed account password");
    res.json({ success: true, message: "Password changed" });
  } catch (err) {
    next(err);
  }
}

async function overview(req, res, next) {
  try {
    const user = await User.findById(req.userId);
    if (!user) return res.status(404).json({ success: false, message: "User not found" });

    const [predictions, alerts, convo, priceRuns, demandRuns, cropCounts] = await Promise.all([
      Prediction.find({ user: req.userId }).sort({ createdAt: -1 }).limit(60).lean(),
      Alert.find({ user: req.userId }).sort({ createdAt: -1 }).limit(50).lean(),
      AgentConversation.findOne({ user: req.userId }).lean(),
      Prediction.countDocuments({ user: req.userId, type: "price" }),
      Prediction.countDocuments({ user: req.userId, type: "demand" }),
      Prediction.aggregate([
        { $match: { user: user._id, crop: { $type: "string" } } },
        { $group: { _id: "$crop", n: { $sum: 1 } } },
        { $sort: { n: -1 } },
      ]),
    ]);

    const chatMessages = (convo?.messages || []).filter((m) => m.role === "user").length;

    res.json({
      success: true,
      data: {
        user: { ...publicUser(user), activity: user.activity.slice(-100).reverse() },
        stats: {
          logins: user.logins,
          memberSince: user.createdAt,
          lastLogin: user.lastLogin,
          priceForecasts: priceRuns,
          demandForecasts: demandRuns,
          totalForecasts: priceRuns + demandRuns,
          activeAlerts: alerts.filter((a) => a.active && !a.triggered).length,
          triggeredAlerts: alerts.filter((a) => a.triggered).length,
          assistantQuestions: chatMessages,
          topCrop: cropCounts[0]?._id || null,
          cropBreakdown: cropCounts.map((c) => ({ crop: c._id, count: c.n })),
        },
        predictions: predictions.map((p) => ({
          id: p._id,
          type: p.type,
          crop: p.crop,
          at: p.createdAt,
          input: { model: p.input?.model, horizonDays: p.input?.horizonDays, horizonWeeks: p.input?.horizonWeeks },
          result: p.output?.forecastPrice !== undefined || p.output?.predictedDemand !== undefined ? p.output : legacySummary(p),
        })),
        alerts: alerts.map((a) => ({
          id: a._id, crop: a.crop, targetPrice: a.targetPrice, condition: a.condition,
          active: a.active, triggered: a.triggered, triggeredAt: a.triggeredAt,
          createdBy: a.createdBy, createdAt: a.createdAt,
        })),
      },
    });
  } catch (err) {
    next(err);
  }
}

function legacySummary(p) {
  const o = p.output || {};
  if (p.type === "price") {
    return { model: o.model, currentPrice: o.current_price, forecastPrice: o.forecast_price, pctChange: o.pct_change, confidence: o.confidence, horizonDays: o.horizon_days };
  }
  return { model: o.model, currentDemand: o.current_demand_index, predictedDemand: o.predicted_demand_index, trend: o.demand_trend, level: o.demand_level, horizonWeeks: o.horizon_weeks };
}

module.exports = { register, login, profile, updateProfile, changePassword, overview };
