const express = require("express");
const router = express.Router();

// simple admin login (no token)
router.post("/login", (req, res) => {
  const { email, password } = req.body;

  // replace these with your env values
  const adminEmail = process.env.ADMIN_EMAIL;
  const adminPassword = "sundar"; // use plain text if no hash check

  if (email === adminEmail && password === adminPassword) {
    return res.json({ success: true, msg: "Login successful!" });
  } else {
    return res.status(401).json({ success: false, msg: "Invalid credentials" });
  }
});

module.exports = router;
