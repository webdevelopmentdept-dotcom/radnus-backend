const express = require("express");
const router = express.Router();

router.post("/login", (req, res) => {
  const { email, password } = req.body;
  const adminEmail = process.env.ADMIN_EMAIL;
  const adminPassword = "sundar"; // or use bcrypt if needed

  if (email === adminEmail && password === adminPassword) {
    return res.json({ success: true, msg: "Admin login successful!" });
  } else {
    return res.status(401).json({ success: false, msg: "Invalid credentials" });
  }
});

module.exports = router;
