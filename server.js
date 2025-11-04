require("dotenv").config();
const express = require("express");
const mongoose = require("mongoose");
const cors = require("cors");
const prerender = require("prerender-node");
const path = require("path");

const hrAuthRoutes = require("./routes/hrAuth");
const hrApplyRoutes = require("./routes/hrApply");
const applicantRoutes = require("./routes/applicants");
const adminAuthRoutes = require("./routes/adminAuth");
const hrApplicationsRoutes = require("./routes/hrApplications");

const app = express();

// ✅ Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// ✅ Allowed origins (local + live)
const allowedOrigins = [
  "https://www.radnus.in",                 // custom domain
  "https://radnus-frontend-3xb7.vercel.app", // vercel preview domain
  "http://localhost:5173",                 // local development
];

// ✅ CORS setup
app.use(
  cors({
    origin: function (origin, callback) {
      // allow requests with no origin (e.g. mobile apps, curl)
      if (!origin || allowedOrigins.includes(origin)) {
        callback(null, true);
      } else {
        callback(new Error("Not allowed by CORS"));
      }
    },
    methods: ["GET", "POST", "PUT", "DELETE"],
    allowedHeaders: ["Content-Type", "Authorization"],
  })
);

// ✅ Serve uploads folder (for resume view/download)
app.use("/uploads", express.static(path.join(__dirname, "uploads")));

// ✅ Prerender setup
app.use(prerender.set("prerenderToken", "N7ycVhRZGIhFLwN5sPFp"));

// ✅ Routes
app.use("/api/hr", hrAuthRoutes);
app.use("/api/hr", hrApplyRoutes);
app.use("/api/hr", hrApplicationsRoutes);
app.use("/api/applicants", applicantRoutes);
app.use("/api/admin", adminAuthRoutes);

// ✅ Health check
app.get("/", (req, res) => {
  res.send("✅ Backend running fine!");
});

// ✅ MongoDB Connection
mongoose
  .connect(process.env.MONGO_URI)
  .then(() => console.log("✅ MongoDB connected"))
  .catch((err) => console.error("❌ MongoDB error:", err));

// ✅ Start server
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));
