import { useEffect, useState } from 'react';
import { api } from './api.js';

const STOCK_LABEL = { in_stock: 'In stock', low_stock: 'Low stock', out_of_stock: 'Out of stock' };
const plusDays = (n) => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);

// Row of "rack slots": filled = units still on the shelf
function Slots({ available, total }) {
  const n = Math.min(total, 20);
  const filled = total === 0 ? 0 : Math.round((available / total) * n);
  return (
    <span className="slots" aria-hidden="true">
      {Array.from({ length: n }, (_, i) => <i key={i} className={i < filled ? 'on' : ''} />)}
    </span>
  );
}

export default function App() {
  const [tab, setTab] = useState('equipment');
  const [sports, setSports] = useState([]);
  const [equipment, setEquipment] = useState([]);
  const [loans, setLoans] = useState([]);
  const [sportId, setSportId] = useState('');
  const [q, setQ] = useState('');
  const [stockFilter, setStockFilter] = useState('');
  const [summary, setSummary] = useState(null);
  const [loanFilter, setLoanFilter] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [loading, setLoading] = useState(true);
  const [panel, setPanel] = useState(null); // {type:'borrow'|'edit'|'new'|'extend', item?, loan?}

  async function loadAll() {
    try {
      setError('');
      const params = new URLSearchParams();
      if (sportId) params.set('sport_id', sportId);
      if (q.trim()) params.set('q', q.trim());
      if (stockFilter) params.set('stock', stockFilter);
      const [s, e, l, sum] = await Promise.all([
        api.sports(),
        api.equipment(params.toString() ? `?${params}` : ''),
        api.loans(),
        api.summary(),
      ]);
      setSports(s); setEquipment(e); setLoans(l); setSummary(sum);
    } catch (err) {
      setError(err.message === 'database_not_configured'
        ? 'The API is running but no database is connected yet.'
        : `Cannot load data: ${err.message}`);
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => { loadAll(); }, [sportId, q, stockFilter]);

  async function run(action, success) {
    try {
      setError(''); setNotice('');
      await action();
      setNotice(success);
      setPanel(null);
      await loadAll();
    } catch (err) {
      setError(err.message);
    }
  }

  const shownLoans = loanFilter ? loans.filter((l) => l.status === loanFilter) : loans;

  return (
    <div className="app">
      <header className="top">
        <div>
          <h1>Sport Equipment Loan</h1>
          <p>Borrow balls, rackets and nets for football, badminton, takraw and more.</p>
        </div>
        <dl className="stats">
          <div><dt>Total units</dt><dd>{summary?.total_units ?? '-'}</dd></div>
          <div><dt>On loan</dt><dd>{summary?.on_loan_units ?? '-'}</dd></div>
          <div><dt>Available</dt><dd>{summary?.available_units ?? '-'}</dd></div>
          <div className={summary?.out_of_stock_items ? 'warn' : ''}><dt>Out of stock</dt><dd>{summary?.out_of_stock_items ?? '-'}<small>items</small></dd></div>
          <div className={summary?.overdue_loans ? 'warn' : ''}><dt>Overdue loans</dt><dd>{summary?.overdue_loans ?? '-'}</dd></div>
        </dl>
      </header>

      <nav className="tabs" role="tablist">
        {[['equipment', 'Equipment'], ['loans', 'Loans']].map(([key, label]) => (
          <button key={key} role="tab" aria-selected={tab === key} className={tab === key ? 'sel' : ''} onClick={() => { setTab(key); setPanel(null); }}>{label}</button>
        ))}
      </nav>

      {error && <p className="msg err" role="alert">{error}</p>}
      {notice && <p className="msg ok" role="status">{notice}</p>}

      {tab === 'equipment' && (
        <section>
          <div className="toolbar">
            <div className="chips">
              <button className={!sportId ? 'sel' : ''} onClick={() => setSportId('')}>All sports</button>
              {sports.map((s) => (
                <button key={s.id} className={String(s.id) === String(sportId) ? 'sel' : ''} onClick={() => setSportId(String(s.id))}>{s.name}</button>
              ))}
            </div>
            <div className="chips">
              {[['', 'Any stock'], ['in_stock', 'In stock'], ['low_stock', 'Low stock'], ['out_of_stock', 'Out of stock']].map(([key, label]) => (
                <button key={key} className={stockFilter === key ? 'sel' : ''} onClick={() => setStockFilter(key)}>{label}</button>
              ))}
            </div>
            <input type="search" placeholder="Search equipment" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search equipment" />
            <button className="primary" onClick={() => setPanel({ type: 'new' })}>Add equipment</button>
          </div>

          {panel?.type === 'new' && <EquipmentForm sports={sports} onCancel={() => setPanel(null)}
            onSave={(b) => run(() => api.createEquipment(b), 'Equipment added')} />}

          {loading ? <p className="empty">Loading...</p> : equipment.length === 0 ? (
            <p className="empty">No equipment matches. Clear the filter or add a new item.</p>
          ) : (
            <ul className="ledger">
              {equipment.map((it) => (
                <li key={it.id}>
                  <div className="main">
                    <strong>{it.name}</strong>
                    <span className="sport">{it.sport}</span>
                  </div>
                  <div className="stock wide">
                    <dl className="nums">
                      <div><dt>Total</dt><dd>{it.total_qty}</dd></div>
                      <div><dt>On loan</dt><dd>{it.on_loan_qty}</dd></div>
                      <div><dt>Available</dt><dd className={it.available_qty === 0 ? 'none' : ''}>{it.available_qty}</dd></div>
                    </dl>
                    <div className="meter">
                      <Slots available={it.available_qty} total={it.total_qty} />
                      <span className={`pill ${it.stock_status}`}>{STOCK_LABEL[it.stock_status]}</span>
                    </div>
                  </div>
                  <div className="actions">
                    <button className="primary" disabled={it.available_qty === 0} title={it.available_qty === 0 ? 'Out of stock' : ''} onClick={() => setPanel({ type: 'borrow', item: it })}>Borrow</button>
                    <button onClick={() => setPanel({ type: 'edit', item: it })}>Edit</button>
                    <button className="danger" onClick={() => window.confirm(`Delete "${it.name}"?`) && run(() => api.deleteEquipment(it.id), 'Equipment deleted')}>Delete</button>
                  </div>
                  {panel?.item?.id === it.id && panel.type === 'edit' && (
                    <EquipmentForm sports={sports} initial={it} onCancel={() => setPanel(null)}
                      onSave={(b) => run(() => api.updateEquipment(it.id, b), 'Equipment updated')} />
                  )}
                  {panel?.item?.id === it.id && panel.type === 'borrow' && (
                    <BorrowForm item={it} onCancel={() => setPanel(null)}
                      onSave={(b) => run(() => api.borrow({ ...b, equipment_id: it.id }), 'Loan recorded')} />
                  )}
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      {tab === 'loans' && (
        <section>
          <div className="toolbar">
            <div className="chips">
              {[['', 'All'], ['active', 'Active'], ['overdue', 'Overdue'], ['returned', 'Returned']].map(([key, label]) => (
                <button key={key} className={loanFilter === key ? 'sel' : ''} onClick={() => setLoanFilter(key)}>{label}</button>
              ))}
            </div>
          </div>
          {shownLoans.length === 0 ? (
            <p className="empty">No loans here yet. Borrow something from the Equipment tab.</p>
          ) : (
            <ul className="ledger">
              {shownLoans.map((l) => (
                <li key={l.id}>
                  <div className="main">
                    <strong>{l.qty} x {l.equipment}</strong>
                    <span className="sport">{l.borrower_name} ({l.borrower_code})</span>
                  </div>
                  <div className="stock">
                    <span className={`pill ${l.status}`}>{l.status}</span>
                    <span className="count">{l.status === 'returned' ? `returned ${l.returned_at.slice(0, 10)}` : `due ${l.due_date}`}</span>
                  </div>
                  <div className="actions">
                    {l.status !== 'returned' && <button className="primary" onClick={() => run(() => api.returnLoan(l.id), 'Marked as returned')}>Return</button>}
                    {l.status !== 'returned' && <button onClick={() => setPanel({ type: 'extend', loan: l })}>Extend</button>}
                    <button className="danger" onClick={() => window.confirm('Delete this loan record?') && run(() => api.deleteLoan(l.id), 'Loan deleted')}>Delete</button>
                  </div>
                  {panel?.type === 'extend' && panel.loan.id === l.id && (
                    <ExtendForm loan={l} onCancel={() => setPanel(null)}
                      onSave={(due_date) => run(() => api.updateLoan(l.id, { due_date }), 'Due date updated')} />
                  )}
                </li>
              ))}
            </ul>
          )}
        </section>
      )}
    </div>
  );
}

function EquipmentForm({ sports, initial, onSave, onCancel }) {
  const [f, setF] = useState({ sport_id: initial?.sport_id ?? sports[0]?.id ?? '', name: initial?.name ?? '', total_qty: initial?.total_qty ?? 1 });
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  return (
    <div className="form" onKeyDown={(e) => e.key === 'Escape' && onCancel()}>
      <label>Sport
        <select value={f.sport_id} onChange={set('sport_id')}>{sports.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select>
      </label>
      <label>Name<input value={f.name} onChange={set('name')} maxLength={100} placeholder="Takraw ball (rattan)" /></label>
      <label>Total units<input type="number" min="0" value={f.total_qty} onChange={set('total_qty')} /></label>
      <div className="row">
        <button className="primary" onClick={() => onSave({ sport_id: Number(f.sport_id), name: f.name, total_qty: Number(f.total_qty) })}>{initial ? 'Save changes' : 'Add equipment'}</button>
        <button onClick={onCancel}>Cancel</button>
      </div>
    </div>
  );
}

function BorrowForm({ item, onSave, onCancel }) {
  const [f, setF] = useState({ borrower_name: '', borrower_code: '', qty: 1, due_date: plusDays(3) });
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  return (
    <div className="form" onKeyDown={(e) => e.key === 'Escape' && onCancel()}>
      <label>Borrower name<input value={f.borrower_name} onChange={set('borrower_name')} /></label>
      <label>Student or staff ID<input value={f.borrower_code} onChange={set('borrower_code')} /></label>
      <label>Units<input type="number" min="1" max={item.available_qty} value={f.qty} onChange={set('qty')} /></label>
      <label>Return by<input type="date" min={plusDays(0)} max={plusDays(7)} value={f.due_date} onChange={set('due_date')} /></label>
      <div className="row">
        <button className="primary" onClick={() => onSave({ ...f, qty: Number(f.qty) })}>Confirm borrow</button>
        <button onClick={onCancel}>Cancel</button>
      </div>
    </div>
  );
}

function ExtendForm({ loan, onSave, onCancel }) {
  const [d, setD] = useState(loan.due_date);
  return (
    <div className="form">
      <label>New return date<input type="date" value={d} onChange={(e) => setD(e.target.value)} /></label>
      <div className="row">
        <button className="primary" onClick={() => onSave(d)}>Save date</button>
        <button onClick={onCancel}>Cancel</button>
      </div>
    </div>
  );
}
