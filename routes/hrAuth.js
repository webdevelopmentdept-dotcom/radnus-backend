const express = require("express");
const bcrypt = require("bcrypt");
const router = express.Router();

router.post("/login", async (req, res) => {
  const { email, password } = req.body;
  const hrEmail = process.env.HR_EMAIL;
  const hrHash = process.env.HR_HASH_PASSWORD; // ✅ use from .env

  if (email === hrEmail) {
    const match = await bcrypt.compare(password, hrHash);
    if (match) {
      return res.json({ success: true, msg: "HR login successful" });
    }
    return res.status(401).json({ success: false, msg: "Invalid password" });
  }

  return res.status(401).json({ success: false, msg: "Invalid credentials" });
});

module.exports = router;
