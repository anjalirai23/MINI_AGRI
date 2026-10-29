const mongoose = require("mongoose");

const predictionSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    type: {
      type: String,
      enum: ["price", "demand", "crop-recommendation", "profit", "sell-wait"],
      required: true,
    },
    crop: { type: String },
    input: { type: mongoose.Schema.Types.Mixed },
    output: { type: mongoose.Schema.Types.Mixed },
  },
  { timestamps: true }
);

module.exports = mongoose.model("Prediction", predictionSchema);
