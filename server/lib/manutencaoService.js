import * as XLSX from 'xlsx';
import { parseMoneyBR, parseDateBR, diffDays, normalizeHeader } from './formatters.js';
// sharepoint.js é importado dinamicamente dentro de fetchManutencao() —
// assim este módulo (e o parsing/cálculo em computeFromBuffer) pode ser
// testado com um arquivo local, sem precisar das credenciais do Graph.

const FILENAME = 'MANUTENÇÕES REZENDE ENERGIA.xlsx';
// Trocado de 'Planilha1' (consolidada, 1 linha por OS) para 'Planilha2'
// (detalhada, 1 linha por ITEM — peça ou serviço — dentro de cada OS).
// Por isso o parsing abaixo tem uma etapa extra que a Planilha1 não
// precisava: agrupar as linhas por Nº PEDIDO antes de calcular os KPIs
// (ver groupByPedido / buildOrdemFromGrupo).
const SHEET_NAME = 'Planilha2';

// Nomes de coluna como aparecem hoje na Planilha2 (ver normalizeHeader) ->
// chave interna que usamos daqui pra frente. Casar por nome (não por
// índice) é o que deixa isso resistente a alguém reordenar colunas no
// SharePoint. 'N° PEDIDO' aparece com dois símbolos diferentes dependendo
// de como foi digitado na planilha (° grau ou º ordinal) — mapeamos os dois.
const COLUMN_MAP = {
  'N° PEDIDO': 'pedido',
  'Nº PEDIDO': 'pedido',
  'EQUIPE': 'equipe',
  'PLACA': 'placa',
  'MODELO': 'modelo',
  'KM': 'km',
  'DATA DA PARADA': 'dataParada',
  'DATA DA APROVACAO': 'dataAprovacao',
  'DATA DA SAIDA': 'dataSaida',
  'OFICINA': 'oficina',
  'TIPO DE MANUTENCAO': 'tipoManutencao', // PREVENTIVA | CORRETIVA (por item)
  'TIPO': 'tipoItem', // PEÇA | SERVIÇO (não confundir com tipoManutencao acima)
  'QTD': 'qtd',
  'DESCRICAO DO ITEM': 'descricaoItem',
  'VALOR UNITARIO': 'valorUnitario',
  'VALOR TOTAL': 'valorTotalItem',
  'STATUS': 'status',
  'OBSERVACAO': 'observacao',
};

// Status que indicam que o valor ainda não está fechado (orçamento/cotação
// em aberto) — mesmo critério que a Planilha1 usava para separar custo
// confirmado de custo pendente estimado.
const STATUS_PENDENTES = new Set(['EM ORCAMENTO', 'COTACAO']);

function rowsFromSheet(workbook, sheetName) {
  const sheet = workbook.Sheets[sheetName];
  if (!sheet) {
    throw new Error(`Aba '${sheetName}' não encontrada em ${FILENAME}. Abas disponíveis: ${workbook.SheetNames.join(', ')}`);
  }
  // raw:true (padrão) devolve o valor tipado da célula — number puro para
  // colunas numéricas com formato de moeda aplicado, Date para datas (com
  // cellDates:true), ou a string exata quando a célula é texto livre (caso
  // comum aqui, já que muita gente digita "R$ 800,00" direto como texto).
  // parseMoneyBR/parseDateBR tratam os três casos.
  const raw = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: null });
  if (raw.length < 2) return [];

  const headerRow = raw[0].map((h) => normalizeHeader(h));
  const keyByCol = headerRow.map((h) => COLUMN_MAP[h] ?? null);

  const rows = [];
  for (let i = 1; i < raw.length; i += 1) {
    const line = raw[i];
    if (!line || line.every((c) => c === null || c === '')) continue;
    const record = {};
    keyByCol.forEach((key, col) => {
      if (key) record[key] = line[col];
    });
    // Linha em branco de verdade (sem placa e sem pedido) — pula. A
    // Planilha2 tem algumas linhas totalmente vazias entre pedidos.
    if (!record.placa && !record.pedido) continue;
    rows.push(record);
  }
  return rows;
}

// Agrupa as linhas de item pelo Nº PEDIDO, preservando a ordem de
// primeira aparição (mesma ordem da planilha).
function groupByPedido(rows) {
  const order = [];
  const map = new Map();
  for (const row of rows) {
    const key = String(row.pedido ?? '').trim() || `__sem_pedido_${order.length}`;
    if (!map.has(key)) {
      map.set(key, []);
      order.push(key);
    }
    map.get(key).push(row);
  }
  return order.map((key) => map.get(key));
}

// Primeiro valor não-nulo/vazio de um campo dentro do grupo — usado para
// campos que descrevem a OS como um todo (placa, oficina, datas) e que
// vêm repetidos em toda linha de item do mesmo pedido.
function firstNonEmpty(grupo, field) {
  for (const row of grupo) {
    const v = row[field];
    if (v !== null && v !== undefined && String(v).trim() !== '') return v;
  }
  return null;
}

// Valor mais frequente de um campo dentro do grupo (empate resolvido pela
// primeira ocorrência). Usado para STATUS, que na Planilha2 vem repetido
// em cada linha de item — normalmente idêntico, mas por segurança pegamos
// a moda em vez de simplesmente a primeira linha.
function mostCommon(grupo, field) {
  const counts = new Map();
  for (const row of grupo) {
    const v = row[field] ? String(row[field]).trim() : null;
    if (!v) continue;
    counts.set(v, (counts.get(v) ?? 0) + 1);
  }
  let best = null;
  let bestCount = 0;
  for (const [v, c] of counts) {
    if (c > bestCount) {
      best = v;
      bestCount = c;
    }
  }
  return best;
}

function buildOrdemFromGrupo(grupo) {
  const dataParada = parseDateBR(firstNonEmpty(grupo, 'dataParada'));
  const dataSaida = parseDateBR(firstNonEmpty(grupo, 'dataSaida'));
  const status = mostCommon(grupo, 'status');
  const statusNormalizado = normalizeHeader(status ?? '');

  // Tipo de manutenção da OS: a Planilha2 permite itens preventivos e
  // corretivos misturados no mesmo pedido (ex.: revisão preventiva que
  // aproveitou pra trocar uma peça quebrada). Classificamos a OS como
  // CORRETIVA se qualquer item dela for corretivo — senão, PREVENTIVA.
  const tiposManutencao = grupo
    .map((r) => String(r.tipoManutencao ?? '').trim().toUpperCase())
    .filter(Boolean);
  const tipo = tiposManutencao.includes('CORRETIVA')
    ? 'CORRETIVA'
    : tiposManutencao.includes('PREVENTIVA')
    ? 'PREVENTIVA'
    : null;

  // Custo da OS = soma do VALOR TOTAL de todos os itens do pedido.
  const valorTotalPedido = grupo.reduce((acc, r) => {
    const v = parseMoneyBR(r.valorTotalItem);
    return acc + (v ?? 0);
  }, 0);
  const temAlgumValor = grupo.some((r) => parseMoneyBR(r.valorTotalItem) !== null);
  const pendente = STATUS_PENDENTES.has(statusNormalizado);

  return {
    pedido: String(grupo[0]?.pedido ?? '').trim() || null,
    placa: String(firstNonEmpty(grupo, 'placa') ?? '').trim(),
    modelo: String(firstNonEmpty(grupo, 'modelo') ?? '').trim(),
    oficina: String(firstNonEmpty(grupo, 'oficina') ?? '').trim(),
    tipo, // PREVENTIVA | CORRETIVA
    status: status || null,
    dataParada: dataParada ? dataParada.toISOString().slice(0, 10) : null,
    dataSaida: dataSaida ? dataSaida.toISOString().slice(0, 10) : null,
    diasParado: diffDays(dataParada, dataSaida),
    // custo "confirmado" da OS: soma dos itens, exceto quando o status
    // ainda é de orçamento/cotação em aberto — nesse caso o valor (se
    // houver) é só estimativa e vai para custoPendenteEstimado.
    custoConfirmado: temAlgumValor && !pendente ? valorTotalPedido : null,
    custoPendenteEstimado: temAlgumValor && pendente ? valorTotalPedido : null,
    itens: grupo.map((r) => ({
      descricao: r.descricaoItem ? String(r.descricaoItem).trim() : null,
      tipoItem: r.tipoItem ? String(r.tipoItem).trim() : null, // PEÇA | SERVIÇO
      qtd: r.qtd ?? null,
      valorUnitario: parseMoneyBR(r.valorUnitario),
      valorTotal: parseMoneyBR(r.valorTotalItem),
    })),
  };
}

function sum(arr) {
  return arr.reduce((acc, n) => acc + (n ?? 0), 0);
}

// ── Presets do filtro de período do painel da TV ─────────────────────────────
// 'hoje' | '7dias' | '30dias' | 'mes' — mesmas 4 opções que aparecem como
// botões na tela (ver public/app.js) e mesmo critério usado no sistema de
// abastecimento (repositório Abast, backend/server.js: periodoParaIntervalo),
// só que em JS puro (aqui não há banco — os dados vêm da planilha inteira já
// em memória).
function periodoParaIntervalo(periodo) {
  const hoje = new Date();
  const fmt = (d) => d.toISOString().slice(0, 10);
  const fim = fmt(hoje);
  let inicio;
  let label;
  switch (periodo) {
    case 'hoje':
      inicio = fim;
      label = 'hoje';
      break;
    case '30dias':
      inicio = fmt(new Date(hoje.getTime() - 29 * 86400000));
      label = 'últimos 30 dias';
      break;
    case 'mes':
      inicio = fmt(new Date(hoje.getFullYear(), hoje.getMonth(), 1));
      label = 'este mês';
      break;
    case '7dias':
    default:
      inicio = fmt(new Date(hoje.getTime() - 6 * 86400000));
      label = 'últimos 7 dias';
      break;
  }
  return { inicio, fim, label };
}

// Filtra as ordens pela janela [inicio, fim], usando a data da parada como
// referência (ou a data de saída, se a parada não tiver sido preenchida na
// planilha) — mesma lógica do `date::date BETWEEN` usado no lado do
// abastecimento. Ordem sem nenhuma das duas datas fica fora do período (não
// dá pra saber quando ela aconteceu).
function filtrarPorPeriodo(ordens, periodo) {
  const { inicio, fim, label } = periodoParaIntervalo(periodo);
  const filtradas = ordens.filter((o) => {
    const data = o.dataParada || o.dataSaida;
    if (!data) return false;
    return data >= inicio && data <= fim;
  });
  return { filtradas, label };
}

function groupSumCount(ordens, keyFn) {
  const map = new Map();
  for (const o of ordens) {
    const key = keyFn(o);
    if (!key) continue;
    const cur = map.get(key) ?? { chave: key, qtd: 0, custo: 0 };
    cur.qtd += 1;
    cur.custo += o.custoConfirmado ?? 0;
    map.set(key, cur);
  }
  return [...map.values()].sort((a, b) => b.custo - a.custo);
}

// Separado de fetchManutencao() para poder testar o parsing/cálculo com um
// buffer local (sem precisar autenticar no Graph) — ver server/test-run.mjs.
// `periodo`: 'hoje' | '7dias' | '30dias' | 'mes' — vem do filtro clicável na
// tela (ver public/app.js), repassado por fetchManutencao/server/index.js.
export function computeFromBuffer(buffer, periodo = '7dias') {
  const workbook = XLSX.read(buffer, { type: 'array', cellDates: true });
  const raw = rowsFromSheet(workbook, SHEET_NAME);
  const grupos = groupByPedido(raw);
  const todasOrdens = grupos.map(buildOrdemFromGrupo);
  const { filtradas: ordens, label: periodoLabel } = filtrarPorPeriodo(todasOrdens, periodo);

  const confirmadas = ordens.filter((o) => o.custoConfirmado !== null);
  const pendentes = ordens.filter((o) => o.custoConfirmado === null);
  const diasValidos = ordens.map((o) => o.diasParado).filter((d) => d !== null && d >= 0);

  const preventivas = ordens.filter((o) => o.tipo === 'PREVENTIVA');
  const corretivas = ordens.filter((o) => o.tipo === 'CORRETIVA');

  return {
    geradoEm: new Date().toISOString(),
    periodo: periodoLabel,
    totalOrdens: ordens.length,
    custoConfirmado: sum(confirmadas.map((o) => o.custoConfirmado)),
    custoPendenteEstimado: sum(pendentes.map((o) => o.custoPendenteEstimado)),
    qtdPendentes: pendentes.length,
    tempoMedioParadoDias: diasValidos.length ? sum(diasValidos) / diasValidos.length : null,
    tempoMaxParadoDias: diasValidos.length ? Math.max(...diasValidos) : null,
    percentualPreventiva: ordens.length ? Math.round((preventivas.length / ordens.length) * 100) : null,
    percentualCorretiva: ordens.length ? Math.round((corretivas.length / ordens.length) * 100) : null,
    porTipo: [
      { chave: 'Preventiva', qtd: preventivas.length, custo: sum(preventivas.map((o) => o.custoConfirmado)) },
      { chave: 'Corretiva', qtd: corretivas.length, custo: sum(corretivas.map((o) => o.custoConfirmado)) },
    ],
    porOficina: groupSumCount(ordens, (o) => o.oficina || null),
    porVeiculo: groupSumCount(ordens, (o) => (o.placa ? `${o.placa} · ${o.modelo}` : null)),
    porStatus: [...ordens.reduce((map, o) => {
      const key = o.status || 'Sem status';
      map.set(key, (map.get(key) ?? 0) + 1);
      return map;
    }, new Map())].map(([status, qtd]) => ({ status, qtd })),
    ordens,
  };
}

export async function fetchManutencao(periodo = '7dias') {
  const { downloadWorkbookByName } = await import('./sharepoint.js');
  const buffer = await downloadWorkbookByName(FILENAME);
  return computeFromBuffer(buffer, periodo);
}
