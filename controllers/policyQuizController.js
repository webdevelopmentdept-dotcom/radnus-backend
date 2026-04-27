// controllers/policyQuizController.js
const PolicyQuiz = require("../models/PolicyQuiz");
const PolicyQuizAttempt = require("../models/PolicyQuizAttempt");
const Policy = require("../models/Policy");
const PolicyAcknowledgement = require("../models/PolicyAcknowledgement");

// ─────────────────────────────────────────────
// HR — Upsert quiz for a policy (create or replace)
// ─────────────────────────────────────────────
exports.upsertQuiz = async (req, res) => {
  try {
    const { policy_id, questions, timer_seconds, pass_score } = req.body;

    if (!policy_id) return res.status(400).json({ message: "policy_id required" });
    if (!Array.isArray(questions) || questions.length < 1)
      return res.status(400).json({ message: "At least 1 question required" });
    if (questions.length > 15)
      return res.status(400).json({ message: "Max 15 questions allowed" });

    // Validate each question
    for (let i = 0; i < questions.length; i++) {
      const q = questions[i];
      if (!q.question?.trim())
        return res.status(400).json({ message: `Question ${i + 1}: question text required` });
      if (!Array.isArray(q.options) || q.options.length !== 4)
        return res.status(400).json({ message: `Question ${i + 1}: exactly 4 options required` });
      if (typeof q.correct_index !== "number" || q.correct_index < 0 || q.correct_index > 3)
        return res.status(400).json({ message: `Question ${i + 1}: valid correct_index (0-3) required` });
    }

    const quiz = await PolicyQuiz.findOneAndUpdate(
      { policy_id },
      {
        policy_id,
        questions,
        timer_seconds: timer_seconds || 300,
        pass_score: pass_score || 3,
        is_active: true,
      },
      { upsert: true, new: true }
    );

    res.json({ message: "Quiz saved", quiz });
  } catch (err) {
    console.error("UPSERT QUIZ ERROR:", err);
    res.status(500).json({ message: err.message });
  }
};

// ─────────────────────────────────────────────
// HR — Get quiz for a policy
// ─────────────────────────────────────────────
exports.getQuizByPolicy = async (req, res) => {
  try {
    const quiz = await PolicyQuiz.findOne({
      policy_id: req.params.policy_id,
      is_active: true,
    });
    if (!quiz) return res.status(404).json({ message: "No quiz found" });
    res.json(quiz);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

// ─────────────────────────────────────────────
// HR — Delete quiz for a policy
// ─────────────────────────────────────────────
exports.deleteQuiz = async (req, res) => {
  try {
    await PolicyQuiz.findOneAndUpdate(
      { policy_id: req.params.policy_id },
      { is_active: false }
    );
    res.json({ message: "Quiz removed" });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

// ─────────────────────────────────────────────
// HR — Get all quiz attempt stats for a policy
// ─────────────────────────────────────────────
exports.getQuizStats = async (req, res) => {
  try {
    const { policy_id } = req.params;
    const attempts = await PolicyQuizAttempt.find({ policy_id })
      .populate("employee_id", "name email department")
      .sort({ createdAt: -1 });

    const total = attempts.length;
    const passed = attempts.filter((a) => a.passed).length;
    const failed = attempts.filter((a) => !a.passed).length;

    res.json({ total, passed, failed, attempts });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

// ─────────────────────────────────────────────
// Employee — Serve 5 shuffled questions
// ─────────────────────────────────────────────
exports.startQuiz = async (req, res) => {
  try {
    const { policy_id } = req.params;

    const quiz = await PolicyQuiz.findOne({ policy_id, is_active: true });
    if (!quiz) return res.status(404).json({ message: "No quiz configured for this policy" });

    // Shuffle and pick 5
    const shuffled = [...quiz.questions].sort(() => Math.random() - 0.5);
    const picked = shuffled.slice(0, Math.min(5, shuffled.length));

    // Shuffle options too — send shuffled but track original correct
    const served = picked.map((q) => {
      const opts = [...q.options];
      const correctText = opts[q.correct_index];

      // Fisher-Yates shuffle on options
      for (let i = opts.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [opts[i], opts[j]] = [opts[j], opts[i]];
      }

      const newCorrectIndex = opts.indexOf(correctText);

      return {
        _id: q._id,
        question: q.question,
        options: opts,
        correct_index: newCorrectIndex, // shuffled correct
      };
    });

    res.json({
      quiz_id: quiz._id,
      policy_id,
      timer_seconds: quiz.timer_seconds,
      pass_score: quiz.pass_score,
      total_questions: served.length,
      questions: served,
    });
  } catch (err) {
    console.error("START QUIZ ERROR:", err);
    res.status(500).json({ message: err.message });
  }
};

// ─────────────────────────────────────────────
// Employee — Submit quiz answers
// ─────────────────────────────────────────────
exports.submitQuiz = async (req, res) => {
  try {
    const { policy_id, employee_id, answers, time_taken_seconds, questions_served } = req.body;
    // answers: [{ question_index: 0, answer_index: 2 }, ...]
    // questions_served: same array from startQuiz (with correct_index)

    if (!policy_id || !employee_id)
      return res.status(400).json({ message: "policy_id and employee_id required" });

    const quiz = await PolicyQuiz.findOne({ policy_id, is_active: true });
    if (!quiz) return res.status(404).json({ message: "Quiz not found" });

    const policy = await Policy.findById(policy_id);
    if (!policy) return res.status(404).json({ message: "Policy not found" });

    // Grade
    let score = 0;
    const gradedQuestions = (questions_served || []).map((q, i) => {
      const emp_ans = answers[i]?.answer_index;
      const correct = emp_ans === q.correct_index;
      if (correct) score++;
      return {
        question: q.question,
        options: q.options,
        correct_index: q.correct_index,
        employee_answer: emp_ans ?? null,
      };
    });

    const passed = score >= quiz.pass_score;
    const completed = answers.length > 0; // false = timer ran out with no answers

    // Save attempt
    await PolicyQuizAttempt.create({
      policy_id,
      employee_id,
      version_number: policy.version,
      questions_served: gradedQuestions,
      score,
      passed,
      time_taken_seconds: time_taken_seconds || 0,
      completed,
    });

    // If passed → auto-acknowledge
    if (passed) {
      const existing = await PolicyAcknowledgement.findOne({
        policy_id,
        employee_id,
        is_current: true,
      });
      if (!existing) {
        await PolicyAcknowledgement.create({
          policy_id,
          employee_id,
          version_number: policy.version,
          is_current: true,
        });
      }
    }

    res.json({
      score,
      total: gradedQuestions.length,
      passed,
      pass_score: quiz.pass_score,
      message: passed
        ? "🎉 Quiz passed! Policy acknowledged."
        : `❌ Quiz failed. You scored ${score}/${gradedQuestions.length}. Please re-read the policy and try again.`,
    });
  } catch (err) {
    console.error("SUBMIT QUIZ ERROR:", err);
    res.status(500).json({ message: err.message });
  }
};

// ─────────────────────────────────────────────
// Employee — Check if already passed quiz for current version
// ─────────────────────────────────────────────
exports.checkAttempt = async (req, res) => {
  try {
    const { policy_id, employee_id } = req.params;

    const policy = await Policy.findById(policy_id);
    if (!policy) return res.status(404).json({ message: "Policy not found" });

    const attempt = await PolicyQuizAttempt.findOne({
      policy_id,
      employee_id,
      version_number: policy.version,
      passed: true,
    });

    const ack = await PolicyAcknowledgement.findOne({
      policy_id,
      employee_id,
      is_current: true,
    });

    res.json({ already_passed: !!attempt, acknowledged: !!ack });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};