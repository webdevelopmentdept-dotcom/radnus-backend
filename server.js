require("dotenv").config();
const express = require("express");
const mongoose = require("mongoose");
const cors = require("cors");
const path = require("path");

const applicantRoutes = require("./routes/applicants");
const adminAuthRoutes = require("./routes/adminAuth");

const app = express();

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// API routes
app.use("/api/applicants", applicantRoutes);
app.use("/api/admin", adminAuthRoutes);

// Serve React frontend
app.use(express.static(path.join(__dirname, "../radnus-frontend/build")));

// ✅ Catch-all route for React
app.use((req, res) => {
  res.sendFile(path.resolve(__dirname, "../radnus-frontend/build", "index.html"));
});

// Connect to MongoDB
mongoose
  .connect(process.env.MONGO_URI)
  .then(() => console.log("✅ DB connected"))
  .catch((err) => console.log("❌ DB error:", err));

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));
