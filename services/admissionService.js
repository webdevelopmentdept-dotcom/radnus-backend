// Shared logic for the Admission module (used by admissionRoutes + adminAdmissionRoutes)
const Counter = require("../models/Counter");
const AdmissionCourse = require("../models/AdmissionCourse");
const { generateAdmissionPdf } = require("./admissionPdf");

const TEXT_FIELDS = [
  "fullName", "timing", "shopName", "aadhaarNo", "postalAddress", "district", "state",
  "pincode", "mobileNo", "gender", "bloodGroup", "email", "differentlyAbled",
  "emergencyMobile", "modeOfCourse", "hybridNote", "accommodation", "batchNo", "billNo",
];
const DATE_FIELDS = ["dateOfJoining", "dateOfBirth"];
// After the application is completed, telecallers may only touch these
const LIMITED_FIELDS = ["batchNo", "billNo"];

const toDate = (v) => {
  if (v === "" || v == null) return null;
  const d = new Date(v);
  return isNaN(d) ? null : d;
};
const toNum = (v) => {
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? n : 0;
};

// Resolve course / scheme → fee snapshot. Scheme fee wins when a scheme is chosen.
async function resolveFee(student, b) {
  const accommodation = b.accommodation || student.accommodation || "WITHOUT";
  const courseId = b.courseId !== undefined ? b.courseId : student.course?.courseId;
  const schemeId = b.schemeId !== undefined ? b.schemeId : student.scheme?.courseId;

  const [course, scheme] = await Promise.all([
    courseId ? AdmissionCourse.findById(courseId) : null,
    schemeId ? AdmissionCourse.findById(schemeId) : null,
  ]);
  if (courseId && !course) throw new Error("Selected course not found");
  if (schemeId && !scheme) throw new Error("Selected scheme not found");
  if (course && course.category !== "REGULAR") throw new Error("Invalid course selection");
  if (scheme && scheme.category !== "SCHEME") throw new Error("Invalid scheme selection");

  student.course = { courseId: course?._id || null, name: course?.name || "" };
  student.scheme = { courseId: scheme?._id || null, name: scheme?.name || "" };
  student.accommodation = accommodation;

  const priced = scheme || course;
  if (!priced) {
    student.courseFee = 0;
    return;
  }
  if (accommodation === "WITH") {
    if (priced.feeWith == null) throw new Error(`${priced.name} is not available with accommodation`);
    student.courseFee = priced.feeWith;
  } else {
    student.courseFee = priced.feeWithout;
  }
}

// Copy request body onto the student document
// lockFee: course / scheme / accommodation / discount are frozen (payments already recorded)
async function applyBody(student, b, { limited = false, lockFee = false } = {}) {
  if (limited) {
    LIMITED_FIELDS.forEach((k) => {
      if (b[k] !== undefined) student[k] = String(b[k]).trim();
    });
    return;
  }

  (lockFee ? TEXT_FIELDS.filter((k) => k !== "accommodation") : TEXT_FIELDS).forEach((k) => {
    if (b[k] !== undefined) student[k] = typeof b[k] === "string" ? b[k].trim() : b[k];
  });
  DATE_FIELDS.forEach((k) => {
    if (b[k] !== undefined) student[k] = toDate(b[k]);
  });
  if (b.aadhaarNo !== undefined) student.aadhaarNo = String(b.aadhaarNo).replace(/\D/g, "");

  if (b.academicLevel !== undefined) student.academic.level = b.academicLevel;
  if (b.academicOthers !== undefined) student.academic.others = String(b.academicOthers).trim();

  if (student.modeOfCourse !== "Hybrid") student.hybridNote = "";
  if (student.academic.level !== "Others") student.academic.others = "";

  if (!lockFee) {
    if (b.courseId !== undefined || b.schemeId !== undefined || b.accommodation !== undefined || !student.courseFee) {
      await resolveFee(student, b);
    }
    if (b.discount !== undefined) student.discount = toNum(b.discount);
    if (student.discount > student.courseFee) throw new Error("Discount cannot be more than the course fee");
  }
}

// Everything that must be true before "Complete"
function validateForComplete(s) {
  const errs = [];
  if (!s.fullName) errs.push("Full Name is required");
  if (!/^\d{10}$/.test(s.mobileNo || "")) errs.push("Mobile No must be 10 digits");
  if (!s.course?.courseId && !s.scheme?.courseId) errs.push("Select a Course or a Government Scheme");
  if (!s.modeOfCourse) errs.push("Mode of Course is required");
  if (s.modeOfCourse === "Hybrid" && !s.hybridNote) errs.push("Enter the Hybrid details");
  if (!s.shopName) errs.push("Shop Name is required");
  if (!/^\d{12}$/.test(s.aadhaarNo || "")) errs.push("Aadhaar No must be 12 digits");
  if (!s.dateOfBirth) errs.push("Date of Birth is required");
  if (!s.bloodGroup) errs.push("Blood Group is required");
  if (!s.gender) errs.push("Gender is required");
  if (!s.postalAddress) errs.push("Postal Address is required");
  if (!s.district) errs.push("District is required");
  if (!/^\d{6}$/.test(s.pincode || "")) errs.push("Pin code must be 6 digits");
  if (!s.academic?.level) errs.push("Select Academic Details");
  if (s.academic?.level === "Others" && !s.academic?.others) errs.push("Enter the Academic details (Others)");
  if (!s.documents?.photo?.url) errs.push("Upload the student photo");
  if (!s.documents?.aadhaar?.url) errs.push("Upload the Aadhaar card");

  if (!(s.totalFees > 0)) errs.push("Total fees must be greater than 0 (select a course and check the discount)");
  return errs;
}

// RAD-ADM-2026-0001
async function nextApplicationNo() {
  const year = new Date().getFullYear();
  const c = await Counter.findOneAndUpdate(
    { name: `admission-${year}` },
    { $inc: { seq: 1 } },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );
  return `RAD-ADM-${year}-${String(c.seq).padStart(4, "0")}`;
}

async function buildPdf(student) {
  const plain = student.toObject ? student.toObject() : student;
  return generateAdmissionPdf(plain);
}

// Emails the PDF to the student via Resend (same provider as employeeAuth.js)
async function sendApplicationEmail(student) {
  if (!student.email) throw new Error("Student has no email address");
  const { Resend } = require("resend");
  const resend = new Resend(process.env.RESEND_API_KEY);
  const pdf = await buildPdf(student);

  const result = await resend.emails.send({
    from: "Radnus <noreply@service.radnus.in>",
    to: student.email,
    subject: `Your Radnus Admission Application - ${student.applicationNo}`,
    html: `
      <div style="font-family:sans-serif;max-width:520px;margin:auto;padding:28px;border:1px solid #e5e7eb;border-radius:12px">
        <h2 style="color:#c8102e;margin-top:0">Radnus Application Form</h2>
        <p>Hi <strong>${student.fullName}</strong>,</p>
        <p>Thank you for applying at <strong>Radnus Mobile Pvt Ltd</strong>. Your application
        (<strong>${student.applicationNo}</strong>) is attached as a PDF.</p>
        <p style="color:#6b7280;font-size:13px">Please keep this copy and pay the booking amount / installments on or before the scheduled dates.</p>
        <hr style="border:none;border-top:1px solid #e5e7eb">
        <p style="color:#9ca3af;font-size:12px">Radnus Mobile Pvt Ltd, 242/244 Sinnaya Plaza, MG Road, Puducherry - 605001</p>
      </div>`,
    attachments: [{ filename: `${student.applicationNo}.pdf`, content: pdf }],
  });
  if (result?.error) throw new Error(result.error.message || "Email provider error");
}

module.exports = {
  applyBody,
  validateForComplete,
  nextApplicationNo,
  buildPdf,
  sendApplicationEmail,
};