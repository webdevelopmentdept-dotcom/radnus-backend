const router = require("express").Router();
const Payment = require("../models/Payment");

router.get("/", async (req, res) => {
  const payments = await Payment.find()
    .populate("partnerId", "name")
    .populate("leadId", "customerName");
  res.json(payments);
});

module.exports = router;
