// Small input-validation helpers. Each returns the cleaned value, or null when invalid.

function str(v, max) {
  if (typeof v !== 'string') return null;
  const t = v.trim();
  return t.length > 0 && t.length <= max ? t : null;
}

function toNumber(v) {
  if (typeof v === 'string' && v.trim() !== '') return Number(v);
  return v;
}

function posInt(v) {
  const n = toNumber(v);
  return Number.isInteger(n) && n > 0 ? n : null;
}

function nonNegInt(v) {
  const n = toNumber(v);
  return Number.isInteger(n) && n >= 0 ? n : null;
}

// student / staff id: letters, digits, dash, 3-20 chars
function code(v) {
  return typeof v === 'string' && /^[A-Za-z0-9-]{3,20}$/.test(v.trim()) ? v.trim() : null;
}

// strict YYYY-MM-DD
function dateStr(v) {
  if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return null;
  const d = new Date(`${v}T00:00:00Z`);
  return Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== v ? null : v;
}

function daysBetween(a, b) {
  return Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86400000);
}

module.exports = { str, posInt, nonNegInt, code, dateStr, daysBetween };
