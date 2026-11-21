const W = { low: 1, medium: 2, high: 3 };
const sortLog = (log = []) => [...log].sort((a, b) => String(a.date).localeCompare(String(b.date)));

// progress_log irundhu task oda current status / % / achieved ah thirumba calculate pannum
function recomputeTask(task) {
  const log = sortLog(task.progress_log);

  if (task.task_type === "target" && task.target_value > 0) {
    let cum = 0;
    for (const l of log) {
      cum += Number(l.value_today) || 0;
      l.percent = Math.min(100, Math.round((cum / task.target_value) * 100));
      l.status = cum >= task.target_value ? "completed" : cum > 0 ? "partial" : "pending";
    }
    task.achieved_value = cum;
  }

  if (task.status !== "cancelled") {
    const last = log[log.length - 1];
    task.status = last ? last.status : "pending";
    task.percent = last ? last.percent : 0;
    task.completed_at = task.status === "completed" ? task.completed_at || new Date() : null;
  }
}

// Antha naal EOD la task epdi irundhudhu (snapshot)
function snapshot(task, date) {
  const e = (task.progress_log || []).find((l) => l.date === date);
  return e ? { status: e.status, percent: e.percent || 0 } : { status: "pending", percent: 0 };
}

// Day score: antha naal ku assign aana tasks mattum (carry-over thaniya)
function calcDayScore(tasks = [], date) {
  const own = tasks.filter((t) => t.date === date && t.status !== "cancelled");
  const totals = { total: own.length, completed: 0, partial: 0, pending: 0 };
  if (!own.length) return { totals, score: null };

  let totalW = 0, gotW = 0;
  for (const t of own) {
    const s = snapshot(t, date);
    const w = W[t.priority] || 2;
    totalW += w;
    gotW += w * (s.percent / 100);
    totals[s.status] = (totals[s.status] || 0) + 1;
  }
  return { totals, score: Math.round((gotW / totalW) * 100) };
}

module.exports = { calcDayScore, recomputeTask };