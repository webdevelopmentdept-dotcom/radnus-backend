const mongoose = require("mongoose");

const PartnerSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: [true, "Name is required"],
      trim: true,
    },

    email: {
      type: String,
      required: [true, "Email is required"],
      trim: true,
      lowercase: true,
      unique: true,
    },

    phone: {
      type: String,
      required: [true, "Phone number is required"],
      trim: true,
    },

    address: {
      type: String,
      required: [true, "Address is required"],
    },

    password: {
      type: String,
      required: [true, "Password is required"],
    },

    createdAt: {
      type: Date,
      default: Date.now,
    },

    document: {
      type: String,
      default: "",
    },

    disabled: {
      type: Boolean,
      default: false,
    },
  },
  {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  }
);

/* 🔥 VIRTUAL FIELD — AUTO CALCULATE LEAD COUNT */
PartnerSchema.virtual("leadsCount", {
  ref: "Lead",
  localField: "_id",
  foreignField: "partnerId",
  count: true,
});

module.exports = mongoose.model("Partner", PartnerSchema);
