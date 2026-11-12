// helpers/awardParticipants.js  who can take part in an award or scheme
// Participants = everyone in the chosen departments  +  the individually chosen employees.
// If both lists are empty, everyone takes part.
function participantFilter(award) {
  const f = { status: { $in: ['approved', 'active'] } };
  const depts = award.departments || [];
  const ids = (award.employee_ids || []).map(String);
  if (depts.length && ids.length) f.$or = [{ department: { $in: depts } }, { _id: { $in: ids } }];
  else if (depts.length) f.department = { $in: depts };
  else if (ids.length) f._id = { $in: ids };
  return f;
}
module.exports = { participantFilter };