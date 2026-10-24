const express = require("express");
const router = express.Router();
const HrApplicant = require("../models/HrApplicant");
const Job = require("../models/Job");
const logAction = require("../helpers/logAction");
const auth = require("../middleware/auth");
const hrOnly = require("../middleware/hrOnly");

// ✅ Get all HR job applications (public + internal merged)
router.get("/applications", auth, hrOnly, async (req, res) => {
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
          applied: "New",
          under_review: "Shortlisted",
          interview: "Interview",
          selected: "Hired",
          rejected: "Rejected",
        };

        internalApps.push({
          _id: `internal_${job._id}_${emp._id}`,
          name: emp.name || "—",
          email: emp.email || "—",
          phone: emp.mobile || emp.phone || "—",
          jobTitle: job.title,
          location: emp.department || "—",
          department: emp.department || "—",
          status: statusMap[app.status] || "New",
          rawStatus: app.status || "applied", 
          createdAt: app.appliedAt || new Date(),
          resumeUrl: null,
          aadhaarLast4: null,
          aiScore: null,
          aiGrade: null,
          isInternal: true,
          internalJobId: String(job._id),
          internalEmpId: String(emp._id),
          employeeCode: emp.employeeId || "—",
          designation: emp.designation || "—",
          rejectionReason: app.rejectionReason || null,
          statusByName: app.status_by_name || "",
          statusAt: app.status_at || null,
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
router.delete("/applications/:id", auth, hrOnly, async (req, res) => {
  try {
    const deleted = await HrApplicant.findByIdAndDelete(req.params.id);
    if (!deleted) {
      return res.status(404).json({ success: false, msg: "Applicant not found" });
    }

    // NEW
    await logAction(req, {
      action: "APPLICANT_DELETE",
      entityType: "HrApplicant",
      entityId: req.params.id,
      entityName: deleted.name || "",
    });

    res.json({ success: true, msg: "HR applicant deleted successfully!" });
  } catch (err) {
    console.error("Error deleting HR applicant:", err);
    res.status(500).json({ success: false, msg: "Server error" });
  }
});

// ✅ இந்த route மட்டும் add பண்ணு existing file-ல
router.put("/applications/:id/status", auth, hrOnly, async (req, res) => {
  try {
    const { status } = req.body;
    const updated = await HrApplicant.findByIdAndUpdate(
      req.params.id,
      { status },
      { new: true }
    );
    if (!updated) return res.status(404).json({ success: false, msg: "Not found" });

    await logAction(req, {
      action: "APPLICANT_STATUS", entityType: "HrApplicant",
      entityId: updated._id, entityName: updated.name || "", remarks: `status → ${status}`,
    });

    res.json({ success: true, msg: "Status updated!", applicant: updated });
  } catch (err) {
    res.status(500).json({ success: false, msg: "Server error" });
  }
});

module.exports = router;