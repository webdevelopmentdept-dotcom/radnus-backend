const mongoose = require("mongoose");
const hrHolidaySchema = new mongoose.Schema({
  name: { type: String, required: true },
  date: { type: Date,   required: true },
  type: { type: String, enum: ["public","optional","company"], default: "public" },
}, { timestamps: true });
module.exports = mongoose.model("HrHoliday", hrHolidaySchema);