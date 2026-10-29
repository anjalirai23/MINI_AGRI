const User = require("../models/User");

const MAX_ACTIVITY = 200;

async function logActivity(userId, message) {
  try {
    await User.findByIdAndUpdate(userId, {
      $push: { activity: { $each: [{ message, at: new Date() }], $slice: -MAX_ACTIVITY } },
    });
  } catch (err) {
    console.error("[activity] failed to log:", err.message);
  }
}

module.exports = { logActivity };
