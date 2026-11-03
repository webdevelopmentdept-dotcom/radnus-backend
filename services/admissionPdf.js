// Radnus Admission Application PDF (A4) — classic Indian government form style
// Logos (optional, put in services/assets/): radnus-logo.png, emblem-of-india.png, kvic-logo.png
// Serif (Times) typography, tricolour strip, navy part headings, dotted-line fields, character boxes.
const PDFDocument = require("pdfkit");
const fs = require("fs");
const path = require("path");

const NAVY = "#12296b";
const SAFFRON = "#ff9933";
const GREEN = "#138808";
const RED = "#c8102e";
const INK = "#111111";
const GREY = "#555555";
const LINE = "#8a8a8a";

const PAGE_W = 595.28;
const PAGE_H = 841.89;
const M = 34;
const CW = PAGE_W - M * 2;
const BOTTOM = PAGE_H - M - 14;

const TAMIL_REG = path.join(__dirname, "fonts", "NotoSansTamil-Regular.ttf");
const TAMIL_BOLD = path.join(__dirname, "fonts", "NotoSansTamil-Bold.ttf");
const hasTamil = fs.existsSync(TAMIL_REG);
const TAMIL_RE = /[\u0B80-\u0BFF]/;

// Case-insensitive asset lookup. Ignores "_" and "-" too, so "Emblem_of_India.png",
// "emblem-of-india.png" and "EMBLEM_OF_INDIA.PNG" all match (Linux servers are case-sensitive).
const ASSET_DIR = path.join(__dirname, "assets");
const normName = (n) => String(n).toLowerCase().replace(/[^a-z0-9.]/g, "");
const findAsset = (names) => {
  let files = [];
  try { files = fs.readdirSync(ASSET_DIR); } catch { return null; }
  for (const n of names) {
    const hit = files.find((f) => normName(f) === normName(n));
    if (hit) return path.join(ASSET_DIR, hit);
  }
  return null;
};
const LOGO_PATH = findAsset(["radnus-logo.png", "radnus-logo.jpg", "radnus-logo.jpeg"]);
const EMBLEM_PATH = findAsset(["emblem-of-india.png", "emblem-of-india.jpg", "emblem-of-india.jpeg"]);
const KVIC_PATH = findAsset(["kvic-logo.png", "kvic-logo.jpg", "kvic-logo.jpeg"]);

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
  return `XXXXXXXX${d.slice(-4)}`;
};

function font(doc, str, bold = false, italic = false) {
  if (hasTamil && TAMIL_RE.test(String(str || ""))) {
    doc.font(bold && fs.existsSync(TAMIL_BOLD) ? "TamilBold" : "Tamil");
  } else {
    doc.font(bold ? "Times-Bold" : italic ? "Times-Italic" : "Times-Roman");
  }
}

function text(doc, str, x, y, opts = {}) {
  const { size = 10, bold = false, italic = false, color = INK, width, align = "left", characterSpacing = 0 } = opts;
  const s = str == null ? "" : String(str);
  font(doc, s, bold, italic);
  doc.fillColor(color).fontSize(size).text(s, x, y, { width, align, lineBreak: width != null, characterSpacing });
}

function heightOf(doc, str, width, size, bold = false) {
  const s = str == null ? "" : String(str);
  font(doc, s, bold);
  doc.fontSize(size);
  return s ? doc.heightOfString(s, { width }) : 0;
}

const box = (doc, x, y, w, h, lw = 0.6, color = INK) => doc.lineWidth(lw).strokeColor(color).rect(x, y, w, h).stroke();
const dotted = (doc, x1, x2, y) => doc.lineWidth(0.6).strokeColor(LINE).dash(0.9, { space: 1.6 }).moveTo(x1, y).lineTo(x2, y).stroke().undash();

// numbered field with a dotted leader:  "1. Full Name* : ............."
function field(doc, label, value, x, y, w, labelW, { size = 10.5, bold = true } = {}) {
  text(doc, label, x, y + 2, { size: 9.6 });
  text(doc, ":", x + labelW - 5, y + 2, { size: 9.6 });
  const vw = w - labelW - 4;
  text(doc, value, x + labelW + 2, y + 1, { size, bold, width: vw });
  dotted(doc, x + labelW, x + w, y + 14);
}

function checkbox(doc, x, y, checked, label, { size = 9.6 } = {}) {
  box(doc, x, y, 9.5, 9.5, 0.8);
  if (checked) {
    doc.lineWidth(1.6).strokeColor(RED).moveTo(x + 1.8, y + 5).lineTo(x + 4.2, y + 7.6).lineTo(x + 8.4, y + 1.6).stroke();
  }
  text(doc, label, x + 14, y - 0.4, { size, bold: !!checked });
}

// label + inline options. returns nothing; caller advances y
function optionField(doc, label, options, x, y, labelW, { gap = 16 } = {}) {
  text(doc, label, x, y + 2, { size: 9.6 });
  text(doc, ":", x + labelW - 5, y + 2, { size: 9.6 });
  let cx = x + labelW + 2;
  options.forEach(([val, checked]) => {
    checkbox(doc, cx, y + 2.5, checked, val);
    font(doc, val, true);
    doc.fontSize(9.6);
    cx += 14 + doc.widthOfString(val) + gap;
  });
}

// inline one-character-per-box entry
function charBoxes(doc, str, n, x, y, { bw = 12.5, bh = 15 } = {}) {
  const chars = String(str || "").replace(/\s/g, "").split("");
  for (let i = 0; i < n; i++) {
    const bx = x + i * bw;
    box(doc, bx, y, bw, bh, 0.6, INK);
    if (chars[i]) text(doc, chars[i], bx, y + 2.4, { size: 10, bold: true, width: bw, align: "center" });
  }
}
function boxField(doc, label, str, n, x, y, labelW) {
  text(doc, label, x, y + 3, { size: 9.6 });
  text(doc, ":", x + labelW - 5, y + 3, { size: 9.6 });
  charBoxes(doc, str, n, x + labelW + 2, y);
}

// part heading: navy caps text with double rule under it
function partHeading(doc, part, title, y, note) {
  text(doc, part ? `PART – ${part}  :  ${title.toUpperCase()}` : title.toUpperCase(), M, y, { size: 10.5, bold: true, color: NAVY, characterSpacing: 0.5 });
  if (note) text(doc, note, M + 250, y + 2, { size: 8, italic: true, color: GREY, width: CW - 250, align: "right" });
  doc.moveTo(M, y + 14).lineTo(PAGE_W - M, y + 14).lineWidth(1.3).strokeColor(NAVY).stroke();
  doc.moveTo(M, y + 17).lineTo(PAGE_W - M, y + 17).lineWidth(0.4).strokeColor(NAVY).stroke();
  return y + 25;
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
  doc.opacity(0.045);
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

// page border + tricolour strip
function pageChrome(doc) {
  const bx = M - 16, by = M - 16, bw = PAGE_W - bx * 2, bh = PAGE_H - by * 2;
  box(doc, bx, by, bw, bh, 1.4, NAVY);
  box(doc, bx + 3, by + 3, bw - 6, bh - 6, 0.4, NAVY);
  // tricolour strip inside the top edge
  const sx = bx + 3, sw = bw - 6, th = 4;
  doc.rect(sx, by + 3, sw / 3, th).fill(SAFFRON);
  doc.rect(sx + (sw / 3) * 2, by + 3, sw / 3, th).fill(GREEN);
  doc.rect(sx + sw / 3, by + 3, sw / 3, th).fill("#ffffff");
  doc.lineWidth(0.3).strokeColor(LINE).rect(sx + sw / 3, by + 3, sw / 3, th).stroke();
  // navy dot (chakra hint) at centre of white band
  doc.circle(sx + sw / 2, by + 3 + th / 2, 1.5).fill(NAVY);
  drawWatermark(doc);
}

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

function ensure(doc, y, h) {
  if (y + h <= BOTTOM) return y;
  doc.addPage();
  pageChrome(doc);
  return M + 6;
}

function build(doc, s, photoBuf) {
  // ── Header: Radnus (left) | divider | partner logos (right) ──
  const y0 = M - 2;

  // left: Radnus brand + address
  let logoDrawn = false;
  if (LOGO_PATH) {
    try { doc.image(LOGO_PATH, M, y0, { fit: [130, 36] }); logoDrawn = true; } catch { /* fallback */ }
  }
  if (!logoDrawn) text(doc, "RADNUS", M, y0 + 1, { size: 26, bold: true, color: RED });
  text(doc, COMPANY.name, M, y0 + 38, { size: 10.5, bold: true });
  text(doc, COMPANY.addr, M, y0 + 51, { size: 8.2, color: GREY });
  text(doc, COMPANY.phone, M, y0 + 61, { size: 8.2, color: GREY });

  // right: government / partner logos, grouped (only the files that exist are drawn)
  const partners = [[EMBLEM_PATH, 46], [KVIC_PATH, 76]].filter(([file]) => file);
  if (partners.length) {
    const blockW = 190, bx = PAGE_W - M - blockW, gap = 16, lh = 52;
    const total = partners.reduce((a, [, w]) => a + w, 0) + gap * (partners.length - 1);
    doc.moveTo(bx - 12, y0 + 2).lineTo(bx - 12, y0 + 66).lineWidth(0.6).strokeColor(LINE).stroke();
    text(doc, "In association with", bx, y0 + 1, { size: 8, italic: true, color: GREY, width: blockW, align: "center" });
    let lx = bx + (blockW - total) / 2;
    partners.forEach(([file, w]) => {
      try { doc.image(file, lx, y0 + 14, { fit: [w, lh], align: "center", valign: "center" }); } catch (e) { console.warn(`[admissionPdf] could not draw logo ${path.basename(file)}: ${e.message}`); }
      lx += w + gap;
    });
  }

  let y = y0 + 76;

  // title block
  doc.moveTo(M, y).lineTo(PAGE_W - M, y).lineWidth(1.4).strokeColor(NAVY).stroke();
  doc.moveTo(M, y + 3).lineTo(PAGE_W - M, y + 3).lineWidth(0.4).strokeColor(NAVY).stroke();
  text(doc, "APPLICATION FORM FOR ADMISSION", M, y + 9, { size: 15, bold: true, color: NAVY, width: CW, align: "center", characterSpacing: 1.5 });
  text(doc, "(To be filled in BLOCK LETTERS.  Fields marked * are mandatory)", M, y + 28, { size: 8.4, italic: true, color: GREY, width: CW, align: "center" });
  doc.moveTo(M, y + 41).lineTo(PAGE_W - M, y + 41).lineWidth(0.4).strokeColor(NAVY).stroke();
  doc.moveTo(M, y + 44).lineTo(PAGE_W - M, y + 44).lineWidth(1.4).strokeColor(NAVY).stroke();
  y += 52;

  // reference table (ruled): 2 rows x 3 aligned columns
  const rh = 24;
  const c1 = 170, c2 = 100;
  const refRows = [
    [["Application No.", s.applicationNo || "DRAFT", c1, true], ["Date", fmtDate(s.applicationDate), c2, false], ["Register No.", s.registerNo, CW - c1 - c2, false]],
    [["Batch No.", s.batchNo, c1, false], ["Bill No.", s.billNo, c2, false], ["BDA / Counsellor", s.staffName, CW - c1 - c2, false]],
  ];
  box(doc, M, y, CW, rh * 2, 0.8, NAVY);
  doc.moveTo(M, y + rh).lineTo(PAGE_W - M, y + rh).lineWidth(0.5).strokeColor(NAVY).stroke();
  refRows.forEach((row, ri) => {
    let rx = M;
    const ry = y + ri * rh;
    row.forEach(([l, v, w, hl], i) => {
      if (i) doc.moveTo(rx, ry).lineTo(rx, ry + rh).lineWidth(0.5).strokeColor(NAVY).stroke();
      text(doc, l, rx + 5, ry + 3, { size: 7.4, color: GREY });
      text(doc, v, rx + 5, ry + 11.5, { size: 10, bold: true, color: hl ? RED : INK, width: w - 8 });
      rx += w;
    });
  });
  y += rh * 2 + 14;

  // ── PART A: Personal ────────────────────────────────────
  y = ensure(doc, y, 270);
  y = partHeading(doc, "A", "Personal Particulars*", y);
  const pw = 92, lw = CW - pw - 12, rr = 21;
  const py = y;

  field(doc, "1.  Full Name*", s.fullName, M, y, lw, 84, { size: 11.5 });
  y += rr;
  field(doc, "2.  Date of Birth*", fmtDate(s.dateOfBirth), M, y, 232, 84);
  field(doc, "3.  Blood Group*", s.bloodGroup, M + 240, y, lw - 240, 80);
  y += rr;
  optionField(doc, "4.  Gender*", [["Male", s.gender === "Male"], ["Female", s.gender === "Female"], ["Others", s.gender === "Others"]], M, y, 84);
  y += rr;
  boxField(doc, "5.  Aadhaar No.", maskAadhaar(s.aadhaarNo), 12, M, y, 84);
  boxField(doc, "6.  Mobile No.", s.mobileNo, 10, M + 246, y, 56);
  y += rr + 3;
  boxField(doc, "7.  Emergency Mobile", s.emergencyMobile, 10, M, y, 112);
  field(doc, "8.  Email", s.email, M + 246, y, lw - 246, 56, { size: 10 });
  y += rr + 3;

  // photo
  const ph = Math.max(y - py - 2, 112);
  box(doc, PAGE_W - M - pw, py, pw, ph, 0.9, INK);
  if (photoBuf) {
    try {
      doc.image(photoBuf, PAGE_W - M - pw + 1.5, py + 1.5, { fit: [pw - 3, ph - 3], align: "center", valign: "center" });
    } catch {
      text(doc, "Photo", PAGE_W - M - pw, py + ph / 2 - 5, { size: 9, color: GREY, width: pw, align: "center" });
    }
  } else {
    text(doc, "Affix recent\npassport size\nphotograph", PAGE_W - M - pw, py + ph / 2 - 16, { size: 8.6, italic: true, color: GREY, width: pw, align: "center" });
  }
  y = Math.max(y, py + ph) + 2;

  optionField(doc, "9.  Differently Abled", [["Yes", s.differentlyAbled === "Yes"], ["No", s.differentlyAbled === "No"], ["Not applicable", s.differentlyAbled === "Not applicable"]], M, y, 100, { gap: 14 });
  y += rr;
  field(doc, "10.  Shop Name", s.shopName, M, y, CW, 100);
  y += rr;

  // address (multi-line, dotted rule under every line)
  text(doc, "11.  Postal Address", M, y + 2, { size: 9.6 });
  text(doc, ":", M + 95, y + 2, { size: 9.6 });
  const av = s.postalAddress || "";
  const aw = CW - 102;
  font(doc, av, true);
  doc.fontSize(10.5);
  const lh = doc.currentLineHeight();
  const lines = Math.max(1, Math.round(heightOf(doc, av, aw, 10.5, true) / lh));
  text(doc, av, M + 102, y + 1, { size: 10.5, bold: true, width: aw });
  for (let i = 0; i < lines; i++) dotted(doc, M + 100, PAGE_W - M, y + 1 + (i + 1) * lh + 1);
  y += 1 + lines * lh + 11;

  field(doc, "12.  District", s.district, M, y, 190, 62);
  field(doc, "13.  State", s.state, M + 202, y, 160, 42);
  boxField(doc, "14.  Pin Code", s.pincode, 6, M + 374, y, 58);
  y += rr + 8;

  // ── PART B: Course & Fee ────────────────────────────────
  y = ensure(doc, y, 190);
  y = partHeading(doc, "B", "Course Details*", y);
  const gw = 334, colW = gw / 3;
  const selectedName = (s.course?.name || "").trim().toLowerCase();
  const cy = y;

  const isScheme = !!s.scheme?.name;
  text(doc, "15.  Course Taken*", M, cy, { size: 9.6 });
  let gy;
  if (isScheme) {
    // Government scheme selected: hide the normal course grid, show a split highlight card instead
    const bh = 16 + 21 * 3 - 18;
    const by = cy + 18;
    const panelW = 112;
    doc.rect(M, by, gw, bh).fill("#ffffff");
    doc.lineWidth(1.4).strokeColor(NAVY).rect(M, by, gw, bh).stroke();
    doc.rect(M, by, panelW, bh).fill(NAVY);
    // green tick in a white circle
    doc.circle(M + panelW / 2, by + 19, 11).fill("#ffffff");
    doc.lineWidth(2.2).strokeColor(GREEN)
      .moveTo(M + panelW / 2 - 5, by + 19.5).lineTo(M + panelW / 2 - 1.6, by + 23).lineTo(M + panelW / 2 + 5, by + 15).stroke();
    text(doc, "GOVERNMENT", M, by + 36, { size: 8.8, bold: true, color: "#ffffff", width: panelW, align: "center", characterSpacing: 1.6 });
    text(doc, "SCHEME", M, by + 47, { size: 8.8, bold: true, color: SAFFRON, width: panelW, align: "center", characterSpacing: 1.6 });
    text(doc, "SELECTED SCHEME", M + panelW + 14, by + 9, { size: 7.6, color: GREY, characterSpacing: 1.2 });
    // long scheme names: shrink to one line (down to 13pt), else wrap to two smaller lines
    const nameW = gw - panelW - 26;
    let nameSize = 20;
    font(doc, s.scheme.name, true);
    while (nameSize > 13 && doc.fontSize(nameSize).widthOfString(s.scheme.name) > nameW) nameSize -= 0.5;
    if (doc.fontSize(nameSize).widthOfString(s.scheme.name) <= nameW) {
      text(doc, s.scheme.name, M + panelW + 14, by + 21 + (20 - nameSize) / 2, { size: nameSize, bold: true, color: NAVY, width: nameW + 4 });
    } else {
      nameSize = 12;
      while (nameSize > 9 && heightOf(doc, s.scheme.name, nameW, nameSize, true) > 29) nameSize -= 0.5;
      text(doc, s.scheme.name, M + panelW + 14, by + 19, { size: nameSize, bold: true, color: NAVY, width: nameW });
    }
    doc.moveTo(M + panelW + 14, by + 49).lineTo(M + gw - 12, by + 49).lineWidth(1.6).strokeColor(SAFFRON).stroke();
    gy = cy + 60;
  } else {
    COURSE_GRID.forEach((row, ri) => {
      row.forEach((name, ci) => {
        checkbox(doc, M + 8 + ci * colW, cy + 17 + ri * 19, name.toLowerCase() === selectedName, name);
      });
    });
    gy = cy + 17 + COURSE_GRID.length * 19 + 3;
    checkbox(doc, M + 8, gy, false, "Government Scheme");
    text(doc, "Scheme :", M + 138, gy, { size: 9.6 });
    dotted(doc, M + 176, M + gw, gy + 11.5);
  }

  // fee table (right)
  const fx = M + gw + 14, fw = CW - gw - 14;
  doc.rect(fx, cy, fw, 16).fill(NAVY);
  text(doc, "FEE DETAILS", fx, cy + 3.6, { size: 9.4, bold: true, color: "#ffffff", width: fw, align: "center", characterSpacing: 1.2 });
  const feeRows = [
    ["Fees Amount", money(s.courseFee), INK],
    ["Discount", s.discount ? `- ${money(s.discount)}` : "", INK],
    ["Total Fees*", money(s.totalFees), RED],
  ];
  const fh = 21;
  box(doc, fx, cy, fw, 16 + fh * 3, 0.8, NAVY);
  feeRows.forEach(([l, v, col], i) => {
    const fy = cy + 16 + i * fh;
    if (i) doc.moveTo(fx, fy).lineTo(fx + fw, fy).lineWidth(0.5).strokeColor(NAVY).stroke();
    text(doc, l, fx + 7, fy + 5.5, { size: 9.6, bold: i === 2, color: i === 2 ? RED : INK });
    text(doc, v, fx + 7, fy + 5, { size: i === 2 ? 11 : 10, bold: true, color: col, width: fw - 14, align: "right" });
  });
  text(doc, "Total = Fees Amount - Discount", fx, cy + 16 + fh * 3 + 3, { size: 7.4, italic: true, color: GREY, width: fw, align: "right" });
  y = Math.max(gy + 18, cy + 16 + fh * 3 + 16);

  optionField(doc, "16.  Accommodation", [["Without", s.accommodation === "WITHOUT"], ["With", s.accommodation === "WITH"]], M, y, 100);
  optionField(doc, "17.  Mode of Course*", [["Regular", s.modeOfCourse === "Regular"], ["Hybrid", s.modeOfCourse === "Hybrid"]], M + 262, y, 104);
  y += rr;
  if (s.modeOfCourse === "Hybrid" && s.hybridNote) {
    field(doc, "      Hybrid details", s.hybridNote, M, y, CW, 100, { size: 10 });
    y += rr;
  }
  field(doc, "18.  Timing", s.timing, M, y, 232, 100);
  field(doc, "19.  Date of Joining", fmtDate(s.dateOfJoining), M + 262, y, CW - 262, 104);
  y += rr + 8;

  // ── PART C: Academic ────────────────────────────────────
  y = ensure(doc, y, 60);
  y = partHeading(doc, "C", "Educational Qualification*", y);
  const levels = ["10th", "12th", "Graduation", "ITI", "Polytechnic", "Others"];
  const aW = CW / levels.length;
  levels.forEach((l, i) => {
    const lab = l === "Others" && s.academic?.level === "Others" && s.academic?.others ? `Others: ${s.academic.others}` : l;
    checkbox(doc, M + 6 + i * aW, y, s.academic?.level === l, lab);
  });
  y += 24;

  // ── PART D: Enclosures ──────────────────────────────────
  y = ensure(doc, y, 50);
  y = partHeading(doc, "D", "Enclosures*", y, "Documents to be provided with this form");
  checkbox(doc, M + 6, y, !!s.documents?.aadhaar?.url, "(i)  Proof of residence – Aadhaar Card");
  checkbox(doc, M + CW / 2 + 6, y, !!s.documents?.photo?.url, "(ii)  Passport size photograph");
  y += 26;

  // ── Payments (only when recorded) ───────────────────────
  const pays = s.payments || [];
  if (pays.length) {
    y = ensure(doc, y, 25 + 18 + pays.length * 17 + 30);
    y = partHeading(doc, "", "Payment Particulars", y);
    const cols = [["Date", 80], ["Type", 120], ["Mode", 70], ["Reference No.", 135], ["Amount", CW - 405]];
    let x2 = M;
    doc.rect(M, y, CW, 17).fill("#e8ecf7");
    cols.forEach(([n, w], i) => {
      text(doc, n, x2 + 5, y + 4.2, { size: 8.8, bold: true, color: NAVY, width: w - 10, align: i === 4 ? "right" : "left" });
      x2 += w;
    });
    box(doc, M, y, CW, 17, 0.6, NAVY);
    y += 17;
    pays.forEach((p) => {
      y = ensure(doc, y, 17);
      let x3 = M;
      [fmtDate(p.paidDate), p.type, p.mode, p.refNo, money(p.amount)].forEach((v, i) => {
        text(doc, v, x3 + 5, y + 4, { size: 9.4, width: cols[i][1] - 10, align: i === 4 ? "right" : "left" });
        x3 += cols[i][1];
      });
      y += 17;
      doc.moveTo(M, y).lineTo(PAGE_W - M, y).lineWidth(0.4).strokeColor(LINE).stroke();
    });
    y += 6;
    text(doc, `Total Paid : ${money(s.paidAmount)}`, M + 5, y, { size: 10, bold: true });
    text(doc, `Balance Due : ${money(s.balance)}`, M, y, { size: 10, bold: true, color: s.balance ? RED : INK, width: CW - 5, align: "right" });
    y += 24;
  }

  // ── PART E: Terms ───────────────────────────────────────
  const termH = TERMS.reduce((a, t) => a + heightOf(doc, t, CW - 30, 9.4) + 3, 0);
  y = ensure(doc, y, 25 + termH + 10);
  y = partHeading(doc, "E", "Terms & Conditions*", y);
  TERMS.forEach((t, i) => {
    text(doc, `${i + 1}.`, M + 6, y, { size: 9.4, bold: true, color: NAVY });
    const th = heightOf(doc, t, CW - 30, 9.4);
    text(doc, t, M + 24, y, { size: 9.4, width: CW - 30 });
    y += th + 3;
  });
  y += 8;

  // ── PART F: Declaration + signatures ────────────────────
  const declH = heightOf(doc, DECLARATION, CW - 12, 9.6);
  y = ensure(doc, y, 25 + declH + 10 + 70 + 12 + 96);
  y = partHeading(doc, "F", "Declaration*", y);
  text(doc, DECLARATION, M + 6, y, { size: 9.6, width: CW - 12, align: "justify" });
  y += declH + 18;

  const half = CW / 2;
  field(doc, "Place", "", M, y, 190, 40);
  field(doc, "Date", "", M, y + 22, 190, 40);
  dotted(doc, M + half + 40, PAGE_W - M, y + 20);
  text(doc, "Signature of the Applicant", M + half + 40, y + 24, { size: 9.2, bold: true, width: half - 40, align: "center" });
  y += 56;
  dotted(doc, M + half + 40, PAGE_W - M, y + 6);
  text(doc, `Signature of Counsellor (BDA) : ${s.staffName || ""}`, M + half + 40, y + 10, { size: 9.2, bold: true, width: half - 40, align: "center" });
  y += 30;

  // ── Office use only ─────────────────────────────────────
  const oh = 86;
  y = ensure(doc, y, oh + 8);
  box(doc, M, y, CW, oh, 0.9, NAVY);
  doc.rect(M, y, CW, 14).fill("#e8ecf7");
  box(doc, M, y, CW, 14, 0.6, NAVY);
  text(doc, "FOR OFFICE USE ONLY", M, y + 3, { size: 9, bold: true, color: NAVY, width: CW, align: "center", characterSpacing: 1.4 });
  field(doc, "Application received on", "", M + 8, y + 22, 330, 118);
  field(doc, "Documents verified by", "", M + 8, y + 42, 330, 118);
  field(doc, "Admission approved by", "", M + 8, y + 62, 330, 118);
  doc.lineWidth(0.6).strokeColor(LINE).dash(2, { space: 2 }).circle(PAGE_W - M - 62, y + 52, 28).stroke().undash();
  text(doc, "Office Seal", PAGE_W - M - 90, y + 48.5, { size: 8.5, italic: true, color: GREY, width: 56, align: "center" });
}

function drawFooters(doc) {
  const range = doc.bufferedPageRange();
  for (let i = range.start; i < range.start + range.count; i++) {
    doc.switchToPage(i);
    text(doc, "*Conditions Apply   |   RADNUS 2026", M, PAGE_H - M - 4, { size: 8.2, bold: true, color: GREY });
    text(doc, `Page ${i + 1} of ${range.count}`, M, PAGE_H - M - 4, { size: 8.2, color: GREY, width: CW, align: "right" });
  }
}

module.exports = { generateAdmissionPdf };