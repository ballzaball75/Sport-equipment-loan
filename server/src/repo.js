// Data layer: all SQL lives here. The API (app.js) only talks to this interface,
// which is why the tests can swap it for an in-memory fake.
const sql = require('mssql');

let poolPromise;

function getPool() {
  const cs = process.env.AZURE_SQL_CONNECTION_STRING;
  if (!cs) {
    const err = new Error('database_not_configured');
    err.code = 'database_not_configured';
    throw err;
  }
  if (!poolPromise) {
    poolPromise = new sql.ConnectionPool(cs).connect().catch((e) => {
      poolPromise = undefined; // allow retry on the next request
      throw e;
    });
  }
  return poolPromise;
}

const iso = (d) => (d ? new Date(d).toISOString() : null);
const day = (d) => (d ? new Date(d).toISOString().slice(0, 10) : null);

const mapLoan = (r) =>
  r && { ...r, borrowed_at: iso(r.borrowed_at), due_date: day(r.due_date), returned_at: iso(r.returned_at) };

const EQUIPMENT_SELECT = `
  SELECT e.id, e.sport_id, s.name AS sport, e.name, e.total_qty,
         e.total_qty - ISNULL(SUM(CASE WHEN l.returned_at IS NULL THEN l.qty END), 0) AS available_qty
  FROM dbo.equipment e
  JOIN dbo.sports s ON s.id = e.sport_id
  LEFT JOIN dbo.loans l ON l.equipment_id = e.id`;
const EQUIPMENT_GROUP = `GROUP BY e.id, e.sport_id, s.name, e.name, e.total_qty`;

const LOAN_SELECT = `
  SELECT l.id, l.equipment_id, e.name AS equipment, s.name AS sport,
         l.borrower_name, l.borrower_code, l.qty, l.borrowed_at, l.due_date, l.returned_at
  FROM dbo.loans l
  JOIN dbo.equipment e ON e.id = l.equipment_id
  JOIN dbo.sports s ON s.id = e.sport_id`;

module.exports = {
  // ---- sports ----
  async listSports() {
    const r = await (await getPool()).request().query('SELECT id, name FROM dbo.sports ORDER BY name');
    return r.recordset;
  },
  async getSport(id) {
    const r = await (await getPool()).request().input('id', sql.Int, id)
      .query('SELECT id, name FROM dbo.sports WHERE id = @id');
    return r.recordset[0] || null;
  },

  // ---- equipment ----
  async listEquipment({ sport_id, q } = {}) {
    const r = await (await getPool()).request()
      .input('sport_id', sql.Int, sport_id ?? null)
      .input('q', sql.NVarChar(100), q ?? null)
      .query(`${EQUIPMENT_SELECT}
              WHERE (@sport_id IS NULL OR e.sport_id = @sport_id)
                AND (@q IS NULL OR e.name LIKE '%' + @q + '%')
              ${EQUIPMENT_GROUP} ORDER BY s.name, e.name`);
    return r.recordset;
  },
  async getEquipment(id) {
    const r = await (await getPool()).request().input('id', sql.Int, id)
      .query(`${EQUIPMENT_SELECT} WHERE e.id = @id ${EQUIPMENT_GROUP}`);
    return r.recordset[0] || null;
  },
  async createEquipment({ sport_id, name, total_qty }) {
    const r = await (await getPool()).request()
      .input('sport_id', sql.Int, sport_id)
      .input('name', sql.NVarChar(100), name)
      .input('total_qty', sql.Int, total_qty)
      .query(`INSERT INTO dbo.equipment (sport_id, name, total_qty)
              OUTPUT INSERTED.id VALUES (@sport_id, @name, @total_qty)`);
    return this.getEquipment(r.recordset[0].id);
  },
  async updateEquipment(id, { sport_id, name, total_qty }) {
    await (await getPool()).request()
      .input('id', sql.Int, id)
      .input('sport_id', sql.Int, sport_id)
      .input('name', sql.NVarChar(100), name)
      .input('total_qty', sql.Int, total_qty)
      .query('UPDATE dbo.equipment SET sport_id=@sport_id, name=@name, total_qty=@total_qty WHERE id=@id');
    return this.getEquipment(id);
  },
  async deleteEquipment(id) {
    await (await getPool()).request().input('id', sql.Int, id)
      .query('DELETE FROM dbo.equipment WHERE id = @id');
  },
  async countLoansForEquipment(id) {
    const r = await (await getPool()).request().input('id', sql.Int, id)
      .query('SELECT COUNT(*) AS n FROM dbo.loans WHERE equipment_id = @id');
    return r.recordset[0].n;
  },

  // ---- loans ----
  async listLoans() {
    const r = await (await getPool()).request()
      .query(`${LOAN_SELECT} ORDER BY CASE WHEN l.returned_at IS NULL THEN 0 ELSE 1 END, l.due_date, l.id DESC`);
    return r.recordset.map(mapLoan);
  },
  async listActiveLoansByBorrower(code) {
    const r = await (await getPool()).request().input('code', sql.NVarChar(20), code)
      .query(`${LOAN_SELECT} WHERE l.borrower_code = @code AND l.returned_at IS NULL`);
    return r.recordset.map(mapLoan);
  },
  async getLoan(id) {
    const r = await (await getPool()).request().input('id', sql.Int, id)
      .query(`${LOAN_SELECT} WHERE l.id = @id`);
    return mapLoan(r.recordset[0]) || null;
  },
  async createLoan({ equipment_id, borrower_name, borrower_code, qty, due_date }) {
    const r = await (await getPool()).request()
      .input('equipment_id', sql.Int, equipment_id)
      .input('borrower_name', sql.NVarChar(100), borrower_name)
      .input('borrower_code', sql.NVarChar(20), borrower_code)
      .input('qty', sql.Int, qty)
      .input('due_date', sql.Date, new Date(`${due_date}T00:00:00Z`))
      .query(`INSERT INTO dbo.loans (equipment_id, borrower_name, borrower_code, qty, due_date)
              OUTPUT INSERTED.id
              VALUES (@equipment_id, @borrower_name, @borrower_code, @qty, @due_date)`);
    return this.getLoan(r.recordset[0].id);
  },
  async updateLoan(id, { borrower_name, borrower_code, due_date }) {
    await (await getPool()).request()
      .input('id', sql.Int, id)
      .input('borrower_name', sql.NVarChar(100), borrower_name)
      .input('borrower_code', sql.NVarChar(20), borrower_code)
      .input('due_date', sql.Date, new Date(`${due_date}T00:00:00Z`))
      .query('UPDATE dbo.loans SET borrower_name=@borrower_name, borrower_code=@borrower_code, due_date=@due_date WHERE id=@id');
    return this.getLoan(id);
  },
  async returnLoan(id) {
    await (await getPool()).request().input('id', sql.Int, id)
      .query('UPDATE dbo.loans SET returned_at = SYSUTCDATETIME() WHERE id = @id AND returned_at IS NULL');
    return this.getLoan(id);
  },
  async deleteLoan(id) {
    await (await getPool()).request().input('id', sql.Int, id)
      .query('DELETE FROM dbo.loans WHERE id = @id');
  },
};
