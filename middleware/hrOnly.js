module.exports = (req, res, next) => {
  if (req.user && ["hr", "admin"].includes(req.user.role)) return next();
  return res.status(403).json({ success: false, message: "HR_ONLY" });
};