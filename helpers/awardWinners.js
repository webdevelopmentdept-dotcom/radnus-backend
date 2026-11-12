// helpers/awardWinners.js  who counts as a winner of an award
// rows = finalized AwardResult docs. Winners: has a final rank, and inside the top N when mode is top_n.
function winnersOf(award, rows) {
  const topN = award.winners?.mode === 'top_n';
  const count = award.winners?.count || 0;
  return rows.filter((r) => r.final_rank != null && (!topN || r.final_rank <= count));
}
module.exports = { winnersOf };