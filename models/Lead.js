const mongoose = require("mongoose");

const leadSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
    },

    phone: {
      type: String,
      required: true,
    },

    email: {
      type: String,
      default: "",
    },

    course: {
      type: String,
      required: true,
    },

    advance: {
      type: Number,
      required: true,
    },

    proof: {
      type: String,
      default: "",
    },

    notes: {
      type: String,
      default: "",
    },

    partnerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Partner",
      required: true,
    },

    status: {
      type: String,
      default: "Pending",
    },

    date: {
      type: Date,
      default: Date.now,
    },
  },
  {
    timestamps: true, // Auto createdAt + updatedAt
  }
);

module.exports = mongoose.model("Lead", leadSchema);
