require("dotenv").config();
const express = require("express");
const mongoose = require("mongoose");
const cors = require("cors");
const prerender = require("prerender-node");
const path = require("path");
const employeeAuth = require("./routes/employeeAuth");

const dns = require("dns");
dns.setServers(["1.1.1.1", "8.8.8.8"]);

const app = express();

/* --------------------------------------------------
   MIDDLEWARES
-------------------------------------------------- */

// Parse JSON + Form Data
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
// Static Uploads Folder (Important for partner documents)
app.use("/uploads", express.static(path.join(__dirname, "uploads")));

const allowedOrigins = [
  "https://radnus.in",
  "https://www.radnus.in",
  "https://radnus-frontend-3xb7.vercel.app",
  "http://localhost:5173"
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
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
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
const hrPendingRoutes = require("./routes/hrPendingRoutes");
const hrRejectedRoutes = require("./routes/hrRejectedRoutes");

const kpiTemplateRoutes = require('./routes/kpiTemplateRoutes');

const shopOwnerRoutes = require("./routes/shopownerRoutes");
const technicianRoutes = require("./routes/technicianRoutes");

const kpiAssignmentRoutes = require('./routes/kpiAssignmentRoutes');
const selfAssessmentRoutes = require('./routes/selfAssessmentRoutes');
const performanceReviewRoutes = require('./routes/performanceReviewRoutes');
const dailyLogRoutes = require('./routes/dailyLogRoutes');
const attendanceRoutes = require("./routes/attendance");
const jobRoutes = require("./routes/jobRoutes");
const okrDashboard = require('./routes/okrdashboardRoutes');
const gradeRoutes = require("./routes/gradeRoutes");
const okrRoutes = require('./routes/okr');
const FeedbackCycle = require('./routes/Feedbackcycle');
const variablePayRoutes = require("./routes/variablePay"); 
const feedbackSubmission = require("./routes/feedbacksubmission");

const feedbackTaskRoutes = require("./routes/feedbackTask.routes");
const feedbackNominationRoutes = require("./routes/Feedbacknomination");
const employeeAwardRoutes = require("./routes/employeeAwards");
const esopRoutes = require("./routes/esop");
const impactBonusRoutes = require("./routes/impactBonus");
const deptRoutes = require("./routes/departmentRoutes");
const engagementRoutes = require("./routes/engagementRoutes");
const wellnessRoutes = require('./routes/wellnessRoutes');
const clubRoutes = require("./routes/clubsRoutes");
const leadershipRoutes = require("./routes/leadership.routes");
const retentionRoutes = require("./routes/retention.routes");
const alumniRoutes = require("./routes/alumniRoutes");
const trainingRoutes = require("./routes/trainingrcaRoutes");
/* --------------------------------------------------
   REGISTER ROUTES
-------------------------------------------------- */

app.use("/api/partners", partnerRoutes);
app.use("/api/payments", paymentRoutes);
app.use("/api/employee", employeeAuth);
// Lead Correct Route (only one)
app.use("/api/lead", leadRoutes);
app.use("/api/notifications", require("./routes/NotificationRoutes"));
app.use("/api/jobs", jobRoutes);
app.use('/api/okr-dashboard', okrDashboard);
app.use("/api/grade-master", gradeRoutes);
app.use("/api/assign-grade", require("./routes/assignGrade"));
app.use('/api/okr', okrRoutes);
app.use('/api/feedback-cycles', FeedbackCycle);
app.use("/api/variable-pay", variablePayRoutes);
app.use("/api/feedback-submissions", feedbackSubmission);
app.use("/api/feedback-nominations", feedbackNominationRoutes); 
app.use("/api/employee-awards", employeeAwardRoutes);
app.use("/api/feedback-tasks", feedbackTaskRoutes);
app.use("/api/esop", esopRoutes);
app.use("/api/impact-bonus", impactBonusRoutes);
app.use("/api/departments", deptRoutes);
app.use("/api/engagement", engagementRoutes);
app.use("/api/clubs", clubRoutes);
app.use("/api/leadership", leadershipRoutes);
app.use("/api/retention", retentionRoutes);
app.use("/api", alumniRoutes);
app.use("/api", trainingRoutes);


// HR Modules
app.use("/api/hr", hrAuthRoutes);
app.use("/api/hr", hrApplyRoutes);
app.use("/api/hr", hrApplicationsRoutes);
app.use("/api/hr", hrPendingRoutes);
app.use("/api/hr/activation", require("./routes/hrActivationRoutes"));
app.use('/api/wellness', wellnessRoutes);
app.use('/api/wellnesshr', require('./routes/wellnesshr'));
app.use('/api/wellnessemployee', require('./routes/wellnessemployee'));
app.use('/api/employee-auth', require('./routes/employeeAuth'));

// Applicants & Admin
app.use("/api/applicants", applicantRoutes);
app.use("/api/admin", adminAuthRoutes);
app.use("/api/courses", require("./routes/courseRoutes"));
app.use("/api/updates", require("./routes/updateRoutes"));
app.use("/api/hr", hrRejectedRoutes);
app.use('/api/kpi-templates', kpiTemplateRoutes);
app.use('/api/kpi-assignments', kpiAssignmentRoutes);
app.use('/api/self-assessment', selfAssessmentRoutes);
app.use('/api/performance-reviews', performanceReviewRoutes);
app.use('/api/daily-logs', dailyLogRoutes);
app.use("/api/hr/settings", require("./routes/hrSettingsRoutes"));

app.use("/api", attendanceRoutes);

app.use("/api/shop-owner", shopOwnerRoutes);
app.use("/api/technician", technicianRoutes);

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
