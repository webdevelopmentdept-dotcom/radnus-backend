require("dotenv").config();
const express = require("express");
const mongoose = require("mongoose");
const cors = require("cors");

const applicantRoutes = require("./routes/applicants");
const adminAuthRoutes = require("./routes/adminAuth");

const app = express();
// ✅ Configure CORS using regex for flexibility
app.use(
  cors({
    origin: function (origin, callback) {
      const allowed = [
        /https:\/\/(www\.)?radnus\.in$/,              // ✅ Matches radnus.in and www.radnus.in
        /https:\/\/radnus-frontend.*\.vercel\.app$/,  // ✅ Matches any Vercel frontend
        /^http:\/\/localhost:5173$/                   // ✅ Matches localhost:5173
      ];

      if (!origin || allowed.some((pattern) => pattern.test(origin))) {
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

// ✅ Express 5–safe preflight handling (no wildcards)
app.use((req, res, next) => {
  if (req.method === "OPTIONS") {
    res.header("Access-Control-Allow-Origin", req.headers.origin || "*");
    res.header("Access-Control-Allow-Methods", "GET,POST,PUT,DELETE,OPTIONS");
    res.header(
      "Access-Control-Allow-Headers",
      "Content-Type, Authorization, X-Requested-With"
    );
    return res.sendStatus(200);
  }
  next();
});

const prerender = require("prerender-node");

app.use(
  prerender
    .set("prerenderToken", "N7ycVhRZGIhFLwN5sPFp")  // your actual token
    .set("protocol", "https")
);

// ✅ Health check route
app.get("/", (req, res) => {
  res.send("✅ Backend running fine with updated CORS & fixed preflight route!");
});

// ✅ Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// ✅ Routes
app.use("/api/applicants", applicantRoutes);
app.use("/api/admin", adminAuthRoutes);

// ✅ MongoDB connection
mongoose
  .connect(process.env.MONGO_URI, {
    useNewUrlParser: true,
    useUnifiedTopology: true,
  })
  .then(() => console.log("✅ MongoDB connected"))
  .catch((err) => console.error("❌ MongoDB connection error:", err));

// ✅ Start server
const PORT = process.env.PORT || 5000;
app.listen(PORT, () =>
  console.log(`🚀 Server running successfully on port ${PORT}`)
);
