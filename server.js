require("dotenv").config();
const express = require("express");
const mongoose = require("mongoose");
const cors = require("cors");
const path = require("path");

const applicantRoutes = require("./routes/applicants");
const adminAuthRoutes = require("./routes/adminAuth");

const app = express();

// ✅ Allow specific origins
const allowedOrigins = [
  "https://radnus-frontend.vercel.app",
  "http://localhost:5173",
];

app.use(
  cors({
    origin: allowedOrigins,
    credentials: true,
  })
);

// ✅ Basic health check route
app.get("/", (req, res) => {
  res.send("Backend is running ✅");
});

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Routes
app.use("/api/applicants", applicantRoutes);
app.use("/api/admin", adminAuthRoutes);

// ✅ Connect MongoDB
mongoose
  .connect(process.env.MONGO_URI)
  .then(() => console.log("✅ MongoDB connected"))
  .catch((err) => console.error("❌ MongoDB error:", err));

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));
