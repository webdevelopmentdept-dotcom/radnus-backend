require("dotenv").config();
const express = require("express");
const mongoose = require("mongoose");
const cors = require("cors");
const path = require("path");

const applicantRoutes = require("./routes/applicants");
const adminAuthRoutes = require("./routes/adminAuth");

const app = express();

// ✅ Allow specific origins (include both localhost and Vercel)
const allowedOrigins = [
  "https://radnus-frontend.vercel.app",
  "https://radnus-frontend-3xb7.vercel.app",
  "http://localhost:5173",
];

// ✅ Proper CORS setup with function check
app.use(
  cors({
    origin: function (origin, callback) {
      if (!origin || allowedOrigins.includes(origin)) {
        callback(null, true);
      } else {
        console.log("❌ Blocked by CORS:", origin);
        callback(new Error("Not allowed by CORS"));
      }
    },
    credentials: true,
  })
);

// ✅ Handle preflight requests (important for POST from browser)
app.options("*", cors());

// ✅ Basic health check route (Render check)
app.get("/", (req, res) => {
  res.send("✅ Backend is running and CORS configured properly!");
});

// ✅ Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// ✅ Routes
app.use("/api/applicants", applicantRoutes);
app.use("/api/admin", adminAuthRoutes);

// ✅ MongoDB connection
mongoose
  .connect(process.env.MONGO_URI)
  .then(() => console.log("✅ MongoDB connected"))
  .catch((err) => console.error("❌ MongoDB connection error:", err));

// ✅ Start server
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));
