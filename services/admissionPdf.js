// Radnus Admission Application PDF (A4, 2 pages) — built with pdfkit
// npm i pdfkit
const PDFDocument = require("pdfkit");
const fs = require("fs");
const path = require("path");

const RED = "#c8102e";
const INK = "#111111";
const GREY = "#555555";
const LINE = "#999999";

const PAGE_W = 595.28;
const PAGE_H = 841.89;
const M = 28; // outer margin
const CW = PAGE_W - M * 2;

// Optional Tamil support: drop NotoSansTamil-Regular.ttf (and -Bold) in services/fonts/
const TAMIL_REG = path.join(__dirname, "fonts", "NotoSansTamil-Regular.ttf");
const TAMIL_BOLD = path.join(__dirname, "fonts", "NotoSansTamil-Bold.ttf");
const hasTamil = fs.existsSync(TAMIL_REG);
const TAMIL_RE = /[\u0B80-\u0BFF]/;

const COMPANY = {
  name: "Radnus Mobile Pvt Ltd",
  addr: "242/244, Sinnaya Plaza, MG Road, Puducherry-605001",
  phone: "+91 9940973030; +91 9894436987",
};

const TERMS = [
  "Applicants must be enrolled within 7 days of this filled form for eligible discount offer.",
  "Booking amount must be paid in advance to confirm your seat, which is NON-REFUNDABLE at any cause.",
  "All the installments must be paid on or before the scheduled dates without fail.",
  "NO REFUND once the training has commenced.",
];
const DECLARATION =
  "I hereby declare that the details provided are true. I agree to follow all rules and terms of RADNUS Communication, " +
  "including: non-refundable booking amount, payment schedules, training & accommodation policies, and responsibility " +
  "for my belongings. I consent to the use of my information for official purposes.";

// Layout of the course checkboxes on page 1 (same grid as the paper form)
const COURSE_GRID = [
  ["SEMP A-Z", "STEP (Basic)", "SEMP eMMC"],
  ["LEMP A-Z", "LEMP Basic", "LEMP eMMC"],
  ["IEMP A-Z", "IEMP Basic", "IEMP eMMC"],
];

// ── helpers ───────────────────────────────────────────────
const fmtDate = (d) => {
  if (!d) return "";
  const x = new Date(d);
  if (isNaN(x)) return "";
  return `${String(x.getDate()).padStart(2, "0")}/${String(x.getMonth() + 1).padStart(2, "0")}/${x.getFullYear()}`;
};
const money = (n) => (n || n === 0 ? `Rs. ${Number(n).toLocaleString("en-IN")}/-` : "");
const maskAadhaar = (a) => {
  const d = String(a || "").replace(/\D/g, "");
  if (d.length < 4) return d;
  return `XXXX XXXX ${d.slice(-4)}`;
};

function font(doc, text, bold = false) {
  if (hasTamil && TAMIL_RE.test(String(text || ""))) {
    doc.font(bold && fs.existsSync(TAMIL_BOLD) ? "TamilBold" : "Tamil");
  } else {
    doc.font(bold ? "Helvetica-Bold" : "Helvetica");
  }
}

function text(doc, str, x, y, opts = {}) {
  const { size = 9, bold = false, color = INK, width, align = "left" } = opts;
  const s = str == null ? "" : String(str);
  font(doc, s, bold);
  doc.fillColor(color).fontSize(size).text(s, x, y, { width, align, lineBreak: width != null });
}

// "Label ........ value" with an underline
function field(doc, label, value, x, y, w, opts = {}) {
  const { labelW = 70, size = 9 } = opts;
  text(doc, label, x, y + 2, { size: 8.5, color: GREY, width: labelW });
  const vx = x + labelW;
  const vw = w - labelW;
  doc.moveTo(vx, y + 12).lineTo(vx + vw, y + 12).lineWidth(0.5).strokeColor(LINE).stroke();
  text(doc, value, vx + 2, y + 1, { size, width: vw - 4 });
}

function checkbox(doc, x, y, checked, label, opts = {}) {
  const { size = 8.5 } = opts;
  doc.lineWidth(0.7).strokeColor(INK).rect(x, y + 1, 9, 9).stroke();
  if (checked) {
    doc.lineWidth(1.4).strokeColor(RED)
      .moveTo(x + 1.8, y + 5.8).lineTo(x + 4, y + 8.2).lineTo(x + 8, y + 2.6).stroke();
  }
  text(doc, label, x + 14, y + 1.5, { size });
}

function sectionTitle(doc, num, title, y) {
  text(doc, `${num}.`, M + 6, y, { size: 9.5, bold: true });
  text(doc, title, M + 26, y, { size: 9.5, bold: true });
}

async function fetchImage(url) {
  if (!url) return null;
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    return Buffer.from(await res.arrayBuffer());
  } catch {
    return null;
  }
}

// ── main ──────────────────────────────────────────────────
// student: AdmissionStudent doc/lean object
async function generateAdmissionPdf(student) {
  const photoBuf = await fetchImage(student.documents?.photo?.url);

  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: "A4", margin: 0, info: { Title: `Radnus Application ${student.applicationNo || ""}`, Author: "Radnus Mobile Pvt Ltd" } });
    if (hasTamil) {
      doc.registerFont("Tamil", TAMIL_REG);
      if (fs.existsSync(TAMIL_BOLD)) doc.registerFont("TamilBold", TAMIL_BOLD);
    }
    const chunks = [];
    doc.on("data", (c) => chunks.push(c));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    try {
      frame(doc);
      const endY = drawPage1(doc, student, photoBuf);
      drawRest(doc, student, endY);
      doc.end();
    } catch (e) {
      reject(e);
    }
  });
}

function frame(doc) {
  doc.lineWidth(1).strokeColor(INK).rect(M - 8, M - 8, PAGE_W - (M - 8) * 2, PAGE_H - (M - 8) * 2).stroke();
}

function drawPage1(doc, s, photoBuf) {

  // top row
  text(doc, `Register No: ${s.registerNo || ""}`, M, M + 4, { size: 8.5, bold: true });
  text(doc, "BATCH NO:", M + 250, M + 4, { size: 8.5, bold: true });
  doc.moveTo(M + 305, M + 14).lineTo(M + 365, M + 14).lineWidth(0.5).strokeColor(LINE).stroke();
  text(doc, s.batchNo || "", M + 308, M + 3, { size: 9, width: 56 });
  text(doc, "BILL NO:", M + 372, M + 4, { size: 8.5, bold: true });
  doc.moveTo(M + 415, M + 14).lineTo(M + 455, M + 14).stroke();
  text(doc, s.billNo || "", M + 417, M + 3, { size: 9, width: 38 });

  // photo box (top-right corner)
  const px = PAGE_W - M - 92, py = M + 22, pw = 92, ph = 112;
  doc.lineWidth(0.8).strokeColor(INK).rect(px, py, pw, ph).stroke();
  if (photoBuf) {
    try {
      doc.image(photoBuf, px + 1, py + 1, { fit: [pw - 2, ph - 2], align: "center", valign: "center" });
    } catch {
      text(doc, "Photo", px, py + ph / 2 - 5, { size: 8, color: GREY, width: pw, align: "center" });
    }
  } else {
    text(doc, "Paste Photo here", px, py + ph / 2 - 5, { size: 8, color: GREY, width: pw, align: "center" });
  }

  // title
  const tx = M, ty = M + 30, tw = PAGE_W - M * 2 - pw - 12;
  doc.lineWidth(1).strokeColor(INK).rect(tx, ty, tw, 24).stroke();
  text(doc, "RADNUS APPLICATION FORM", tx, ty + 7, { size: 12, bold: true, width: tw, align: "center" });

  // company block + fee box
  text(doc, "RADNUS", M, M + 66, { size: 15, bold: true, color: RED });
  text(doc, COMPANY.name, M, M + 86, { size: 9, bold: true });
  text(doc, COMPANY.addr, M, M + 98, { size: 8, width: 250 });
  text(doc, COMPANY.phone, M, M + 108, { size: 8, width: 250 });

  const bx = M + 262, by = M + 62, bw = tw - 262 + 0, bh = 58;
  doc.lineWidth(0.8).rect(bx, by, bw, bh).stroke();
  text(doc, "Fees Amount", bx + 6, by + 6, { size: 8.5, bold: true });
  text(doc, money(s.courseFee), bx + 80, by + 6, { size: 9, width: bw - 84 });
  text(doc, "Discount", bx + 6, by + 22, { size: 8.5, bold: true });
  text(doc, s.discount ? money(s.discount) : "", bx + 80, by + 22, { size: 9, width: bw - 84 });
  text(doc, "BDA:", bx + 6, by + 40, { size: 8.5, bold: true });
  text(doc, s.staffName || "", bx + 32, by + 40, { size: 8.5, width: 70 });
  text(doc, "Date:", bx + 104, by + 40, { size: 8.5, bold: true });
  text(doc, fmtDate(s.applicationDate), bx + 128, by + 40, { size: 8.5, width: bw - 130 });

  // I. Personal Details
  let y = M + 146;
  sectionTitle(doc, "I", "Personal Details*", y);
  text(doc, "Date of Joining", M + 300, y, { size: 8.5, color: GREY });
  doc.moveTo(M + 372, y + 10).lineTo(PAGE_W - M, y + 10).lineWidth(0.5).strokeColor(LINE).stroke();
  text(doc, fmtDate(s.dateOfJoining), M + 376, y - 1, { size: 9 });

  y += 22;
  field(doc, "Full Name*", s.fullName, M, y, CW);

  // Course taken
  y += 22;
  text(doc, "Course Taken*", M, y + 2, { size: 8.5, color: GREY });
  const selectedName = (s.course?.name || "").trim();
  const colX = [M + 80, M + 80 + 150, M + 80 + 300];
  COURSE_GRID.forEach((row, r) => {
    row.forEach((name, c) => {
      checkbox(doc, colX[c], y + r * 17, name.toLowerCase() === selectedName.toLowerCase(), name);
    });
  });
  y += COURSE_GRID.length * 17 + 2;

  // Government scheme
  checkbox(doc, colX[0], y, !!s.scheme?.name, "Government Scheme");
  doc.moveTo(colX[1] - 10, y + 11).lineTo(PAGE_W - M, y + 11).lineWidth(0.5).strokeColor(LINE).stroke();
  text(doc, s.scheme?.name || "", colX[1] - 6, y + 1, { size: 9, bold: true, width: 280 });

  // Accommodation (only meaningful for courses that offer it)
  y += 20;
  text(doc, "Accommodation", M, y + 2, { size: 8.5, color: GREY });
  checkbox(doc, colX[0], y, s.accommodation === "WITHOUT", "Without");
  checkbox(doc, colX[1], y, s.accommodation === "WITH", "With");

  // Mode of course
  y += 22;
  text(doc, "Mode of Course*", M, y + 2, { size: 8.5, color: GREY });
  checkbox(doc, colX[0], y, s.modeOfCourse === "Regular", "Regular");
  checkbox(doc, colX[1], y, s.modeOfCourse === "Hybrid", "Hybrid");
  if (s.modeOfCourse === "Hybrid" && s.hybridNote) {
    doc.moveTo(colX[2] - 40, y + 11).lineTo(PAGE_W - M, y + 11).lineWidth(0.5).strokeColor(LINE).stroke();
    text(doc, s.hybridNote, colX[2] - 36, y + 1, { size: 8.5, width: 190 });
  }

  y += 22;
  field(doc, "Timing", s.timing, M, y, CW / 2 - 6);
  field(doc, "Total amount*", money(s.totalFees), M + CW / 2 + 6, y, CW / 2 - 6, { labelW: 76 });

  y += 22;
  field(doc, "Shop Name*", s.shopName, M, y, CW);
  y += 22;
  field(doc, "Aadhaar No", maskAadhaar(s.aadhaarNo), M, y, CW / 2 - 6);
  field(doc, "Date of Birth*", fmtDate(s.dateOfBirth), M + CW / 2 + 6, y, CW / 2 - 6, { labelW: 76 });
  y += 22;
  field(doc, "Postal Address", s.postalAddress, M, y, CW);
  y += 22;
  field(doc, "District", s.district, M, y, CW / 2 - 6);
  field(doc, "State", s.state, M + CW / 2 + 6, y, CW / 2 - 6, { labelW: 76 });
  y += 22;
  field(doc, "Pin code", s.pincode, M, y, CW / 2 - 6);
  field(doc, "Mobile No", s.mobileNo, M + CW / 2 + 6, y, CW / 2 - 6, { labelW: 76 });
  y += 22;
  text(doc, "Gender", M, y + 2, { size: 8.5, color: GREY });
  checkbox(doc, colX[0] - 10, y, s.gender === "Male", "Male");
  checkbox(doc, colX[0] + 60, y, s.gender === "Female", "Female");
  checkbox(doc, colX[0] + 140, y, s.gender === "Others", "Others");
  field(doc, "Blood Group*", s.bloodGroup, M + CW / 2 + 90, y, CW / 2 - 90, { labelW: 70 });
  y += 22;
  field(doc, "Email", s.email, M, y, CW);
  y += 22;
  text(doc, "Differently Abled", M, y + 2, { size: 8.5, color: GREY });
  checkbox(doc, M + 90, y, s.differentlyAbled === "Yes", "Yes");
  checkbox(doc, M + 150, y, s.differentlyAbled === "No", "No");
  checkbox(doc, M + 205, y, s.differentlyAbled === "Not applicable", "Not applicable");
  field(doc, "Emergency Mobile", s.emergencyMobile, M + CW / 2 + 20, y, CW / 2 - 20, { labelW: 88 });

  return y + 28;
}

function drawRest(doc, s, startY) {
  let y = startY;

  // II. Academic
  sectionTitle(doc, "II", "Academic Details*", y);
  y += 17;
  const levels = ["10th", "12th", "Graduation", "ITI", "Polytechnic", "Others"];
  let x = M + 8;
  levels.forEach((l) => {
    checkbox(doc, x, y, s.academic?.level === l, l);
    x += l === "Graduation" || l === "Polytechnic" ? 92 : 62;
  });
  if (s.academic?.level === "Others" && s.academic?.others) {
    doc.moveTo(x, y + 11).lineTo(PAGE_W - M, y + 11).lineWidth(0.5).strokeColor(LINE).stroke();
    text(doc, s.academic.others, x + 2, y + 1, { size: 8.5, width: PAGE_W - M - x - 4 });
  }

  // III. Documents
  y += 26;
  sectionTitle(doc, "III", "Document Checklist* Please provide the following documents with this registration form.", y);
  y += 17;
  checkbox(doc, M + 8, y, !!s.documents?.aadhaar?.url, "Proof of residence - Aadhaar Card");
  checkbox(doc, M + 230, y, !!s.documents?.photo?.url, "Passport size photo");

  // IV. Terms
  y += 28;
  sectionTitle(doc, "IV", "Terms & Conditions*", y);
  y += 15;
  TERMS.forEach((t, i) => {
    text(doc, `${String.fromCharCode(97 + i)}.`, M + 30, y, { size: 8.5 });
    text(doc, t, M + 44, y, { size: 8.5, width: CW - 60 });
    y += 13;
  });

  // V. Declaration
  y += 8;
  sectionTitle(doc, "V", "Declaration Statement*", y);
  y += 15;
  doc.font("Helvetica").fontSize(8.5);
  const dh = doc.heightOfString(DECLARATION, { width: CW - 24 });
  text(doc, DECLARATION, M + 12, y, { size: 8.5, width: CW - 24 });
  y += dh + 20;

  // Signature
  text(doc, "Signature & Date", M + 8, y, { size: 9, bold: true });
  doc.moveTo(M + 100, y + 11).lineTo(M + 280, y + 11).lineWidth(0.6).strokeColor(INK).stroke();
  text(doc, "Counsellor (BDA)", M + 330, y, { size: 8, color: GREY });
  text(doc, s.staffName || "", M + 410, y, { size: 8.5, bold: true, width: 120 });

  text(doc, "*Conditions Apply RADNUS 2025", M, PAGE_H - M - 24, { size: 8.5, bold: true });
  text(doc, `Application No: ${s.applicationNo || ""}`, M + 8, PAGE_H - M - 10, { size: 7.5, color: GREY });
}

module.exports = { generateAdmissionPdf };