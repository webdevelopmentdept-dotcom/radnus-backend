const Groq = require("groq-sdk");

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

const screenApplicant = async (applicant, job) => {
  try {
    const prompt = `
You are an expert HR recruiter.

Compare the JOB DETAILS with the CANDIDATE DETAILS and RESUME.

Give a fair score based on:
- Skills match
- Experience match
- Project relevance
- Overall profile quality

JOB DETAILS:
Title: ${job.title}
Description: ${job.description}
Requirements: ${job.requirements?.join(", ") || "Not specified"}
Responsibilities: ${job.responsibilities?.join(", ") || "Not specified"}

CANDIDATE DETAILS:
Name: ${applicant.name}
Applied Role: ${applicant.jobTitle}
About: ${applicant.about || "Not provided"}

RESUME:
${applicant.resumeText || "Not provided"}

IMPORTANT:
- Give higher score (90-100) ONLY if candidate is a very strong match
- Give medium score (60-80) if partially matching
- Give low score (<50) if weak match

Return ONLY JSON:
{
  "score": number,
  "grade": "A/B/C",
  "reason": "short explanation"
}
`;

    const response = await groq.chat.completions.create({
      model: "llama-3.1-8b-instant",
      messages: [{ role: "user", content: prompt }],
      temperature: 0.3,
      max_tokens: 200,
    });

    const raw = response.choices[0]?.message?.content?.trim();

    // Extract JSON safely
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error("Invalid AI response");

    const result = JSON.parse(jsonMatch[0]);

    // ✅ Score safety check
    let score = result.score || 0;
    score = Math.max(0, Math.min(score, 100));

    // ❗ Optional: penalty if no resume
    if (!applicant.resumeText) {
      score -= 10;
    }

    // ✅ Grade calculation (controlled by backend)
    let grade = "C";
    if (score >= 75) grade = "A";
    else if (score >= 50) grade = "B";

    return {
      aiScore: score,
      aiGrade: grade,
      aiReason: result.reason || "Unable to evaluate",
      aiScreenedAt: new Date(),
    };

  } catch (err) {
    console.error("AI Screening error:", err.message);

    return {
      aiScore: 0,
      aiGrade: "C",
      aiReason: "AI screening failed — manual review required",
      aiScreenedAt: new Date(),
    };
  }
};

module.exports = { screenApplicant };