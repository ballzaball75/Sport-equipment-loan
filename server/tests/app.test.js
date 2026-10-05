const request = require('supertest');
const { createApp } = require('../src/app');
const { createFakeRepo } = require('./fakeRepo');

const TODAY = '2026-10-10';
const plusDays = (n) => new Date(Date.parse(`${TODAY}T00:00:00Z`) + n * 86400000).toISOString().slice(0, 10);

let repo, app;
beforeEach(() => {
  repo = createFakeRepo(() => `${TODAY}T09:00:00.000Z`);
  app = createApp(repo, { today: () => TODAY, maxLoanDays: 7 });
});

const borrow = (over = {}) =>
  request(app).post('/loans').send({
    equipment_id: 1, borrower_name: 'Somchai', borrower_code: '66025650', qty: 2, due_date: plusDays(3), ...over,
  });

describe('health', () => {
  test('GET / returns ok', async () => {
    const res = await request(app).get('/');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
  });
  test('unknown route returns 404 json', async () => {
    const res = await request(app).get('/nope');
    expect(res.status).toBe(404);
  });
});

describe('equipment CRUD', () => {
  test('create: valid body returns 201 with availability', async () => {
    const res = await request(app).post('/equipment').send({ sport_id: 1, name: 'Cones', total_qty: 5 });
    expect(res.status).toBe(201);
    expect(res.body.available_qty).toBe(5);
  });
  test('create: missing fields returns 400 with details', async () => {
    const res = await request(app).post('/equipment').send({ name: '' });
    expect(res.status).toBe(400);
    expect(res.body.details).toHaveProperty('sport_id');
    expect(res.body.details).toHaveProperty('name');
  });
  test('create: unknown sport returns 400', async () => {
    const res = await request(app).post('/equipment').send({ sport_id: 99, name: 'X', total_qty: 1 });
    expect(res.status).toBe(400);
  });
  test('read: list can be filtered by search text', async () => {
    const res = await request(app).get('/equipment?q=racket');
    expect(res.body).toHaveLength(1);
    expect(res.body[0].name).toBe('Badminton racket');
  });
  test('read: unknown id returns 404', async () => {
    expect((await request(app).get('/equipment/999')).status).toBe(404);
  });
  test('update: cannot set total below the amount currently borrowed', async () => {
    await borrow({ qty: 3 });
    const res = await request(app).put('/equipment/1').send({ sport_id: 1, name: 'Football size 5', total_qty: 2 });
    expect(res.status).toBe(409);
    expect(res.body.error).toBe('qty_below_on_loan');
  });
  test('update: valid change returns 200', async () => {
    const res = await request(app).put('/equipment/1').send({ sport_id: 1, name: 'Football size 5', total_qty: 12 });
    expect(res.status).toBe(200);
    expect(res.body.total_qty).toBe(12);
  });
  test('delete: blocked when the item has loan history', async () => {
    await borrow();
    expect((await request(app).delete('/equipment/1')).status).toBe(409);
  });
  test('delete: succeeds for an unused item', async () => {
    expect((await request(app).delete('/equipment/2')).status).toBe(204);
    expect((await request(app).get('/equipment/2')).status).toBe(404);
  });
});

describe('stock view', () => {
  test('equipment shows total, on loan and available', async () => {
    await borrow({ qty: 3 });
    const { body } = await request(app).get('/equipment/1');
    expect(body.total_qty).toBe(10);
    expect(body.on_loan_qty).toBe(3);
    expect(body.available_qty).toBe(7);
    expect(body.stock_status).toBe('in_stock');
  });
  test('status becomes low_stock when 25% or less is left', async () => {
    await borrow({ qty: 8 });
    expect((await request(app).get('/equipment/1')).body.stock_status).toBe('low_stock');
  });
  test('status becomes out_of_stock when everything is borrowed, and borrowing is refused', async () => {
    await borrow({ equipment_id: 2, qty: 4 });
    const item = (await request(app).get('/equipment/2')).body;
    expect(item.available_qty).toBe(0);
    expect(item.stock_status).toBe('out_of_stock');
    const again = await borrow({ equipment_id: 2, qty: 1, borrower_code: 'OTHER-01' });
    expect(again.status).toBe(409);
    expect(again.body.available).toBe(0);
  });
  test('returning puts the item back in stock', async () => {
    const { body } = await borrow({ equipment_id: 2, qty: 4 });
    await request(app).post(`/loans/${body.id}/return`);
    expect((await request(app).get('/equipment/2')).body.stock_status).toBe('in_stock');
  });
  test('?stock= filters the list; unknown value returns 400', async () => {
    await borrow({ equipment_id: 2, qty: 4 });
    const out = await request(app).get('/equipment?stock=out_of_stock');
    expect(out.body.map((e) => e.id)).toEqual([2]);
    expect((await request(app).get('/equipment?stock=empty')).status).toBe(400);
  });
  test('GET /summary totals the whole locker', async () => {
    await borrow({ equipment_id: 2, qty: 4 });
    repo._seedLoan({ equipment_id: 1, borrower_name: 'A', borrower_code: 'AAA111', qty: 2, due_date: plusDays(-1) });
    const { body } = await request(app).get('/summary');
    expect(body).toMatchObject({
      equipment_items: 2, total_units: 14, on_loan_units: 6, available_units: 8,
      out_of_stock_items: 1, overdue_loans: 1,
    });
  });
});

describe('loans', () => {
  test('borrow reduces available stock', async () => {
    const res = await borrow({ qty: 3 });
    expect(res.status).toBe(201);
    expect(res.body.status).toBe('active');
    expect((await request(app).get('/equipment/1')).body.available_qty).toBe(7);
  });
  test('borrow more than available returns 409 insufficient_stock', async () => {
    const res = await borrow({ equipment_id: 2, qty: 5 });
    expect(res.status).toBe(409);
    expect(res.body.error).toBe('insufficient_stock');
    expect(res.body.available).toBe(4);
  });
  test('borrow with a due date beyond the limit returns 400', async () => {
    const res = await borrow({ due_date: plusDays(8) });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_due_date');
  });
  test('borrow with a due date in the past returns 400', async () => {
    expect((await borrow({ due_date: plusDays(-1) })).status).toBe(400);
  });
  test('borrow with bad body returns 400', async () => {
    const res = await request(app).post('/loans').send({ equipment_id: 1 });
    expect(res.status).toBe(400);
  });
  test('borrow unknown equipment returns 404', async () => {
    expect((await borrow({ equipment_id: 99 })).status).toBe(404);
  });
  test('borrower with an overdue loan is blocked', async () => {
    repo._seedLoan({ equipment_id: 1, borrower_name: 'Somchai', borrower_code: '66025650', qty: 1, due_date: plusDays(-2) });
    const res = await borrow();
    expect(res.status).toBe(409);
    expect(res.body.error).toBe('borrower_has_overdue');
  });
  test('status filter lists overdue loans only', async () => {
    repo._seedLoan({ equipment_id: 1, borrower_name: 'A', borrower_code: 'AAA111', qty: 1, due_date: plusDays(-2) });
    repo._seedLoan({ equipment_id: 1, borrower_name: 'B', borrower_code: 'BBB222', qty: 1, due_date: plusDays(2) });
    const res = await request(app).get('/loans?status=overdue');
    expect(res.body).toHaveLength(1);
    expect(res.body[0].borrower_code).toBe('AAA111');
  });
  test('return restores stock; returning twice returns 409', async () => {
    const { body } = await borrow({ qty: 4 });
    const ret = await request(app).post(`/loans/${body.id}/return`);
    expect(ret.status).toBe(200);
    expect(ret.body.status).toBe('returned');
    expect((await request(app).get('/equipment/1')).body.available_qty).toBe(10);
    expect((await request(app).post(`/loans/${body.id}/return`)).status).toBe(409);
  });
  test('update: extend the due date within the limit', async () => {
    const { body } = await borrow({ due_date: plusDays(2) });
    const res = await request(app).put(`/loans/${body.id}`).send({ due_date: plusDays(5) });
    expect(res.status).toBe(200);
    expect(res.body.due_date).toBe(plusDays(5));
  });
  test('update: cannot extend a returned loan', async () => {
    const { body } = await borrow();
    await request(app).post(`/loans/${body.id}/return`);
    expect((await request(app).put(`/loans/${body.id}`).send({ due_date: plusDays(4) })).status).toBe(409);
  });
  test('update: empty body returns 400', async () => {
    const { body } = await borrow();
    expect((await request(app).put(`/loans/${body.id}`).send({})).status).toBe(400);
  });
  test('delete: removes the loan and frees the stock', async () => {
    const { body } = await borrow({ qty: 5 });
    expect((await request(app).delete(`/loans/${body.id}`)).status).toBe(204);
    expect((await request(app).get(`/loans/${body.id}`)).status).toBe(404);
    expect((await request(app).get('/equipment/1')).body.available_qty).toBe(10);
  });
});
