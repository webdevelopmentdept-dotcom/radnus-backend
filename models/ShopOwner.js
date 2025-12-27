const mongoose = require("mongoose");

const invalidValueValidator = {
  validator: function (v) {
    if (!v) return false;
    if (typeof v === "string") {
      const val = v.trim();
      return val !== "" && val !== "-" && val !== "--";
    }
    return true;
  },
  message: "Invalid value provided",
};

const ShopOwnerSchema = new mongoose.Schema(
  {
    shopName: {
      type: String,
      required: true,
      trim: true,
      validate: invalidValueValidator,
    },

    ownerName: {
      type: String,
      required: true,
      trim: true,
      validate: invalidValueValidator,
    },

    mobile: {
      type: String,
      required: true,
      unique: true,
      trim: true,
      validate: invalidValueValidator,
    },

    district: {
      type: String,
      required: true,
      validate: invalidValueValidator,
    },

    taluk: {
      type: String,
      required: true,
      validate: invalidValueValidator,
    },

    address: String,

    businessYears: {
      type: String,
      required: true,
      validate: invalidValueValidator,
    },

    needTech: {
      type: String,
      required: true,
      validate: invalidValueValidator,
    },

    technicianTypes: {
      type: [String],
      required: true,
      validate: [(v) => v.length > 0, "Technician type required"],
    },

    jobType: {
      type: String,
      required: true,
      validate: invalidValueValidator,
    },

    experience: {
      type: String,
      required: true,
      validate: invalidValueValidator,
    },

    paymentType: {
      type: String,
      required: true,
      validate: invalidValueValidator,
    },

    salaryRange: String,
    workingHours: String,
    foodAccommodation: String,

    toolsSetup: {
      type: String,
      required: true,
      validate: invalidValueValidator,
    },

    machines: {
      type: [String],
      required: true,
      validate: [(v) => v.length > 0, "At least one machine required"],
    },

    timeline: {
      type: String,
      required: true,
      validate: invalidValueValidator,
    },

    skills: String,

    radnusHire: {
      type: String,
      required: true,
      validate: invalidValueValidator,
    },

    remarks: String,

    status: { type: String, default: "Pending" },
  },
  { timestamps: true }
);


module.exports = mongoose.model("ShopOwner", ShopOwnerSchema);

module.exports = mongoose.model("ShopOwner", ShopOwnerSchema);

