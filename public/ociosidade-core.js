// Análise "motor ligado parado" (ociosidade) a partir do relatório do rastreador.
// Módulo puro: roda no navegador e no Node (testes).
//
// O relatório vem em árvore: linha-resumo do veículo no mês > "Dia N" >
// trechos. Só os TRECHOS são usados (os outros níveis são somas). Em cada
// trecho, "Ocioso" = tempo com motor ligado e veículo parado, somado dentro
// do trecho (o relatório não separa parada a parada).
//
// Regra (out/2026): alerta quando o trecho tem mais de 5 min de motor ligado
// parado. Litros estimados = horas ociosas dos alertas × L/h configurado;
// R$ = litros × preço médio pago no período (sistema de abastecimento).

import { parseDataHora, chaveDia, NAO_IDENTIFICADO } from './fora-horario-core.js';

export const PADRAO_OCIOSIDADE = { limiteMin: 5, litrosHora: 0.8 };

const norm = (s) => String(s ?? '')
  .normalize('NFD').replace(/[̀-ͯ]/g, '')
  .toLowerCase().replace(/\s+/g, ' ').trim();

// "0:14:42", "2 dias 21:18:36", "1 dia 0:00:05", número (fração de dia) → segundos
export function parseTempo(v) {
  if (v === null || v === undefined || v === '') return null;
  if (typeof v === 'number') return Math.round(v * 86400);
  const s = String(v).trim();
  if (/^-+$/.test(s)) return null;
  const m = s.match(/^(?:(\d+)\s*(?:dias?|d)\s*)?(\d+):(\d{2})(?::(\d{2}))?$/i);
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

const COLUNAS = {
  numero:     (h) => h === '№' || h === 'n' || h === 'nº' || h === 'n°' || h === '#',
  veiculo:    (h) => h === 'agrupamento' || h === 'veiculo' || h === 'placa' || h === 'unidade',
  inicio:     (h) => h === 'inicio',
  movimento:  (h) => h === 'em movimento',
  motor:      (h) => h === 'horas de motor',
  ocioso:     (h) => h === 'ocioso' || h.startsWith('ocioso'),
  fim:        (h) => h === 'fim',
  posInicial: (h) => h === 'posicao inicial',
  posFinal:   (h) => h === 'posicao final',
  motorista:  (h) => h.startsWith('motorista') || h === 'condutor',
  odoIni:     (h) => h === 'quilometragem inicial',
  odoFim:     (h) => h === 'quilometragem final',
  desloc:     (h) => h === 'deslocamento' || h.startsWith('deslocamento'),
};

// Diz se a planilha é um relatório de ociosidade (tem a coluna "Ocioso").
export function ehRelatorioOciosidade(linhas) {
  for (let i = 0; i < Math.min(linhas.length, 15); i++) {
    const hs = (linhas[i] || []).map(norm);
    if (hs.some((h) => COLUNAS.ocioso(h)) && hs.some((h) => h === 'inicio')) return true;
  }
  return false;
}

export function lerOciosidade(linhas) {
  let cab = -1, idx = {};
  for (let i = 0; i < Math.min(linhas.length, 15); i++) {
    const hs = (linhas[i] || []).map(norm);
    if (hs.some((h) => COLUNAS.ocioso(h)) && hs.some((h) => h === 'inicio')) {
      cab = i;
      for (const [k, t] of Object.entries(COLUNAS)) {
        const j = hs.findIndex((h) => t(h));
        if (j >= 0) idx[k] = j;
      }
      if (idx.numero === undefined) {
        const j = (linhas[i] || []).findIndex((c) => String(c ?? '').trim() === '№');
        if (j >= 0) idx.numero = j;
      }
      break;
    }
  }
  if (cab < 0) throw new Error('Não encontrei a coluna "Ocioso". Confira se é o relatório de motor ligado parado.');
  for (const k of ['veiculo', 'inicio', 'fim', 'ocioso']) {
    if (idx[k] === undefined) throw new Error(`Coluna obrigatória não encontrada: ${k}.`);
  }
  const get = (l, k) => (idx[k] === undefined ? null : l[idx[k]]);

  const brutas = [];
  for (let i = cab + 1; i < linhas.length; i++) {
    const l = linhas[i] || [];
    const veiculo = texto(get(l, 'veiculo'));
    const inicio = parseDataHora(get(l, 'inicio'));
    const fim = parseDataHora(get(l, 'fim'));
    if (!veiculo || !inicio || !fim) continue;
    brutas.push({
      numero: texto(get(l, 'numero')),
      veiculo, inicio, fim,
      motorista: texto(get(l, 'motorista')),
      movimentoSeg: parseTempo(get(l, 'movimento')),
      motorSeg: parseTempo(get(l, 'motor')),
      ociosoSeg: parseTempo(get(l, 'ocioso')) ?? 0,
      origem: texto(get(l, 'posInicial')),
      destino: texto(get(l, 'posFinal')),
      odometroIni: parseNum(get(l, 'odoIni')),
      odometroFim: parseNum(get(l, 'odoFim')),
      deslocamentoKm: parseNum(get(l, 'desloc')),
    });
  }

  let trechos;
  if (brutas.some((r) => r.numero)) {
    // Com numeração hierárquica: só as folhas.
    const temFilho = new Set();
    for (const r of brutas) {
      const p = r.numero.split('.');
      for (let k = 1; k < p.length; k++) temFilho.add(p.slice(0, k).join('.'));
    }
    trechos = brutas.filter((r) => !temFilho.has(r.numero));
  } else {
    // Sem numeração: descarta "Dia N", "Total" e a linha-resumo do veículo
    // (a que vem logo antes do 1º "Dia N" do bloco e começa no mesmo instante).
    trechos = [];
    for (let i = 0; i < brutas.length; i++) {
      const r = brutas[i];
      const nv = norm(r.veiculo);
      if (/^dia \d+$/.test(nv) || nv === 'total') continue;
      const prox = brutas[i + 1];
      const ant = brutas[i - 1];
      const ehResumo = prox && /^dia \d+$/.test(norm(prox.veiculo)) && +prox.inicio === +r.inicio
        && (!ant || norm(ant.veiculo) !== nv);
      if (ehResumo) continue;
      trechos.push(r);
    }
  }
  trechos.forEach((t) => { delete t.numero; });
  return { trechos, totalLinhas: brutas.length };
}

// precos: retorno de /api/rast/precos → { precos: { diesel:{preco,fonte}, gasolina:{...} }, veiculos: { PLACA: 'diesel'|'gasolina' } }
export function precoDoVeiculo(veiculo, precos) {
  const tipo = precos?.veiculos?.[String(veiculo).toUpperCase()];
  const p = precos?.precos || {};
  if (tipo && p[tipo]?.preco) return { preco: Number(p[tipo].preco), tipo, estimado: false };
  const vals = ['diesel', 'gasolina'].map((t) => Number(p[t]?.preco)).filter((x) => x > 0);
  if (!vals.length) return { preco: null, tipo: null, estimado: true };
  return { preco: vals.reduce((a, b) => a + b, 0) / vals.length, tipo: null, estimado: true };
}

export function analisarOciosidade(trechos, { limiteMin = PADRAO_OCIOSIDADE.limiteMin, litrosHora = PADRAO_OCIOSIDADE.litrosHora, precos = null, totalLinhas = trechos.length } = {}) {
  const limiteSeg = limiteMin * 60;
  const alertas = [];
  for (const t of trechos) {
    if ((t.ociosoSeg || 0) <= limiteSeg) continue;
    const p = precoDoVeiculo(t.veiculo, precos);
    const litros = (t.ociosoSeg / 3600) * litrosHora;
    alertas.push({
      ...t,
      motoristaExib: t.motorista || NAO_IDENTIFICADO,
      litros,
      custo: p.preco != null ? litros * p.preco : null,
      precoLitro: p.preco, combustivel: p.tipo, precoEstimado: p.estimado,
    });
  }
  alertas.sort((a, b) => a.inicio - b.inicio);

  const agrupar = (lista, chaveFn, comTodos) => {
    const m = new Map();
    const pegar = (k) => {
      if (!m.has(k)) m.set(k, { chave: k, trechos: 0, alertas: 0, motorSeg: 0, ociosoTotalSeg: 0, ociosoAlertaSeg: 0, maiorAlertaSeg: 0, litros: 0, custo: 0, custoIncompleto: false, precoEstimado: false, veiculos: new Set(), motoristas: new Set(), dias: new Set() });
      return m.get(k);
    };
    if (comTodos) {
      for (const t of trechos) {
        const g = pegar(chaveFn(t));
        g.trechos++; g.motorSeg += t.motorSeg || 0; g.ociosoTotalSeg += t.ociosoSeg || 0;
      }
    }
    for (const a of lista) {
      const g = pegar(chaveFn(a));
      g.alertas++; g.ociosoAlertaSeg += a.ociosoSeg; g.maiorAlertaSeg = Math.max(g.maiorAlertaSeg, a.ociosoSeg);
      g.litros += a.litros;
      if (a.custo != null) g.custo += a.custo; else g.custoIncompleto = true;
      if (a.precoEstimado) g.precoEstimado = true;
      g.veiculos.add(a.veiculo); g.motoristas.add(a.motoristaExib); g.dias.add(chaveDia(a.inicio));
    }
    return [...m.values()]
      .filter((g) => g.alertas > 0)
      .map((g) => ({ ...g, veiculos: [...g.veiculos].sort(), motoristas: [...g.motoristas].sort(), dias: g.dias.size, pctOcioso: g.motorSeg ? g.ociosoTotalSeg / g.motorSeg : null }))
      .sort((a, b) => b.ociosoAlertaSeg - a.ociosoAlertaSeg);
  };

  const chaveMot = (t) => (t.motorista ? t.motorista : `${NAO_IDENTIFICADO} · ${t.veiculo}`);
  const porVeiculo = agrupar(alertas, (t) => t.veiculo, true);
  const porMotorista = agrupar(alertas, chaveMot, true);

  const periodo = trechos.length
    ? { de: new Date(Math.min(...trechos.map((t) => t.inicio))), ate: new Date(Math.max(...trechos.map((t) => t.fim))) }
    : null;
  const soma = (lista, f) => lista.reduce((s, x) => s + (f(x) || 0), 0);

  return {
    parametros: { limiteMin, litrosHora },
    precos: precos?.precos || null,
    periodo,
    totais: {
      linhasLidas: totalLinhas,
      trechos: trechos.length,
      veiculosNoRelatorio: new Set(trechos.map((t) => t.veiculo)).size,
      alertas: alertas.length,
      motorSeg: soma(trechos, (t) => t.motorSeg),
      ociosoTotalSeg: soma(trechos, (t) => t.ociosoSeg),
      ociosoAlertaSeg: soma(alertas, (a) => a.ociosoSeg),
      litros: soma(alertas, (a) => a.litros),
      custo: soma(alertas, (a) => a.custo),
      custoIncompleto: alertas.some((a) => a.custo == null),
      veiculos: porVeiculo.length,
      motoristas: new Set(alertas.filter((a) => a.motorista).map((a) => a.motorista)).size,
      alertasSemMotorista: alertas.filter((a) => !a.motorista).length,
      ociosoSemMotoristaSeg: soma(alertas.filter((a) => !a.motorista), (a) => a.ociosoSeg),
    },
    alertas,
    porVeiculo,
    porMotorista,
  };
}
