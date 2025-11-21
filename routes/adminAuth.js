const express = require("express");
const router = express.Router();

router.post("/login", (req, res) => {
  const { email, password } = req.body;

  const adminEmail = process.env.ADMIN_EMAIL;
  const adminPassword = "sundar";

  if (!adminEmail || !adminPassword) {
    return res.status(500).json({
      success: false,
      msg: "Admin credentials not set in server",
    });
  }

  if (email === adminEmail && password === adminPassword) {
    return res.json({ success: true, msg: "Admin login successful!" });
  } else {
    return res
      .status(401)
      .json({ success: false, msg: "Invalid credentials" });
  }
});

module.exports = router;
