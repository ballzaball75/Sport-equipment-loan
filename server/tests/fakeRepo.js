// In-memory stand-in for src/repo.js so tests run with no database (and in CI).
function createFakeRepo(nowIso = () => new Date().toISOString()) {
  let sports = [{ id: 1, name: 'Football' }, { id: 2, name: 'Badminton' }];
  let equipment = [
    { id: 1, sport_id: 1, name: 'Football size 5', total_qty: 10 },
    { id: 2, sport_id: 2, name: 'Badminton racket', total_qty: 4 },
  ];
  let loans = [];
  let seq = { equipment: 3, loan: 1 };

  const sportName = (id) => sports.find((s) => s.id === id)?.name;
  const eqView = (e) => e && {
    ...e,
    sport: sportName(e.sport_id),
    available_qty: e.total_qty - loans.filter((l) => l.equipment_id === e.id && !l.returned_at).reduce((n, l) => n + l.qty, 0),
  };
  const loanView = (l) => {
    if (!l) return null;
    const e = equipment.find((x) => x.id === l.equipment_id);
    return { ...l, equipment: e?.name, sport: sportName(e?.sport_id) };
  };

  return {
    // helper for tests: insert a loan directly (e.g. an already-overdue one)
    _seedLoan(loan) {
      const row = { id: seq.loan++, borrowed_at: nowIso(), returned_at: null, ...loan };
      loans.push(row);
      return row;
    },
    async listSports() { return sports; },
    async getSport(id) { return sports.find((s) => s.id === id) || null; },
    async listEquipment({ sport_id, q } = {}) {
      return equipment
        .filter((e) => (!sport_id || e.sport_id === sport_id) && (!q || e.name.toLowerCase().includes(q.toLowerCase())))
        .map(eqView);
    },
    async getEquipment(id) { return eqView(equipment.find((e) => e.id === id)) || null; },
    async createEquipment(d) {
      const row = { id: seq.equipment++, ...d };
      equipment.push(row);
      return eqView(row);
    },
    async updateEquipment(id, d) {
      Object.assign(equipment.find((e) => e.id === id), d);
      return eqView(equipment.find((e) => e.id === id));
    },
    async deleteEquipment(id) { equipment = equipment.filter((e) => e.id !== id); },
    async countLoansForEquipment(id) { return loans.filter((l) => l.equipment_id === id).length; },
    async listLoans() { return loans.map(loanView); },
    async listActiveLoansByBorrower(code) {
      return loans.filter((l) => l.borrower_code === code && !l.returned_at).map(loanView);
    },
    async getLoan(id) { return loanView(loans.find((l) => l.id === id)); },
    async createLoan(d) { return loanView(this._seedLoan(d)); },
    async updateLoan(id, d) {
      Object.assign(loans.find((l) => l.id === id), d);
      return loanView(loans.find((l) => l.id === id));
    },
    async returnLoan(id) {
      loans.find((l) => l.id === id).returned_at = nowIso();
      return loanView(loans.find((l) => l.id === id));
    },
    async deleteLoan(id) { loans = loans.filter((l) => l.id !== id); },
  };
}

module.exports = { createFakeRepo };
