const express = require("express");
const router  = express.Router();
const {
  createPlan,
  getPlanByEmployee,
  getAllPlans,
  updatePlan,
  addReview,
  deletePlan,  
} = require("../controllers/retentionController");

router.get("/employee/:employeeId", getPlanByEmployee);

router.get("/",                 getAllPlans);
router.post("/",                createPlan);
router.put("/:id",              updatePlan);
router.delete("/:id",               deletePlan); 
router.post("/:id/review",      addReview); 

module.exports = router;