const mongoose = require("mongoose");

// Single-record settings. registerNo is copied onto each NEW application,
// so changing it never rewrites old applications.
const admissionSettingsSchema = new mongoose.Schema(
  {
    key: { type: String, default: "default", unique: true },
    registerNo: { type: String, default: "U74900PY2011PTC002608", trim: true },
    updatedByName: { type: String, default: "" },
  },
  { timestamps: true }
);

const Model = mongoose.model("AdmissionSettings", admissionSettingsSchema);

Model.getSingleton = async () =>
  Model.findOneAndUpdate(
    { key: "default" },
    { $setOnInsert: { key: "default" } },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );

module.exports = Model;