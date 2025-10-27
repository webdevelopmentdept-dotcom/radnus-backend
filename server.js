require("dotenv").config();
const express = require("express");
const mongoose = require("mongoose");
const cors = require("cors");

const applicantRoutes = require("./routes/applicants");
const adminAuthRoutes = require("./routes/adminAuth");

const app = express();

// ✅ Allowed origins
const allowedOrigins = [
  "https://radnus-frontend.vercel.app",
  "https://radnus-frontend-3xb7.vercel.app",
  "http://localhost:5173",
];

// ✅ Configure CORS safely
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
    methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
  })
);

// ✅ Optional: handle OPTIONS preflight safely
app.use((req, res, next) => {
  res.header("Access-Control-Allow-Origin", req.headers.origin || "*");
  res.header(
    "Access-Control-Allow-Methods",
    "GET, POST, PUT, DELETE, OPTIONS"
  );
  res.header(
    "Access-Control-Allow-Headers",
    "Content-Type, Authorization, X-Requested-With"
  );
  if (req.method === "OPTIONS") {
    return res.sendStatus(200);
  }
  next();
});

// ✅ Health check for Render
app.get("/", (req, res) => {
  res.send("✅ Backend running fine with updated CORS config!");
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
