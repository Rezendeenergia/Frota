// Regras e cálculo do relatório "Fora de Horário" (rastreamento veicular).
// Módulo puro, sem dependências: roda no navegador (fora-horario.js) e no
// Node (testes). Recebe as linhas da planilha como arrays de células.
//
// Regras definidas pela empresa (out/2026):
//   • Expediente: 08:00 às 19:00, segunda a sexta. Fora disso = fora de horário.
//   • Sábado: expediente das 08:00 às 12:00; fora disso = fora de horário.
//   • Domingo e feriado: o dia inteiro é fora de horário.
//   • Viagem que encosta no período proibido conta INTEIRA (ex.: 07:53–08:26).
//   • Viagens abaixo de 0,5 km são ignoradas (manobra/pátio).
//   • Não há plantão: ninguém é "autorizado". Lancha entra na mesma regra.

export const REGRAS_PADRAO = {
  inicioExpediente: 8,   // hora (inclusive)
  fimExpediente: 19,     // hora (exclusive)
  fimSabado: 12,         // sábado: expediente até esta hora (exclusive)
  kmMinimo: 0.5,
};

// ---------- feriados ----------
function pascoa(ano) {
  // Algoritmo de Meeus/Jones/Butcher
  const a = ano % 19, b = Math.floor(ano / 100), c = ano % 100;
  const d = Math.floor(b / 4), e = b % 4, f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3), h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4), k = c % 4, l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const mes = Math.floor((h + l - 7 * m + 114) / 31);
  const dia = ((h + l - 7 * m + 114) % 31) + 1;
  return new Date(ano, mes - 1, dia);
}

const pad2 = (n) => String(n).padStart(2, '0');
export const chaveDia = (d) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;

// Feriados nacionais + estadual do Pará. Feriados municipais e pontos
// facultativos (Carnaval, Corpus Christi…) entram pela lista de extras.
export function feriadosDoAno(ano) {
  const fixos = [
    ['01-01', 'Confraternização Universal'],
    ['04-21', 'Tiradentes'],
    ['05-01', 'Dia do Trabalho'],
    ['08-15', 'Adesão do Pará'],
    ['09-07', 'Independência do Brasil'],
    ['10-12', 'Nossa Senhora Aparecida'],
    ['11-02', 'Finados'],
    ['11-15', 'Proclamação da República'],
    ['11-20', 'Dia da Consciência Negra'],
    ['12-25', 'Natal'],
  ];
  const mapa = new Map(fixos.map(([md, nome]) => [`${ano}-${md}`, nome]));
  const p = pascoa(ano);
  const sexta = new Date(p); sexta.setDate(p.getDate() - 2);
  mapa.set(chaveDia(sexta), 'Sexta-feira Santa');
  return mapa;
}

// extras: [{ data: 'YYYY-MM-DD', nome: '...' }]
export function montarCalendario(anos, extras = []) {
  const mapa = new Map();
  for (const ano of anos) for (const [k, v] of feriadosDoAno(ano)) mapa.set(k, v);
  for (const f of extras) if (f && f.data) mapa.set(f.data, f.nome || 'Feriado');
  return mapa;
}

// ---------- parsing ----------
const norm = (s) => String(s ?? '')
  .normalize('NFD').replace(/[̀-ͯ]/g, '')
  .toLowerCase().replace(/\s+/g, ' ').trim();

// Cada coluna é achada pelo nome do cabeçalho (não pela posição), então a
// planilha pode ganhar/perder colunas sem quebrar.
const COLUNAS = {
  numero:      (h) => h === '№' || h === 'no' || h === 'n' || h === 'nº' || h === 'n°' || h === '#',
  veiculo:     (h) => h === 'agrupamento' || h === 'veiculo' || h === 'placa' || h === 'unidade',
  motorista:   (h) => h.startsWith('motorista') || h === 'condutor',
  inicio:      (h) => h === 'inicio',
  fim:         (h) => h === 'fim',
  duracao:     (h) => h === 'duracao',
  velMedia:    (h) => h.startsWith('velocidade media'),
  velMax:      (h) => h.startsWith('velocidade maxima'),
  posInicial:  (h) => h === 'posicao inicial',
  posFinal:    (h) => h === 'posicao final',
  coordIni:    (h) => h === 'coordenadas iniciais',
  coordFim:    (h) => h === 'coordenadas finais',
  km:          (h) => h.startsWith('quilometragem') || h === 'km' || h.startsWith('distancia'),
};

function acharCabecalho(linhas) {
  for (let i = 0; i < Math.min(linhas.length, 15); i++) {
    const hs = (linhas[i] || []).map(norm);
    if (hs.some((h) => COLUNAS.inicio(h)) && hs.some((h) => COLUNAS.fim(h))) {
      const idx = {};
      for (const [chave, teste] of Object.entries(COLUNAS)) {
        const j = hs.findIndex((h) => teste(h));
        if (j >= 0) idx[chave] = j;
      }
      // "№" pode vir como símbolo que o norm não reconhece — tenta direto.
      if (idx.numero === undefined) {
        const j = (linhas[i] || []).findIndex((c) => String(c ?? '').trim() === '№');
        if (j >= 0) idx.numero = j;
      }
      return { linhaCabecalho: i, idx };
    }
  }
  return null;
}

// Aceita: Date (Excel), "2026-10-08 19:01:52", "08/10/2026 19:01:52", número serial.
// Tudo vira Date no horário local "de parede" (sem fuso) — é o que a planilha mostra.
export function parseDataHora(v) {
  if (v === null || v === undefined || v === '') return null;
  if (v instanceof Date) {
    // ExcelJS/SheetJS entregam datas do Excel como UTC com o valor "de parede".
    return new Date(v.getUTCFullYear(), v.getUTCMonth(), v.getUTCDate(), v.getUTCHours(), v.getUTCMinutes(), v.getUTCSeconds());
  }
  if (typeof v === 'number') {
    const ms = Math.round((v - 25569) * 86400 * 1000);
    return parseDataHora(new Date(ms));
  }
  const s = String(v).trim();
  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{1,2}):(\d{2})(?::(\d{2}))?/);
  if (m) return new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +(m[6] || 0));
  m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})[ T](\d{1,2}):(\d{2})(?::(\d{2}))?/);
  if (m) return new Date(+m[3], +m[2] - 1, +m[1], +m[4], +m[5], +(m[6] || 0));
  return null;
}

// "0:14:42", "1:01:28", "1d 2:03:04" ou número (fração de dia do Excel) → segundos
export function parseDuracao(v) {
  if (v === null || v === undefined || v === '') return null;
  if (typeof v === 'number') return Math.round(v * 86400);
  if (v instanceof Date) return v.getUTCHours() * 3600 + v.getUTCMinutes() * 60 + v.getUTCSeconds();
  const s = String(v).trim();
  const m = s.match(/^(?:(\d+)\s*d\s*)?(\d+):(\d{2})(?::(\d{2}))?$/);
  if (!m) return null;
  return (+(m[1] || 0)) * 86400 + (+m[2]) * 3600 + (+m[3]) * 60 + (+(m[4] || 0));
}

const parseNum = (v) => {
  if (v === null || v === undefined || v === '') return null;
  if (typeof v === 'number') return v;
  const s = String(v).trim();
  if (!s || /^-+$/.test(s)) return null;
  const n = Number(s.includes(',') && !s.includes('.') ? s.replace(',', '.') : s.replace(/,/g, ''));
  return Number.isFinite(n) ? n : null;
};

const texto = (v) => {
  const s = String(v ?? '').trim();
  return !s || /^-+$/.test(s) ? '' : s;
};

// O relatório do rastreador vem em árvore: "2" (mês) > "2.1" (dia) >
// "2.1.6" (veículo no dia) > "2.1.6.1" (viagem). Os níveis de cima são
// SOMAS dos de baixo — usar só as folhas, senão o km sai dobrado.
function filtrarFolhas(registros) {
  const comNumero = registros.filter((r) => r.numero);
  if (!comNumero.length) return registros;
  const numeros = comNumero.map((r) => r.numero);
  const temFilho = new Set();
  for (const n of numeros) {
    const partes = n.split('.');
    for (let k = 1; k < partes.length; k++) temFilho.add(partes.slice(0, k).join('.'));
  }
  return registros.filter((r) => !r.numero || !temFilho.has(r.numero));
}

export function lerViagens(linhas) {
  const cab = acharCabecalho(linhas);
  if (!cab) throw new Error('Não encontrei o cabeçalho (colunas "Início" e "Fim"). Confira se é o relatório de viagens do rastreador.');
  const { linhaCabecalho, idx } = cab;
  for (const obrig of ['veiculo', 'inicio', 'fim']) {
    if (idx[obrig] === undefined) throw new Error(`Coluna obrigatória não encontrada: ${obrig === 'veiculo' ? 'Agrupamento/Veículo' : obrig}.`);
  }
  const get = (l, k) => (idx[k] === undefined ? null : l[idx[k]]);

  const registros = [];
  for (let i = linhaCabecalho + 1; i < linhas.length; i++) {
    const l = linhas[i] || [];
    const inicio = parseDataHora(get(l, 'inicio'));
    const fim = parseDataHora(get(l, 'fim'));
    if (!inicio || !fim) continue;
    registros.push({
      linha: i + 1,
      numero: texto(get(l, 'numero')),
      veiculo: texto(get(l, 'veiculo')),
      motorista: texto(get(l, 'motorista')),
      inicio, fim,
      duracaoSeg: parseDuracao(get(l, 'duracao')) ?? Math.max(0, Math.round((fim - inicio) / 1000)),
      velMedia: parseNum(get(l, 'velMedia')),
      velMax: parseNum(get(l, 'velMax')),
      origem: texto(get(l, 'posInicial')),
      destino: texto(get(l, 'posFinal')),
      coordIni: texto(get(l, 'coordIni')),
      coordFim: texto(get(l, 'coordFim')),
      km: parseNum(get(l, 'km')) ?? 0,
    });
  }
  // Linhas de agrupamento sem número (ex.: "Dia 8", "Outubro") nunca são viagem.
  const folhas = filtrarFolhas(registros).filter((r) => !/^(dia \d+|janeiro|fevereiro|marco|abril|maio|junho|julho|agosto|setembro|outubro|novembro|dezembro)$/.test(norm(r.veiculo)));
  return { viagens: folhas, totalLinhas: registros.length };
}

// ---------- regra de horário ----------
const DIAS = ['domingo', 'segunda-feira', 'terça-feira', 'quarta-feira', 'quinta-feira', 'sexta-feira', 'sábado'];
export const diaSemana = (d) => DIAS[d.getDay()];

function motivoDoInstante(d, cal, regras) {
  const feriado = cal.get(chaveDia(d));
  if (feriado) return `Feriado (${feriado})`;
  const dow = d.getDay();
  if (dow === 0) return 'Domingo';
  const h = d.getHours();
  if (dow === 6) {
    if (h >= regras.fimSabado) return `Sábado após ${pad2(regras.fimSabado)}h`;
    if (h < regras.inicioExpediente) return `Sábado antes ${pad2(regras.inicioExpediente)}h`;
    return null;
  }
  if (h >= regras.fimExpediente) return `Após ${pad2(regras.fimExpediente)}h`;
  if (h < regras.inicioExpediente) return `Antes ${pad2(regras.inicioExpediente)}h`;
  return null;
}

// Devolve o motivo (texto) se a viagem toca o período fora de horário, senão null.
export function classificar(v, cal, regras = REGRAS_PADRAO) {
  const mIni = motivoDoInstante(v.inicio, cal, regras);
  if (mIni) return mIni;
  const mFim = motivoDoInstante(v.fim, cal, regras);
  if (mFim) return mFim;
  // Começou e terminou dentro do expediente: só pode ter passado por período
  // proibido se atravessou de um dia para outro.
  if (chaveDia(v.inicio) !== chaveDia(v.fim)) return `Após ${pad2(regras.fimExpediente)}h`;
  return null;
}

// ---------- análise ----------
export const NAO_IDENTIFICADO = 'Não identificado';

export function analisar(linhas, opcoes = {}) {
  const { viagens, totalLinhas } = lerViagens(linhas);
  return analisarViagens(viagens, { ...opcoes, totalLinhas });
}

// Mesma análise a partir de viagens já lidas (planilha ou histórico do banco).
export function analisarViagens(viagens, { regras = REGRAS_PADRAO, feriadosExtras = [], totalLinhas = viagens.length } = {}) {
  regras = { ...REGRAS_PADRAO, ...regras };
  const anos = [...new Set(viagens.flatMap((v) => [v.inicio.getFullYear(), v.fim.getFullYear()]))];
  const cal = montarCalendario(anos, feriadosExtras);

  let ignoradasCurtas = 0;
  const fora = [];
  for (const v of viagens) {
    const motivo = classificar(v, cal, regras);
    if (!motivo) continue;
    if ((v.km ?? 0) < regras.kmMinimo) { ignoradasCurtas++; continue; }
    fora.push({ ...v, motivo, motoristaExib: v.motorista || NAO_IDENTIFICADO });
  }
  fora.sort((a, b) => a.inicio - b.inicio);

  const agrupar = (chaveFn) => {
    const m = new Map();
    for (const v of fora) {
      const k = chaveFn(v);
      if (!m.has(k)) m.set(k, { chave: k, viagens: 0, km: 0, duracaoSeg: 0, veiculos: new Set(), motoristas: new Set(), dias: new Set(), primeira: v.inicio, ultima: v.fim, velMaxima: null });
      const g = m.get(k);
      g.viagens++; g.km += v.km || 0; g.duracaoSeg += v.duracaoSeg || 0;
      g.veiculos.add(v.veiculo); g.motoristas.add(v.motoristaExib); g.dias.add(chaveDia(v.inicio));
      if (v.inicio < g.primeira) g.primeira = v.inicio;
      if (v.fim > g.ultima) g.ultima = v.fim;
      if (v.velMax != null) g.velMaxima = Math.max(g.velMaxima ?? 0, v.velMax);
    }
    return [...m.values()]
      .map((g) => ({ ...g, veiculos: [...g.veiculos].sort(), motoristas: [...g.motoristas].sort(), dias: g.dias.size }))
      .sort((a, b) => b.km - a.km);
  };

  // Sem motorista identificado, agrupa por veículo para não juntar
  // pessoas diferentes numa linha só.
  const porMotorista = agrupar((v) => (v.motorista ? v.motorista : `${NAO_IDENTIFICADO} · ${v.veiculo}`));
  const porVeiculo = agrupar((v) => v.veiculo);

  const todas = viagens.length ? viagens : [];
  const periodo = todas.length
    ? { de: new Date(Math.min(...todas.map((v) => v.inicio))), ate: new Date(Math.max(...todas.map((v) => v.fim))) }
    : null;

  const feriadosNoPeriodo = periodo
    ? [...cal.entries()].filter(([k]) => k >= chaveDia(periodo.de) && k <= chaveDia(periodo.ate)).map(([data, nome]) => ({ data, nome }))
    : [];

  return {
    regras,
    periodo,
    feriadosNoPeriodo,
    totais: {
      linhasLidas: totalLinhas,
      viagensNaPlanilha: viagens.length,
      viagensFora: fora.length,
      ignoradasCurtas,
      km: fora.reduce((s, v) => s + (v.km || 0), 0),
      duracaoSeg: fora.reduce((s, v) => s + (v.duracaoSeg || 0), 0),
      veiculos: porVeiculo.length,
      motoristas: new Set(fora.filter((v) => v.motorista).map((v) => v.motorista)).size,
      semMotorista: fora.filter((v) => !v.motorista).length,
    },
    viagens: fora,
    porMotorista,
    porVeiculo,
  };
}

// ---------- formatação compartilhada ----------
export function fmtDuracao(seg) {
  if (seg == null) return '—';
  const h = Math.floor(seg / 3600), m = Math.floor((seg % 3600) / 60);
  return `${h}h${pad2(m)}`;
}
export const fmtData = (d) => `${pad2(d.getDate())}/${pad2(d.getMonth() + 1)}/${d.getFullYear()}`;
export const fmtHora = (d) => `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
export const fmtDataHora = (d) => `${fmtData(d)} ${fmtHora(d)}`;

export function linkMapa(coord) {
  const m = String(coord || '').match(/(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)/);
  return m ? `https://www.google.com/maps?q=${m[1]},${m[2]}` : '';
}
export function linkTrajeto(ini, fim) {
  const a = String(ini || '').match(/(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)/);
  const b = String(fim || '').match(/(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)/);
  if (!a || !b) return linkMapa(ini);
  return `https://www.google.com/maps/dir/${a[1]},${a[2]}/${b[1]},${b[2]}`;
}
