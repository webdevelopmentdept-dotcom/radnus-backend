const mongoose = require("mongoose");

const UpdateSchema = new mongoose.Schema(
  {
    message: { type: String, required: true }
  },
  { timestamps: true }
);

module.exports = mongoose.model("Update", UpdateSchema);
