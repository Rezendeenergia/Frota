import * as XLSX from 'xlsx';
import { parseMoneyBR, parseDateBR, diffDays, normalizeHeader } from './formatters.js';
// sharepoint.js é importado dinamicamente dentro de fetchManutencao() —
// assim este módulo (e o parsing/cálculo em computeFromBuffer) pode ser
// testado com um arquivo local, sem precisar das credenciais do Graph.

const FILENAME = 'MANUTENÇÕES REZENDE ENERGIA.xlsx';
const SHEET_NAME = 'Planilha1'; // aba com custo consolidado por OS

// Nomes de coluna como aparecem hoje na planilha (ver normalizeHeader) ->
// chave interna que usamos daqui pra frente. Casar por nome (não por
// índice) é o que deixa isso resistente a alguém reordenar colunas no
// SharePoint.
const COLUMN_MAP = {
  'PLACA': 'placa',
  'MODELO': 'modelo',
  'KM': 'km',
  'DATA DA PARADA': 'dataParada',
  'DATA DA APROVACAO': 'dataAprovacao',
  'DATA DA SAIDA': 'dataSaida',
  'OFICINA': 'oficina',
  'TIPO DE MANUTENCAO': 'tipo',
  'DESCRICAO DO ITEM': 'descricao',
  'VALOR PECA': 'valorPeca',
  'VALOR MAO DE SERVICO': 'valorMaoDeObra',
  'R$ FINAL': 'valorFinal',
  'STATUS': 'status',
  'OBSERVACAO': 'observacao',
};

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
    // Linha em branco de verdade (sem placa) — pula.
    if (!record.placa) continue;
    rows.push(record);
  }
  return rows;
}

function buildOrdem(raw) {
  const dataParada = parseDateBR(raw.dataParada);
  const dataSaida = parseDateBR(raw.dataSaida);
  const valorPeca = parseMoneyBR(raw.valorPeca);
  const valorMaoDeObra = parseMoneyBR(raw.valorMaoDeObra);
  const valorFinal = parseMoneyBR(raw.valorFinal);
  const status = String(raw.status ?? '').trim();
  const tipo = String(raw.tipo ?? '').trim().toUpperCase();

  return {
    placa: String(raw.placa ?? '').trim(),
    modelo: String(raw.modelo ?? '').trim(),
    oficina: String(raw.oficina ?? '').trim(),
    tipo: tipo || null, // PREVENTIVA | CORRETIVA
    descricao: raw.descricao ? String(raw.descricao).trim() : null,
    status: status || null,
    dataParada: dataParada ? dataParada.toISOString().slice(0, 10) : null,
    dataSaida: dataSaida ? dataSaida.toISOString().slice(0, 10) : null,
    diasParado: diffDays(dataParada, dataSaida),
    valorPeca,
    valorMaoDeObra,
    // custo "confirmado" da OS: usa R$ FINAL se preenchido, senão soma
    // peça+mão de obra quando ambos existem; senão fica pendente (null).
    custoConfirmado:
      valorFinal ?? (valorPeca !== null && valorMaoDeObra !== null ? valorPeca + valorMaoDeObra : null),
    custoPendenteEstimado: valorFinal === null ? valorPeca ?? valorMaoDeObra ?? null : null,
  };
}

function sum(arr) {
  return arr.reduce((acc, n) => acc + (n ?? 0), 0);
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
// buffer local (sem precisar autenticar no Graph) — ver server/test/.
export function computeFromBuffer(buffer) {
  const workbook = XLSX.read(buffer, { type: 'array', cellDates: true });
  const raw = rowsFromSheet(workbook, SHEET_NAME);
  const ordens = raw.map(buildOrdem);

  const confirmadas = ordens.filter((o) => o.custoConfirmado !== null);
  const pendentes = ordens.filter((o) => o.custoConfirmado === null);
  const diasValidos = ordens.map((o) => o.diasParado).filter((d) => d !== null && d >= 0);

  const preventivas = ordens.filter((o) => o.tipo === 'PREVENTIVA');
  const corretivas = ordens.filter((o) => o.tipo === 'CORRETIVA');

  return {
    geradoEm: new Date().toISOString(),
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

export async function fetchManutencao() {
  const { downloadWorkbookByName } = await import('./sharepoint.js');
  const buffer = await downloadWorkbookByName(FILENAME);
  return computeFromBuffer(buffer);
}
