const express = require("express");
const router = express.Router();
const HrApplicant = require("../models/HrApplicant");
const Job = require("../models/Job");

// ✅ Get all HR job applications
// ✅ Get all HR job applications (public + internal merged)
router.get("/applications", async (req, res) => {
  try {
    // 1️⃣ Existing public applications
    const applications = await HrApplicant.find().sort({ createdAt: -1 });

    // 2️⃣ Internal job applicants
    const internalJobs = await Job.find({ visibility: "internal" }).populate(
      "applicants.employeeId",
      "name email mobile phone department designation employeeId"
    );

    const internalApps = [];
    internalJobs.forEach((job) => {
      (job.applicants || []).forEach((app) => {
        const emp = app.employeeId;
        if (!emp) return;

        const statusMap = {
          applied:      "New",
          under_review: "Shortlisted",
          interview:    "Interview",
          selected:     "Hired",
          rejected:     "Rejected",
        };

        internalApps.push({
  _id:           `internal_${job._id}_${emp._id}`,
  name:          emp.name        || "—",
  email:         emp.email       || "—",
  phone:         emp.mobile || emp.phone || "—",
  jobTitle:      job.title,
  location:      emp.department  || "—",
  department:    emp.department  || "—",
  status:        statusMap[app.status] || "New",
  rawStatus:     app.status || "applied",  // ✅ ADD THIS LINE ONLY
  createdAt:     app.appliedAt   || new Date(),
  resumeUrl:     null,
  aadhaarLast4:  null,
  aiScore:       null,
  aiGrade:       null,
  isInternal:    true,
  internalJobId: String(job._id),
  internalEmpId: String(emp._id),
  employeeCode:  emp.employeeId  || "—",
  designation:   emp.designation || "—",
  rejectionReason: app.rejectionReason || null,
});
      });
    });

    // 3️⃣ Internal first, then public
    const allApplications = [...internalApps, ...applications];
    res.json({ success: true, applications: allApplications });

  } catch (err) {
    console.error("Error fetching HR applications:", err);
    res.status(500).json({ success: false, msg: "Server error" });
  }
});

// ✅ Delete HR applicant by ID
router.delete("/applications/:id", async (req, res) => {
  try {
    const deleted = await HrApplicant.findByIdAndDelete(req.params.id);
    if (!deleted) {
      return res.status(404).json({ success: false, msg: "Applicant not found" });
    }
    res.json({ success: true, msg: "HR applicant deleted successfully!" });
  } catch (err) {
    console.error("Error deleting HR applicant:", err);
    res.status(500).json({ success: false, msg: "Server error" });
  }
});


// ✅ இந்த route மட்டும் add பண்ணு existing file-ல
router.put("/applications/:id/status", async (req, res) => {
  try {
    const { status } = req.body;
    const updated = await HrApplicant.findByIdAndUpdate(
      req.params.id,
      { status },
      { new: true }
    );
    if (!updated) return res.status(404).json({ success: false, msg: "Not found" });
    res.json({ success: true, msg: "Status updated!", applicant: updated });
  } catch (err) {
    res.status(500).json({ success: false, msg: "Server error" });
  }
});

module.exports = router;