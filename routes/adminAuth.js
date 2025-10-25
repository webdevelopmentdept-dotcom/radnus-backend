const express = require("express");
const router = express.Router();
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");

router.post("/login", async (req, res) => {
  try {
    const { email, password } = req.body;

    // ✅ Check if email matches admin email
    if (email !== process.env.ADMIN_EMAIL)
      return res.status(400).json({ success: false, msg: "Invalid email" });

    // ✅ Check password
    const isMatch = await bcrypt.compare(password, process.env.ADMIN_HASH_PASSWORD);
    if (!isMatch)
      return res.status(400).json({ success: false, msg: "Invalid password" });

    // ✅ Generate JWT token
    const token = jwt.sign({ email }, process.env.JWT_SECRET, {
      expiresIn: process.env.JWT_EXPIRE,
    });

    res.json({ success: true, token });
  } catch (err) {
    console.error("Login Error:", err);
    res.status(500).json({ success: false, msg: "Server Error" });
  }
});

module.exports = router;
