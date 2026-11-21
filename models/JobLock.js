const mongoose = require("mongoose");

const jobLockSchema = new mongoose.Schema({
  key: { type: String, required: true, unique: true },
  createdAt: { type: Date, default: Date.now, expires: 60 * 60 * 24 * 7 }, // 7 naal apram auto-delete
});

module.exports = mongoose.model("JobLock", jobLockSchema);