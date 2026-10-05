const express = require('express');
const cors = require('cors');
const v = require('./validate');

/**
 * createApp(repo, options)
 *  repo    - data layer (see repo.js). Injected so tests can use an in-memory fake.
 *  options - { maxLoanDays, today(), corsOrigin }
 */
function createApp(repo, options = {}) {
  const maxLoanDays = options.maxLoanDays ?? 7;
  const today = options.today ?? (() => new Date().toISOString().slice(0, 10));

  const app = express();
  app.use(cors({ origin: options.corsOrigin ?? true }));
  app.use(express.json());

  const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
  const badRequest = (res, details) => res.status(400).json({ error: 'validation_failed', details });
  const fail = (res, status, error, extra = {}) => res.status(status).json({ error, ...extra });

  // loan status is derived: returned > overdue > active
  const withStatus = (loan) => ({
    ...loan,
    status: loan.returned_at ? 'returned' : loan.due_date < today() ? 'overdue' : 'active',
  });

  // stock view: total -> on loan -> available, plus a simple status
  //   out_of_stock : nothing left on the shelf
  //   low_stock    : 25% or less of the total left (rounded up)
  //   in_stock     : everything else
  const withStock = (e) => {
    const on_loan_qty = e.total_qty - e.available_qty;
    const stock_status = e.available_qty <= 0
      ? 'out_of_stock'
      : e.available_qty <= Math.ceil(e.total_qty * 0.25) ? 'low_stock' : 'in_stock';
    return { ...e, on_loan_qty, stock_status };
  };
  const STOCK_STATUSES = ['in_stock', 'low_stock', 'out_of_stock'];

  // ---------- health ----------
  app.get('/', (req, res) => res.json({ status: 'ok', service: 'sports-locker-api' }));

  // ---------- sports ----------
  app.get('/sports', wrap(async (req, res) => res.json(await repo.listSports())));

  // ---------- equipment CRUD ----------
  function readEquipment(body = {}) {
    const details = {};
    const sport_id = v.posInt(body.sport_id);
    const name = v.str(body.name, 100);
    const total_qty = v.nonNegInt(body.total_qty);
    if (!sport_id) details.sport_id = 'required positive integer';
    if (!name) details.name = 'required, max 100 characters';
    if (total_qty === null) details.total_qty = 'required integer >= 0';
    return { details, value: { sport_id, name, total_qty } };
  }

  app.get('/equipment', wrap(async (req, res) => {
    const sport_id = req.query.sport_id ? v.posInt(req.query.sport_id) : undefined;
    const q = typeof req.query.q === 'string' && req.query.q.trim() ? req.query.q.trim() : undefined;
    let list = (await repo.listEquipment({ sport_id, q })).map(withStock);
    const { stock } = req.query;
    if (stock) {
      if (!STOCK_STATUSES.includes(stock)) return badRequest(res, { stock: STOCK_STATUSES.join(' | ') });
      list = list.filter((e) => e.stock_status === stock);
    }
    res.json(list);
  }));

  // dashboard numbers for the whole locker
  app.get('/summary', wrap(async (req, res) => {
    const [items, loans] = await Promise.all([repo.listEquipment(), repo.listLoans()]);
    const eq = items.map(withStock);
    const sum = (key) => eq.reduce((n, e) => n + e[key], 0);
    res.json({
      equipment_items: eq.length,
      total_units: sum('total_qty'),
      on_loan_units: sum('on_loan_qty'),
      available_units: sum('available_qty'),
      out_of_stock_items: eq.filter((e) => e.stock_status === 'out_of_stock').length,
      low_stock_items: eq.filter((e) => e.stock_status === 'low_stock').length,
      overdue_loans: loans.map(withStatus).filter((l) => l.status === 'overdue').length,
    });
  }));

  app.get('/equipment/:id', wrap(async (req, res) => {
    const id = v.posInt(req.params.id);
    const item = id && (await repo.getEquipment(id));
    if (!item) return fail(res, 404, 'equipment_not_found');
    res.json(withStock(item));
  }));

  app.post('/equipment', wrap(async (req, res) => {
    const { details, value } = readEquipment(req.body);
    if (Object.keys(details).length) return badRequest(res, details);
    if (!(await repo.getSport(value.sport_id))) return badRequest(res, { sport_id: 'sport does not exist' });
    res.status(201).json(withStock(await repo.createEquipment(value)));
  }));

  app.put('/equipment/:id', wrap(async (req, res) => {
    const id = v.posInt(req.params.id);
    const current = id && (await repo.getEquipment(id));
    if (!current) return fail(res, 404, 'equipment_not_found');
    const { details, value } = readEquipment(req.body);
    if (Object.keys(details).length) return badRequest(res, details);
    if (!(await repo.getSport(value.sport_id))) return badRequest(res, { sport_id: 'sport does not exist' });
    const onLoan = current.total_qty - current.available_qty;
    if (value.total_qty < onLoan) {
      return fail(res, 409, 'qty_below_on_loan', { on_loan: onLoan, message: `${onLoan} unit(s) are currently borrowed` });
    }
    res.json(withStock(await repo.updateEquipment(id, value)));
  }));

  app.delete('/equipment/:id', wrap(async (req, res) => {
    const id = v.posInt(req.params.id);
    const current = id && (await repo.getEquipment(id));
    if (!current) return fail(res, 404, 'equipment_not_found');
    if ((await repo.countLoansForEquipment(id)) > 0) {
      return fail(res, 409, 'equipment_has_loans', { message: 'Items with loan history cannot be deleted. Set total_qty to 0 to retire it.' });
    }
    await repo.deleteEquipment(id);
    res.status(204).end();
  }));

  // ---------- loans CRUD ----------
  app.get('/loans', wrap(async (req, res) => {
    let loans = (await repo.listLoans()).map(withStatus);
    const { status } = req.query;
    if (status) {
      if (!['active', 'overdue', 'returned'].includes(status)) return badRequest(res, { status: 'active | overdue | returned' });
      loans = loans.filter((l) => l.status === status);
    }
    res.json(loans);
  }));

  app.get('/loans/:id', wrap(async (req, res) => {
    const id = v.posInt(req.params.id);
    const loan = id && (await repo.getLoan(id));
    if (!loan) return fail(res, 404, 'loan_not_found');
    res.json(withStatus(loan));
  }));

  app.post('/loans', wrap(async (req, res) => {
    const b = req.body || {};
    const details = {};
    const equipment_id = v.posInt(b.equipment_id);
    const borrower_name = v.str(b.borrower_name, 100);
    const borrower_code = v.code(b.borrower_code);
    const qty = v.posInt(b.qty ?? 1);
    const due_date = v.dateStr(b.due_date);
    if (!equipment_id) details.equipment_id = 'required positive integer';
    if (!borrower_name) details.borrower_name = 'required, max 100 characters';
    if (!borrower_code) details.borrower_code = 'required, 3-20 letters/digits';
    if (!qty) details.qty = 'positive integer';
    if (!due_date) details.due_date = 'required, format YYYY-MM-DD';
    if (Object.keys(details).length) return badRequest(res, details);

    const days = v.daysBetween(today(), due_date);
    if (days < 0 || days > maxLoanDays) {
      return fail(res, 400, 'invalid_due_date', { message: `due_date must be today or up to ${maxLoanDays} days ahead` });
    }

    const item = await repo.getEquipment(equipment_id);
    if (!item) return fail(res, 404, 'equipment_not_found');

    // Rule 1: borrowers with an overdue loan are blocked until they return it
    const open = await repo.listActiveLoansByBorrower(borrower_code);
    if (open.some((l) => l.due_date < today())) {
      return fail(res, 409, 'borrower_has_overdue', { message: 'Return your overdue equipment before borrowing again' });
    }
    // Rule 2: cannot borrow more than what is in stock
    if (qty > item.available_qty) {
      return fail(res, 409, 'insufficient_stock', { available: item.available_qty, message: `Only ${item.available_qty} available` });
    }

    const loan = await repo.createLoan({ equipment_id, borrower_name, borrower_code, qty, due_date });
    res.status(201).json(withStatus(loan));
  }));

  // Update borrower info or extend the due date (not allowed after return)
  app.put('/loans/:id', wrap(async (req, res) => {
    const id = v.posInt(req.params.id);
    const loan = id && (await repo.getLoan(id));
    if (!loan) return fail(res, 404, 'loan_not_found');
    if (loan.returned_at) return fail(res, 409, 'already_returned');

    const b = req.body || {};
    const next = { borrower_name: loan.borrower_name, borrower_code: loan.borrower_code, due_date: loan.due_date };
    const details = {};
    if ('borrower_name' in b) { next.borrower_name = v.str(b.borrower_name, 100); if (!next.borrower_name) details.borrower_name = 'max 100 characters'; }
    if ('borrower_code' in b) { next.borrower_code = v.code(b.borrower_code); if (!next.borrower_code) details.borrower_code = '3-20 letters/digits'; }
    if ('due_date' in b) { next.due_date = v.dateStr(b.due_date); if (!next.due_date) details.due_date = 'format YYYY-MM-DD'; }
    if (!['borrower_name', 'borrower_code', 'due_date'].some((k) => k in b)) {
      return badRequest(res, { body: 'send borrower_name, borrower_code and/or due_date' });
    }
    if (Object.keys(details).length) return badRequest(res, details);

    if ('due_date' in b) {
      const fromBorrow = v.daysBetween(loan.borrowed_at.slice(0, 10), next.due_date);
      if (next.due_date < today() || fromBorrow > maxLoanDays) {
        return fail(res, 400, 'invalid_due_date', { message: `due_date cannot be in the past or more than ${maxLoanDays} days after borrowing` });
      }
    }
    res.json(withStatus(await repo.updateLoan(id, next)));
  }));

  app.post('/loans/:id/return', wrap(async (req, res) => {
    const id = v.posInt(req.params.id);
    const loan = id && (await repo.getLoan(id));
    if (!loan) return fail(res, 404, 'loan_not_found');
    if (loan.returned_at) return fail(res, 409, 'already_returned');
    res.json(withStatus(await repo.returnLoan(id)));
  }));

  app.delete('/loans/:id', wrap(async (req, res) => {
    const id = v.posInt(req.params.id);
    const loan = id && (await repo.getLoan(id));
    if (!loan) return fail(res, 404, 'loan_not_found');
    await repo.deleteLoan(id);
    res.status(204).end();
  }));

  // ---------- fallbacks ----------
  app.use((req, res) => fail(res, 404, 'not_found'));

  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    if (err.code === 'database_not_configured') return fail(res, 503, 'database_not_configured');
    if (err.type === 'entity.parse.failed') return fail(res, 400, 'invalid_json');
    if (err.number === 2627 || err.number === 2601) return fail(res, 409, 'duplicate', { message: 'This item already exists for that sport' });
    if (err.number === 547) return fail(res, 409, 'constraint_violation');
    console.error(err);
    fail(res, 500, 'internal_error');
  });

  return app;
}

module.exports = { createApp };
