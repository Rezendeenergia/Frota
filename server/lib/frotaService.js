// Dados da frota: lê a planilha de veículos do SharePoint e agrega os dados
// de abastecimento para alimentar a página /frota.
//
// Variáveis esperadas (mesmas já configuradas no Render para o painel TV):
//   VEICULOS_SHARE_URL  — URL de compartilhamento do SharePoint da planilha
//                         "Veículos_Rezende.xlsx" (sem ela, retorna lista vazia)
//   ABASTECIMENTO_API_URL / ABASTECIMENTO_API_KEY — já usadas pelo painel TV

import { fetchAbastecimento } from './abastecimentoService.js';

const SHARE_URL = process.env.VEICULOS_SHARE_URL || '';

// Cache em memória: a planilha de veículos muda pouco; recarrega a cada 30 min.
const CACHE_TTL_MS = 30 * 60 * 1000;
let cacheVeiculos = null;
let cacheVeiculosAt = 0;

// --------------------------------------------------------------------------
// Leitura da planilha
// --------------------------------------------------------------------------

function normalizar(v) {
  return String(v ?? '').trim();
}

function parseMoeda(v) {
  if (v == null || v === '' || v === '#N/A') return null;
  const n = typeof v === 'number' ? v : parseFloat(String(v).replace(/[^\d,.]/g, '').replace(',', '.'));
  return isNaN(n) ? null : n;
}

/**
 * Converte uma linha da aba "Locados" em objeto estruturado.
 * Colunas: PLACA · MARCA · MODELO · TIPO · ANO · MODELO_ANO · RENAVAM · CHASSI · COR · COMBUSTIVEL · TANQUE · MD_KM · PROPRIEDADE · LOCADORA · VALOR_LOCACAO
 */
function parseLocado(row) {
  const [placa, marca, modelo, tipo, ano, , , , , combustivel, , , , locadora, valorRaw] = row;
  const valor = parseMoeda(valorRaw);
  if (!normalizar(placa)) return null;
  return {
    placa: normalizar(placa),
    marca: normalizar(marca),
    modelo: normalizar(modelo),
    tipo: normalizar(tipo),
    ano: normalizar(ano),
    combustivel: normalizar(combustivel),
    locadora: normalizar(locadora),
    valorMensal: valor,
    propriedade: 'LOCADO',
  };
}

/**
 * Converte uma linha da aba "Próprios".
 * Colunas: PLACA · MARCA · MODELO · TIPO · ANO · MODELO_ANO · PROPRIEDADE · VALOR_NF · CHASSI · NOME_CRLV · OBS
 */
function parseProprio(row) {
  const [placa, marca, modelo, tipo, ano, , , valorNfRaw, , , obs] = row;
  if (!normalizar(placa)) return null;
  return {
    placa: normalizar(placa),
    marca: normalizar(marca),
    modelo: normalizar(modelo),
    tipo: normalizar(tipo),
    ano: normalizar(ano),
    valorPatrimonio: parseMoeda(valorNfRaw),
    obs: normalizar(obs),
    propriedade: 'PRÓPRIO',
  };
}

function lerAba(wb, nomeAba) {
  const idx = wb.SheetNames.findIndex((n) => n.trim().toLowerCase() === nomeAba.toLowerCase());
  if (idx < 0) return [];
  const ws = wb.Sheets[wb.SheetNames[idx]];
  // Importa xlsx dinamicamente
  return ws;
}

async function lerPlanilhaVeiculos() {
  if (!SHARE_URL) return { locados: [], proprios: [], erro: 'VEICULOS_SHARE_URL não configurada.' };

  try {
    const { downloadWorkbookByShareUrl } = await import('./sharepoint.js');
    const buffer = await downloadWorkbookByShareUrl(SHARE_URL);

    // Usa xlsx (já dependência do projeto via xlsx-mini no frontend, mas no server usamos a lib diretamente)
    const { read, utils } = await import('xlsx');
    const wb = read(buffer, { type: 'buffer' });

    const locados = [];
    const proprios = [];

    // Aba "Locados"
    const nomeLocados = wb.SheetNames.find((n) => /locados/i.test(n));
    if (nomeLocados) {
      const rows = utils.sheet_to_json(wb.Sheets[nomeLocados], { header: 1, defval: null });
      // pula cabeçalho (linha 0) e linha em branco de totais
      for (let i = 1; i < rows.length; i++) {
        const v = parseLocado(rows[i]);
        if (v) locados.push(v);
      }
    }

    // Aba "Próprios"
    const nomeProprios = wb.SheetNames.find((n) => /pr.prios/i.test(n));
    if (nomeProprios) {
      const rows = utils.sheet_to_json(wb.Sheets[nomeProprios], { header: 1, defval: null });
      for (let i = 1; i < rows.length; i++) {
        const v = parseProprio(rows[i]);
        if (v) proprios.push(v);
      }
    }

    return { locados, proprios, erro: null };
  } catch (err) {
    console.error('[frota] planilha veículos:', err?.message || err);
    return { locados: [], proprios: [], erro: `Não foi possível carregar a planilha de veículos: ${err?.message || err}` };
  }
}

async function getVeiculos() {
  const agora = Date.now();
  if (cacheVeiculos && agora - cacheVeiculosAt < CACHE_TTL_MS) return cacheVeiculos;
  const dados = await lerPlanilhaVeiculos();
  cacheVeiculos = dados;
  cacheVeiculosAt = agora;
  return dados;
}

// --------------------------------------------------------------------------
// Agregações para indicadores
// --------------------------------------------------------------------------

function agrupar(lista, campo) {
  const acc = {};
  for (const v of lista) {
    const k = v[campo] || 'Outros';
    acc[k] = (acc[k] || 0) + 1;
  }
  return Object.entries(acc)
    .sort((a, b) => b[1] - a[1])
    .map(([chave, qtd]) => ({ chave, qtd }));
}

function somarValor(lista, campo) {
  return lista.reduce((s, v) => s + (v[campo] ?? 0), 0);
}

// --------------------------------------------------------------------------
// Ponto de entrada principal
// --------------------------------------------------------------------------

export async function fetchFrota(periodo = '30dias') {
  const [veiculos, abastecimento] = await Promise.all([
    getVeiculos(),
    fetchAbastecimento(periodo).catch((err) => ({ disponivel: false, motivo: String(err?.message || err) })),
  ]);

  const { locados, proprios, erro: erroVeiculos } = veiculos;
  const todos = [...locados, ...proprios];

  // Totais de locação
  const custoLocacaoMensal = somarValor(locados, 'valorMensal');
  const valorImobilizado = somarValor(proprios, 'valorPatrimonio');

  // Agrupamentos para indicadores
  const porTipo = agrupar(todos, 'tipo');
  const porLocadora = agrupar(locados, 'locadora');
  const porTipoLocado = agrupar(locados, 'tipo');
  const porTipoProprio = agrupar(proprios, 'tipo');

  return {
    geradoEm: new Date().toISOString(),
    erroVeiculos,
    indicadores: {
      totalVeiculos: todos.length,
      totalLocados: locados.length,
      totalProprios: proprios.length,
      custoLocacaoMensal,
      valorImobilizado,
      porTipo,
      porLocadora,
      porTipoLocado,
      porTipoProprio,
    },
    locacao: {
      veiculos: locados,
      custoTotal: custoLocacaoMensal,
    },
    abastecimento,
  };
}
