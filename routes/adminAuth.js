const express = require("express");
const router = express.Router();
const bcrypt = require("bcryptjs");

// Simple login route (NO TOKEN)
router.post("/login", async (req, res) => {
  try {
    const { email, password } = req.body;

    if (email !== process.env.ADMIN_EMAIL) {
      return res.status(400).json({ success: false, msg: "Invalid email" });
    }

    const isMatch = await bcrypt.compare(password, process.env.ADMIN_HASH_PASSWORD);
    if (!isMatch) {
      return res.status(400).json({ success: false, msg: "Invalid password" });
    }

    // ✅ Instead of token, just send success message
    res.json({ success: true, msg: "Login successful" });
  } catch (err) {
    console.error("Login Error:", err);
    res.status(500).json({ success: false, msg: "Server Error" });
  }
});

module.exports = router;
