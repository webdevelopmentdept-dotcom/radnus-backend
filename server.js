require("dotenv").config();
const express = require("express");
const mongoose = require("mongoose");
const cors = require("cors");
const prerender = require("prerender-node");

const applicantRoutes = require("./routes/applicants");
const adminAuthRoutes = require("./routes/adminAuth");

const app = express();

/* ---------------------------------------------
 ✅ 1. Secure & flexible CORS configuration
----------------------------------------------*/
app.use(
  cors({
    origin: function (origin, callback) {
      const allowed = [
        /https:\/\/(www\.)?radnus\.in$/,              // radnus.in and www.radnus.in
        /https:\/\/radnus-frontend.*\.vercel\.app$/,  // any vercel preview
        /^http:\/\/localhost:5173$/                   // local dev
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

// ✅ Proper OPTIONS preflight handler
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

/* ---------------------------------------------
 ✅ 2. Prerender.io setup for SEO bots
----------------------------------------------*/
app.use(
  prerender
    .set("prerenderToken", "N7ycVhRZGIhFLwN5sPFp") // your actual token
    .set("protocol", "https")
    .set("host", "www.radnus.in") // 👈 Add this line (important!)
);

/* ---------------------------------------------
 ✅ 3. Health check route (for Render)
----------------------------------------------*/
app.get("/", (req, res) => {
  res.send("✅ Backend running fine with CORS + Prerender integration!");
});

/* ---------------------------------------------
 ✅ 4. Middleware + Routes
----------------------------------------------*/
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use("/api/applicants", applicantRoutes);
app.use("/api/admin", adminAuthRoutes);

/* ---------------------------------------------
 ✅ 5. MongoDB connection
----------------------------------------------*/
mongoose
  .connect(process.env.MONGO_URI, {
    useNewUrlParser: true,
    useUnifiedTopology: true,
  })
  .then(() => console.log("✅ MongoDB connected"))
  .catch((err) => console.error("❌ MongoDB connection error:", err));

/* ---------------------------------------------
 ✅ 6. Start server
----------------------------------------------*/
const PORT = process.env.PORT || 5000;
app.listen(PORT, () =>
  console.log(`🚀 Server running successfully on port ${PORT}`)
);
