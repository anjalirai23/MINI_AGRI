const mongoose = require("mongoose");

const alertSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    crop: { type: String, required: true },
    targetPrice: { type: Number, required: true },
    condition: { type: String, enum: ["above", "below"], default: "above" },
    active: { type: Boolean, default: true },
    triggered: { type: Boolean, default: false },
    triggeredAt: { type: Date },
    createdBy: { type: String, enum: ["user", "agent"], default: "user" },
  },
  { timestamps: true }
);

module.exports = mongoose.model("Alert", alertSchema);
