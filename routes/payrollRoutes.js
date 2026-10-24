// routes/payrollRoutes.js
const express = require("express");
const router = express.Router();
const payrollCtrl = require("../controllers/payrollController");
const auth = require("../middleware/auth");
const hrOnly = require("../middleware/hrOnly");

// HR — generate & manage payroll runs
router.post("/generate", auth, hrOnly,                   payrollCtrl.generatePayroll);
router.get("/runs", auth, hrOnly,                     payrollCtrl.getPayrollRuns);
router.get("/runs/:runId", auth, hrOnly,                 payrollCtrl.getPayrollRunById);
router.get("/runs/:runId/payslips", auth, hrOnly,         payrollCtrl.getPayslipsByRun);
router.put("/runs/:id/approve", auth, hrOnly,          payrollCtrl.approvePayroll);
router.put("/runs/:id/revert-approval", auth, hrOnly,      payrollCtrl.revertPayrollApproval);
router.put("/runs/:id/mark-paid", auth, hrOnly,           payrollCtrl.markAsPaid);
router.delete("/runs/:id", auth, hrOnly,                  payrollCtrl.deletePayrollRun);

// Single payslip
router.get("/payslip/:id",                   payrollCtrl.getPayslipById);

router.put("/payslip/:id/mark-paid", auth, hrOnly,     payrollCtrl.markPayslipAsPaid);
router.put("/payslip/:id/other-deduction", auth, hrOnly,  payrollCtrl.setOtherDeduction);
router.put("/payslip/:id", auth, hrOnly, payrollCtrl.updatePayslip);

router.put("/payslip/:id/mark-pending", auth, hrOnly,     payrollCtrl.markPayslipAsPending);

// Employee self-service
router.get("/employee/:employeeId",          payrollCtrl.getEmployeePayslips);

module.exports = router;