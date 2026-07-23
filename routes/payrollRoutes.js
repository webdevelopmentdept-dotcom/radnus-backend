// routes/payrollRoutes.js
const express = require("express");
const router = express.Router();
const payrollCtrl = require("../controllers/payrollController");

// HR — generate & manage payroll runs
router.post("/generate",                    payrollCtrl.generatePayroll);
router.get("/runs",                          payrollCtrl.getPayrollRuns);
router.get("/runs/:runId",                   payrollCtrl.getPayrollRunById);
router.get("/runs/:runId/payslips",          payrollCtrl.getPayslipsByRun);
router.put("/runs/:id/approve",              payrollCtrl.approvePayroll);
router.put("/runs/:id/revert-approval",      payrollCtrl.revertPayrollApproval);
router.put("/runs/:id/mark-paid",            payrollCtrl.markAsPaid);
router.delete("/runs/:id",                   payrollCtrl.deletePayrollRun);

// Single payslip
router.get("/payslip/:id",                   payrollCtrl.getPayslipById);

router.put("/payslip/:id/mark-paid",         payrollCtrl.markPayslipAsPaid);
router.put("/payslip/:id/mark-pending",      payrollCtrl.markPayslipAsPending);

// Employee self-service
router.get("/employee/:employeeId",          payrollCtrl.getEmployeePayslips);

module.exports = router;