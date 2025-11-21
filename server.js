require("dotenv").config();
const express = require("express");
const mongoose = require("mongoose");
const cors = require("cors");
const prerender = require("prerender-node");
const path = require("path");

const app = express();

/* --------------------------------------------------
   MIDDLEWARES
-------------------------------------------------- */

// Parse JSON + Form Data
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Static Uploads Folder (Important for partner documents)
app.use("/uploads", express.static(path.join(__dirname, "uploads")));

// Allowed CORS Origins
const allowedOrigins = [
  "https://www.radnus.in",
  "https://radnus-frontend-3xb7.vercel.app",
  "http://localhost:5173",
];

// CORS Middleware
app.use(
  cors({
    origin: (origin, callback) => {
      if (!origin || allowedOrigins.includes(origin)) {
        return callback(null, true);
      }
      return callback(new Error("Not allowed by CORS"));
    },
    methods: ["GET", "POST", "PUT", "DELETE"],
    allowedHeaders: ["Content-Type", "Authorization"],
  })
);

// SEO Prerender
app.use(prerender.set("prerenderToken", "N7ycVhRZGIhFLwN5sPFp"));

/* --------------------------------------------------
   ROUTES IMPORT
-------------------------------------------------- */

// CPMS Modules
const partnerRoutes = require("./routes/partnerRoutes");
const leadRoutes = require("./routes/leadRoutes");
const paymentRoutes = require("./routes/paymentRoutes");


// HR / Training Modules
const hrAuthRoutes = require("./routes/hrAuth");
const hrApplyRoutes = require("./routes/hrApply");
const applicantRoutes = require("./routes/applicants");
const adminAuthRoutes = require("./routes/adminAuth");
const hrApplicationsRoutes = require("./routes/hrApplications");


/* --------------------------------------------------
   REGISTER ROUTES
-------------------------------------------------- */

app.use("/api/partners", partnerRoutes);
app.use("/api/payments", paymentRoutes);

// Lead Correct Route (only one)
app.use("/api/lead", leadRoutes);

// HR Modules
app.use("/api/hr", hrAuthRoutes);
app.use("/api/hr", hrApplyRoutes);
app.use("/api/hr", hrApplicationsRoutes);

// Applicants & Admin
app.use("/api/applicants", applicantRoutes);
app.use("/api/admin", adminAuthRoutes);






/* --------------------------------------------------
   HEALTH CHECK
-------------------------------------------------- */
app.get("/", (req, res) => {
  res.send("Backend running fine!");
});

/* --------------------------------------------------
   MONGODB CONNECTION
-------------------------------------------------- */

mongoose
  .connect(process.env.MONGO_URI, {
    useNewUrlParser: true,
    useUnifiedTopology: true,
  })
  .then(() => console.log("✅ MongoDB connected successfully"))
  .catch((err) => console.error("❌ MongoDB connection error:", err));

/* --------------------------------------------------
   START SERVER
-------------------------------------------------- */

const PORT = process.env.PORT || 5000;

app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
});
