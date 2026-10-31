// Radnus Admission Application PDF (A4) — built with pdfkit
// Redesigned layout: header → reference strip → I Course & Fee → II Personal → III Academic
//                    → IV Documents → (Payments, only if any) → V Terms → VI Declaration & Signatures
// npm i pdfkit
const PDFDocument = require("pdfkit");
const fs = require("fs");
const path = require("path");

const RED = "#c8102e";
const INK = "#111111";
const GREY = "#666666";
const LINE = "#b5b5b5";
const SOFT = "#f4f4f4";

const PAGE_W = 595.28;
const PAGE_H = 841.89;
const M = 32; // outer margin
const CW = PAGE_W - M * 2;
const BOTTOM = PAGE_H - M - 14; // content must stay above the footer

// Optional Tamil support: drop NotoSansTamil-Regular.ttf (and -Bold) in services/fonts/
const TAMIL_REG = path.join(__dirname, "fonts", "NotoSansTamil-Regular.ttf");
const TAMIL_BOLD = path.join(__dirname, "fonts", "NotoSansTamil-Bold.ttf");
const hasTamil = fs.existsSync(TAMIL_REG);
const TAMIL_RE = /[\u0B80-\u0BFF]/;

// Radnus logo: services/assets/radnus-logo.png (used in header + faint watermark)
const LOGO_CANDIDATES = ["radnus-logo.png", "radnus-logo.jpg", "radnus-logo.jpeg"].map((f) => path.join(__dirname, "assets", f));
const LOGO_PATH = LOGO_CANDIDATES.find((f) => fs.existsSync(f)) || null;

const COMPANY = {
  name: "Radnus Communication",
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

function font(doc, str, bold = false) {
  if (hasTamil && TAMIL_RE.test(String(str || ""))) {
    doc.font(bold && fs.existsSync(TAMIL_BOLD) ? "TamilBold" : "Tamil");
  } else {
    doc.font(bold ? "Helvetica-Bold" : "Helvetica");
  }
}

function text(doc, str, x, y, opts = {}) {
  const { size = 9, bold = false, color = INK, width, align = "left", characterSpacing = 0 } = opts;
  const s = str == null ? "" : String(str);
  font(doc, s, bold);
  doc.fillColor(color).fontSize(size).text(s, x, y, { width, align, lineBreak: width != null, characterSpacing });
}

function heightOf(doc, str, width, size, bold = false) {
  const s = str == null ? "" : String(str);
  font(doc, s, bold);
  doc.fontSize(size);
  return s ? doc.heightOfString(s, { width }) : 0;
}

// label (small, grey) above a value with an underline. Returns used height.
function cell(doc, label, value, x, y, w, { size = 9.5, bold = false, minH = 25, color = INK } = {}) {
  text(doc, label, x, y, { size: 7.2, color: GREY, width: w });
  const vh = Math.max(heightOf(doc, value, w - 4, size, bold), 11);
  text(doc, value, x + 2, y + 9.5, { size, bold, color, width: w - 4 });
  const ly = y + 9.5 + vh + 2;
  doc.moveTo(x, ly).lineTo(x + w, ly).lineWidth(0.5).strokeColor(LINE).stroke();
  return Math.max(minH, ly - y + 5);
}

function checkbox(doc, x, y, checked, label, { size = 8.8 } = {}) {
  doc.lineWidth(0.7).strokeColor(INK).rect(x, y, 9, 9).stroke();
  if (checked) {
    doc.lineWidth(1.5).strokeColor(RED).moveTo(x + 1.8, y + 4.8).lineTo(x + 4, y + 7.2).lineTo(x + 8, y + 1.6).stroke();
  }
  text(doc, label, x + 13.5, y + 0.6, { size, bold: !!checked });
}

// label + inline checkbox options, underline-less. Returns row height.
function optionRow(doc, label, options, x, y, w, { gap = 14 } = {}) {
  text(doc, label, x, y, { size: 7.2, color: GREY, width: w });
  let cx = x + 2;
  options.forEach(([val, checked]) => {
    checkbox(doc, cx, y + 9.2, checked, val);
    font(doc, val, true);
    doc.fontSize(8.8);
    cx += 13.5 + doc.widthOfString(val) + gap;
  });
  return 26;
}

function sectionBar(doc, num, title, y, note) {
  doc.rect(M, y, CW, 17).fill(SOFT);
  doc.rect(M, y, 3, 17).fill(RED);
  if (num) text(doc, `${num}.`, M + 10, y + 4.5, { size: 9.5, bold: true, color: RED });
  text(doc, title, M + (num ? 28 : 10), y + 4.5, { size: 9.5, bold: true });
  if (note) text(doc, note, M + 150, y + 5.5, { size: 7.5, color: GREY, width: CW - 160, align: "right" });
  return y + 17 + 7;
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

function drawWatermark(doc) {
  doc.save();
  doc.opacity(0.05);
  if (LOGO_PATH) {
    const boxW = 380, boxH = 280;
    try {
      doc.image(LOGO_PATH, (PAGE_W - boxW) / 2, (PAGE_H - boxH) / 2 + 20, { fit: [boxW, boxH], align: "center", valign: "center" });
    } catch { /* skip */ }
  } else {
    doc.font("Helvetica-Bold").fontSize(96).fillColor(RED)
      .text("RADNUS", 0, PAGE_H / 2 - 50, { width: PAGE_W, align: "center", lineBreak: false });
    doc.font("Helvetica-Bold").fontSize(22).fillColor(GREY)
      .text("SINCE 2003", 0, PAGE_H / 2 + 56, { width: PAGE_W, align: "center", lineBreak: false, characterSpacing: 6 });
  }
  doc.restore();
}

function pageChrome(doc) {
  doc.lineWidth(0.8).strokeColor(INK).rect(M - 10, M - 10, PAGE_W - (M - 10) * 2, PAGE_H - (M - 10) * 2).stroke();
  drawWatermark(doc);
}

// ── main ──────────────────────────────────────────────────
async function generateAdmissionPdf(student) {
  const photoBuf = await fetchImage(student.documents?.photo?.url);

  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      size: "A4",
      margin: 0,
      bufferPages: true,
      info: { Title: `Radnus Application ${student.applicationNo || ""}`, Author: "Radnus Mobile Pvt Ltd" },
    });
    if (hasTamil) {
      doc.registerFont("Tamil", TAMIL_REG);
      if (fs.existsSync(TAMIL_BOLD)) doc.registerFont("TamilBold", TAMIL_BOLD);
    }
    const chunks = [];
    doc.on("data", (c) => chunks.push(c));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    try {
      pageChrome(doc);
      build(doc, student, photoBuf);
      drawFooters(doc, student);
      doc.end();
    } catch (e) {
      reject(e);
    }
  });
}

// start a new page if the next block would run past the footer
function ensure(doc, y, h) {
  if (y + h <= BOTTOM) return y;
  doc.addPage();
  pageChrome(doc);
  return M + 6;
}

function build(doc, s, photoBuf) {
  // ── Header ──────────────────────────────────────────────
  let logoDrawn = false;
  if (LOGO_PATH) {
    try { doc.image(LOGO_PATH, M, M - 2, { fit: [120, 34] }); logoDrawn = true; } catch { /* fallback */ }
  }
  if (!logoDrawn) text(doc, "RADNUS", M, M + 2, { size: 22, bold: true, color: RED });
  text(doc, COMPANY.name, M, M + 35, { size: 9, bold: true });
  text(doc, COMPANY.addr, M, M + 46, { size: 7.8, color: GREY });
  text(doc, COMPANY.phone, M, M + 56, { size: 7.8, color: GREY });

  text(doc, "RADNUS APPLICATION FORM", M + 200, M + 2, { size: 15, bold: true, width: CW - 200, align: "right" });
  text(doc, s.applicationNo ? `Application No: ${s.applicationNo}` : "DRAFT — Application No not yet assigned", M + 200, M + 24,
    { size: 10.5, bold: true, color: RED, width: CW - 200, align: "right" });
  text(doc, `Date: ${fmtDate(s.applicationDate)}`, M + 200, M + 40, { size: 8.5, color: GREY, width: CW - 200, align: "right" });

  let y = M + 68;
  doc.moveTo(M, y).lineTo(PAGE_W - M, y).lineWidth(1.6).strokeColor(RED).stroke();

  // ── Reference strip ─────────────────────────────────────
  y += 8;
  const refs = [
    ["REGISTER NO", s.registerNo, 168],
    ["BATCH NO", s.batchNo, 80],
    ["BILL NO", s.billNo, 80],
    ["BDA / COUNSELLOR", s.staffName, CW - 168 - 80 - 80],
  ];
  doc.rect(M, y, CW, 26).fill(SOFT);
  let rx = M;
  refs.forEach(([l, v, w], i) => {
    text(doc, l, rx + 8, y + 4, { size: 6.8, color: GREY, width: w - 10 });
    text(doc, v || "", rx + 8, y + 13, { size: 9.2, bold: true, width: w - 12 });
    if (i < refs.length - 1) doc.moveTo(rx + w, y + 5).lineTo(rx + w, y + 21).lineWidth(0.5).strokeColor(LINE).stroke();
    rx += w;
  });
  y += 26 + 9;

  // ── I. Course & Fee ─────────────────────────────────────
  y = sectionBar(doc, "I", "Course Details*", y);
  const leftW = CW - 172;
  const colW = leftW / 3;
  const selectedName = (s.course?.name || "").trim().toLowerCase();

  text(doc, "Course Taken*", M, y, { size: 7.2, color: GREY });
  COURSE_GRID.forEach((row, r) => {
    row.forEach((name, c) => {
      checkbox(doc, M + 2 + c * colW, y + 11 + r * 15, name.toLowerCase() === selectedName, name);
    });
  });
  let ly = y + 11 + COURSE_GRID.length * 15 + 2;
  checkbox(doc, M + 2, ly, !!s.scheme?.name, "Government Scheme");
  doc.moveTo(M + colW, ly + 10.5).lineTo(M + leftW, ly + 10.5).lineWidth(0.5).strokeColor(LINE).stroke();
  text(doc, s.scheme?.name || "", M + colW + 3, ly + 0.5, { size: 9, bold: true, width: leftW - colW - 4 });
  ly += 22;

  // Fee box (right)
  const fx = M + leftW + 14, fw = CW - leftW - 14, fy = y - 2;
  doc.lineWidth(0.8).strokeColor(INK).rect(fx, fy, fw, 94).stroke();
  doc.rect(fx, fy, fw, 15).fill(INK);
  text(doc, "FEE SUMMARY", fx, fy + 4, { size: 7.5, bold: true, color: "#ffffff", width: fw, align: "center", characterSpacing: 1 });
  const feeRow = (label, val, yy, o = {}) => {
    text(doc, label, fx + 8, yy, { size: 8.3, color: o.color || GREY, bold: !!o.bold });
    text(doc, val, fx + 8, yy, { size: o.big ? 10.5 : 9, bold: true, color: o.color || INK, width: fw - 16, align: "right" });
  };
  feeRow("Fees Amount", money(s.courseFee), fy + 24);
  feeRow("Discount", s.discount ? `- ${money(s.discount)}` : "", fy + 40);
  doc.moveTo(fx + 8, fy + 56).lineTo(fx + fw - 8, fy + 56).lineWidth(0.6).strokeColor(LINE).stroke();
  feeRow("Total Fees*", money(s.totalFees), fy + 64, { big: true, color: RED, bold: true });
  text(doc, "Total = Fees Amount - Discount", fx + 8, fy + 80, { size: 6.6, color: GREY, width: fw - 16 });

  // Accommodation | Mode of Course (side by side)
  const half = leftW / 2;
  optionRow(doc, "Accommodation", [["Without", s.accommodation === "WITHOUT"], ["With", s.accommodation === "WITH"]], M, ly, half);
  optionRow(doc, "Mode of Course*", [["Regular", s.modeOfCourse === "Regular"], ["Hybrid", s.modeOfCourse === "Hybrid"]], M + half, ly, half);
  ly += 27;
  if (s.modeOfCourse === "Hybrid" && s.hybridNote) {
    text(doc, "Hybrid details", M, ly, { size: 7.2, color: GREY });
    const hh = Math.max(heightOf(doc, s.hybridNote, leftW - 4, 8.8), 11);
    text(doc, s.hybridNote, M + 2, ly + 9.5, { size: 8.8, width: leftW - 4 });
    doc.moveTo(M, ly + 9.5 + hh + 2).lineTo(M + leftW, ly + 9.5 + hh + 2).lineWidth(0.5).strokeColor(LINE).stroke();
    ly += hh + 17;
  }
  y = Math.max(ly, fy + 94 + 6);

  // Timing | Date of joining
  const hw = (CW - 16) / 2;
  const h1 = cell(doc, "Timing", s.timing, M, y, hw);
  cell(doc, "Date of Joining", fmtDate(s.dateOfJoining), M + hw + 16, y, hw);
  y += h1 + 4;

  // ── II. Personal ────────────────────────────────────────
  y = ensure(doc, y, 240);
  y = sectionBar(doc, "II", "Personal Details*", y);

  // photo (right)
  const pw = 84, ph = 106, px = PAGE_W - M - pw, py = y;
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

  const lw = CW - pw - 16; // left block next to the photo
  const g = 12;
  let py2 = y;
  py2 += cell(doc, "Full Name*", s.fullName, M, py2, lw, { size: 11, bold: true });
  const w3 = (lw - g * 2) / 3;
  const dobW = 112, bgW = 78, gW = lw - dobW - bgW - g * 2;
  const a = cell(doc, "Date of Birth*", fmtDate(s.dateOfBirth), M, py2, dobW);
  optionRow(doc, "Gender", [["Male", s.gender === "Male"], ["Female", s.gender === "Female"], ["Others", s.gender === "Others"]], M + dobW + g, py2, gW, { gap: 9 });
  cell(doc, "Blood Group*", s.bloodGroup, M + dobW + g + gW + g, py2, bgW);
  py2 += Math.max(a, 26);
  const w2 = (lw - g * 2) / 3;
  const b = cell(doc, "Aadhaar No", maskAadhaar(s.aadhaarNo), M, py2, w2);
  cell(doc, "Mobile No", s.mobileNo, M + w2 + g, py2, w2);
  cell(doc, "Emergency Mobile", s.emergencyMobile, M + (w2 + g) * 2, py2, w2);
  py2 += b;
  py2 += cell(doc, "Email", s.email, M, py2, lw);
  y = Math.max(py2, py + ph + 4);

  // Full-width rows
  const dh = optionRow(doc, "Differently Abled", [["Yes", s.differentlyAbled === "Yes"], ["No", s.differentlyAbled === "No"], ["Not applicable", s.differentlyAbled === "Not applicable"]], M, y, CW / 2, { gap: 16 });
  cell(doc, "Shop Name*", s.shopName, M + CW / 2 + 8, y, CW / 2 - 8);
  y += dh;
  y += cell(doc, "Postal Address", s.postalAddress, M, y, CW);
  const t3 = (CW - 24) / 3;
  const d1 = cell(doc, "District", s.district, M, y, t3);
  cell(doc, "State", s.state, M + t3 + 12, y, t3);
  cell(doc, "Pin Code", s.pincode, M + (t3 + 12) * 2, y, t3);
  y += d1 + 6;

  // ── III. Academic ───────────────────────────────────────
  y = ensure(doc, y, 60);
  y = sectionBar(doc, "III", "Academic Details*", y);
  const levels = ["10th", "12th", "Graduation", "ITI", "Polytechnic", "Others"];
  let ax = M + 2;
  levels.forEach((l) => {
    checkbox(doc, ax, y, s.academic?.level === l, l);
    font(doc, l, true); doc.fontSize(8.8);
    ax += 13.5 + doc.widthOfString(l) + 22;
  });
  if (s.academic?.level === "Others" && s.academic?.others) {
    doc.moveTo(ax - 4, y + 10.5).lineTo(PAGE_W - M, y + 10.5).lineWidth(0.5).strokeColor(LINE).stroke();
    text(doc, s.academic.others, ax - 2, y + 0.5, { size: 8.8, width: PAGE_W - M - ax });
  }
  y += 22;

  // ── IV. Documents ───────────────────────────────────────
  y = ensure(doc, y, 50);
  y = sectionBar(doc, "IV", "Document Checklist*", y, "Documents to be provided with this registration form");
  checkbox(doc, M + 2, y, !!s.documents?.aadhaar?.url, "Proof of residence - Aadhaar Card");
  checkbox(doc, M + 240, y, !!s.documents?.photo?.url, "Passport size photo");
  y += 22;

  // ── Payments (only when recorded) ───────────────────────
  const pays = s.payments || [];
  if (pays.length) {
    y = ensure(doc, y, 40 + pays.length * 14 + 40);
    y = sectionBar(doc, "", "Payment Details", y);
    const cols = [[ "Date", 70 ], [ "Type", 110 ], [ "Mode", 60 ], [ "Ref No", 150 ], [ "Amount", CW - 398 ]];
    let cx = M + 4;
    cols.forEach(([n, w], i) => { text(doc, n, cx, y, { size: 7.5, bold: true, color: GREY, width: w, align: i === 4 ? "right" : "left" }); cx += w; });
    y += 11;
    doc.moveTo(M, y).lineTo(PAGE_W - M, y).lineWidth(0.5).strokeColor(LINE).stroke();
    y += 3;
    pays.forEach((p) => {
      y = ensure(doc, y, 14);
      let x2 = M + 4;
      [fmtDate(p.paidDate), p.type, p.mode, p.refNo, money(p.amount)].forEach((v, i) => {
        text(doc, v, x2, y, { size: 8.5, width: cols[i][1] - 4, align: i === 4 ? "right" : "left" });
        x2 += cols[i][1];
      });
      y += 13;
    });
    doc.moveTo(M, y + 1).lineTo(PAGE_W - M, y + 1).lineWidth(0.5).strokeColor(LINE).stroke();
    y += 6;
    text(doc, `Paid: ${money(s.paidAmount)}`, M + 4, y, { size: 9, bold: true });
    text(doc, `Balance: ${money(s.balance)}`, M + 4, y, { size: 9, bold: true, color: s.balance ? RED : INK, width: CW - 8, align: "right" });
    y += 20;
  }

  // ── V. Terms ────────────────────────────────────────────
  y = ensure(doc, y, 90);
  y = sectionBar(doc, "V", "Terms & Conditions*", y);
  TERMS.forEach((t, i) => {
    text(doc, `${String.fromCharCode(97 + i)}.`, M + 8, y, { size: 8.3, bold: true, color: RED });
    const th = heightOf(doc, t, CW - 34, 8.3);
    text(doc, t, M + 24, y, { size: 8.3, width: CW - 34 });
    y += th + 2;
  });
  y += 4;

  // ── VI. Declaration + signatures ───────────────────────
  const declH = heightOf(doc, DECLARATION, CW - 20, 8.3);
  y = ensure(doc, y, 17 + 7 + declH + 27 + 14);
  y = sectionBar(doc, "VI", "Declaration Statement*", y);
  text(doc, DECLARATION, M + 10, y, { size: 8.3, width: CW - 20 });
  y += declH + 27;

  const sw = (CW - 40) / 2;
  doc.moveTo(M + 6, y).lineTo(M + 6 + sw, y).lineWidth(0.6).strokeColor(INK).stroke();
  text(doc, "Student Signature & Date", M + 6, y + 3, { size: 8, bold: true });
  const sx = M + 6 + sw + 28;
  doc.moveTo(sx, y).lineTo(sx + sw, y).stroke();
  text(doc, `Counsellor (BDA): ${s.staffName || ""}`, sx, y + 3, { size: 8, bold: true, width: sw });
}

function drawFooters(doc) {
  const range = doc.bufferedPageRange();
  for (let i = range.start; i < range.start + range.count; i++) {
    doc.switchToPage(i);
    text(doc, "*Conditions Apply   |   RADNUS 2026", M, PAGE_H - M - 12, { size: 7.5, bold: true, color: GREY });
    text(doc, `Page ${i + 1} of ${range.count}`, M, PAGE_H - M - 12, { size: 7.5, color: GREY, width: CW, align: "right" });
  }
}

module.exports = { generateAdmissionPdf };