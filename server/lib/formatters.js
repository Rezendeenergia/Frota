// Helpers de parsing pt-BR compartilhados pelos serviços deste painel.

// "R$ 1.187,00" / "1187" / 1187 / null -> 1187 (number) | null
export function parseMoneyBR(value) {
  if (value === null || value === undefined) return null;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  const s = String(value).trim();
  if (s === '') return null;
  const cleaned = s.replace(/R\$\s?/g, '').trim().replace(/\./g, '').replace(',', '.');
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

// Aceita Date (quando a planilha vem com cellDates:true) ou string dd/mm/aaaa.
export function parseDateBR(value) {
  if (!value) return null;
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value;
  const s = String(value).trim();
  const m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (!m) return null;
  const [, d, mo, y] = m;
  const dt = new Date(Date.UTC(Number(y), Number(mo) - 1, Number(d)));
  return Number.isNaN(dt.getTime()) ? null : dt;
}

export function diffDays(a, b) {
  if (!a || !b) return null;
  const MS_DAY = 24 * 60 * 60 * 1000;
  return Math.round((b.getTime() - a.getTime()) / MS_DAY);
}

export function formatBRL(n) {
  if (n === null || n === undefined) return '—';
  return n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', minimumFractionDigits: 2 });
}

// Normaliza cabeçalho de coluna: remove acentos, comprime espaços, upper-case.
// Usado para casar colunas da planilha por nome em vez de índice fixo — assim
// o parser não quebra se alguém reordenar colunas no SharePoint.
export function normalizeHeader(h) {
  return String(h ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toUpperCase();
}
