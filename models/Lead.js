const mongoose = require("mongoose");

const leadSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    phone: { type: String, required: true, trim: true },
    email: { type: String, default: "", trim: true },

    course: { type: String, required: true },

    advance: { type: Number, required: true, min: 1 },

    partnerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Partner",
      required: true,
    },

    partnerName: { type: String, required: true },

   paymentId: { type: String, default: "" },
orderId: { type: String, default: "" },


    paymentStatus: {
      type: String,
      enum: ["PAID"],
      default: "PAID",
    },

    /* 🔥 ADD THIS FIELD */
    proof: { type: String, default: "" },

    status: {
  type: String,
  enum: ["PENDING", "CONTACTED", "CONVERTED", "REJECTED"],
  default: "PENDING",
},


    remark: { type: String, default: "" },

    date: { type: Date, default: Date.now },
  },
  { timestamps: true }
);

module.exports = mongoose.model("Lead", leadSchema);
