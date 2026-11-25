// Medição do posto: lê o borderô do posto (PDF com texto) e compara, linha a
// linha, com as requisições do sistema de abastecimento (tabela `requests`).
//
// Só LÊ o banco. Nada aqui altera requisição: quem corrige é a TI, com aprovação.
//
// Regras de comparação (aprendidas na conferência manual dos cupons):
//  - o código impresso pelo posto (LAN-CHA9, BAR-CO03…) NÃO identifica a requisição;
//    o casamento é por dia + valor + tipo de combustível;
//  - a data da requisição pode ser o dia do registro (um ou dois dias de diferença);
//  - "assinado" = motorista assinou, mas ainda não teve baixa: o posto já cobra.

import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

// Fuso de Santarém-PA (UTC−3, sem horário de verão).
const OFFSET_MS = 3 * 3600 * 1000;
const DIA_MS = 86400000;
// Quantos dias a requisição pode estar antes/depois da data da nota.
const TOLERANCIA_DIAS = 2;
// Diferença máxima (em %) para considerar "mesmo abastecimento, valor diferente".
const TOLERANCIA_VALOR_PCT = 15;

// ---------------------------------------------------------------------------
// Utilitários
// ---------------------------------------------------------------------------

export function classeCombustivel(texto) {
  const t = String(texto || '').toUpperCase();
  if (!t) return '';
  if (/^(GAC|GAA|GAS)$/.test(t) || t.includes('GASOL')) return 'gasolina';
  if (/^(DIE|DSL)$/.test(t) || t.includes('DIESEL')) return 'diesel';
  if (/^(ETA|ETN|ALC)$/.test(t) || t.includes('ETANOL') || t.includes('ALCOOL') || t.includes('ÁLCOOL')) return 'etanol';
  return 'outro';
}

const ROTULO_CLASSE = { gasolina: 'Gasolina', diesel: 'Diesel', etanol: 'Etanol', outro: 'Outro', '': '' };

function centavos(v) {
  return Math.round(Number(v) * 100);
}

function lerMoedaTexto(v) {
  if (v == null || v === '') return null;
  const n = parseFloat(String(v).replace(/[^\d.\-]/g, ''));
  return Number.isNaN(n) ? null : n;
}

function lerLitros(v) {
  if (v == null || v === '') return null;
  const n = parseFloat(String(v).replace(/\s*L$/i, '').replace(',', '.'));
  return Number.isNaN(n) ? null : n;
}

function diaLocal(isoUtc) {
  const t = Date.parse(isoUtc);
  return Number.isNaN(t) ? null : new Date(t - OFFSET_MS).toISOString().slice(0, 10);
}

function diasEntre(a, b) {
  return Math.round((Date.parse(a + 'T00:00:00Z') - Date.parse(b + 'T00:00:00Z')) / DIA_MS);
}

function somarDias(dia, n) {
  return new Date(Date.parse(dia + 'T00:00:00Z') + n * DIA_MS).toISOString().slice(0, 10);
}

const REGEX_DIA = /^\d{4}-\d{2}-\d{2}$/;

// ---------------------------------------------------------------------------
// Leitura do borderô em PDF
// ---------------------------------------------------------------------------

export class PdfSemTextoError extends Error {}

async function extrairTextoPdf(buffer) {
  const pdfjs = require('pdfjs-dist/legacy/build/pdf.js');
  const doc = await pdfjs.getDocument({
    data: new Uint8Array(buffer),
    useSystemFonts: true,
    disableFontFace: true,
    verbosity: 0,
  }).promise;
  let texto = '';
  for (let p = 1; p <= doc.numPages; p++) {
    const conteudo = await (await doc.getPage(p)).getTextContent();
    texto += conteudo.items.map((i) => i.str).join(' ') + '\n';
  }
  return texto;
}

// Uma linha do borderô do Amanhecer, já com os espaços colapsados:
//   NC.316829 26/10/2026 SEG 08/11/2026 DOM [atraso] LAN-CHA9 GAC 344,50 0,00 0,00 0,00 344,50
// A parcela ("-1/1") e o atraso podem faltar.
const REGEX_LINHA_BORDERO =
  /(NC\.\d+(?:-\d+\/\d+)?) (\d{2})\/(\d{2})\/(\d{4}) [A-Z]{3} \d{2}\/\d{2}\/\d{4} [A-Z]{3}(?: \d+)? ([A-Z0-9-]+) ([A-Z]{3}) ([\d.]+,\d{2})/g;

export async function lerBorderoPdf(buffer) {
  const texto = (await extrairTextoPdf(buffer)).replace(/\s+/g, ' ').trim();

  // PDF digitalizado (só imagem) não tem texto: tem que digitar os cupons.
  if (texto.length < 80 || !/NC\./.test(texto)) {
    throw new PdfSemTextoError(
      'Não consegui ler texto neste PDF (parece digitalizado ou não é um borderô). ' +
      'Digite os cupons manualmente.'
    );
  }

  const avisos = [];
  const itens = [];
  const vistos = new Set();
  let m;
  REGEX_LINHA_BORDERO.lastIndex = 0;
  while ((m = REGEX_LINHA_BORDERO.exec(texto))) {
    const documento = m[1];
    if (vistos.has(documento)) {
      avisos.push(`Documento ${documento} aparece mais de uma vez no PDF (página repetida?). Contado uma vez.`);
      continue;
    }
    vistos.add(documento);
    itens.push({
      documento,
      data: `${m[4]}-${m[3]}-${m[2]}`,
      codigoPosto: m[5],
      combustivel: ROTULO_CLASSE[classeCombustivel(m[6])] || m[6],
      valor: Number(m[7].replace(/\./g, '').replace(',', '.')),
    });
  }

  // Confere com o rodapé impresso ("Total Qtde Conta(s): 55 ... 15.580,37").
  const rodape = texto.match(/Total Qtde Conta\(s\): (\d+) ([\d.]+,\d{2})/);
  const totalRodape = rodape
    ? { qtd: Number(rodape[1]), valor: Number(rodape[2].replace(/\./g, '').replace(',', '.')) }
    : null;
  const somaLida = itens.reduce((s, i) => s + i.valor, 0);
  const confereRodape = totalRodape
    ? totalRodape.qtd === itens.length && centavos(totalRodape.valor) === centavos(somaLida)
    : null;
  if (totalRodape && !confereRodape) {
    avisos.push(
      `Atenção: o rodapé do PDF diz ${totalRodape.qtd} notas / R$ ${totalRodape.valor.toFixed(2)}, ` +
      `mas li ${itens.length} notas / R$ ${somaLida.toFixed(2)}. Confira antes de comparar.`
    );
  }
  if (!itens.length) {
    throw new PdfSemTextoError('Não encontrei nenhuma nota neste PDF. Digite os cupons manualmente.');
  }

  const posto = (texto.match(/((?:AUTO )?POSTO [A-ZÀ-Ú][A-ZÀ-Ú ]*?)(?=,| CNPJ| Razão| Documento)/) || [])[1] || null;
  const datas = itens.map((i) => i.data).sort();
  return {
    postoNoDocumento: posto,
    de: datas[0],
    ate: datas[datas.length - 1],
    itens,
    totalRodape,
    confereRodape,
    avisos,
  };
}

// ---------------------------------------------------------------------------
// Comparação com as requisições do sistema
// ---------------------------------------------------------------------------

export function validarEntrada({ posto, de, ate, itens }) {
  if (!posto || typeof posto !== 'string') return 'Escolha o posto.';
  if (!REGEX_DIA.test(de || '') || !REGEX_DIA.test(ate || '')) return 'Informe o período (data inicial e final).';
  if (de > ate) return 'A data inicial é depois da final.';
  if (!Array.isArray(itens) || itens.length === 0) return 'Adicione ao menos um cupom ou importe o borderô.';
  if (itens.length > 3000) return 'Muitos documentos de uma vez (máximo 3000).';
  for (const [i, it] of itens.entries()) {
    if (!REGEX_DIA.test(it?.data || '')) return `Documento ${i + 1}: data inválida.`;
    if (!(Number(it?.valor) > 0)) return `Documento ${i + 1}: valor inválido.`;
  }
  return null;
}

/**
 * @param {object}   args
 * @param {(path: string) => Promise<object[]>} args.buscar  consulta paginada ao Supabase
 */
export async function compararMedicao({ buscar, posto, de, ate, itens }) {
  // Janela de busca: o período mais a tolerância de dias nas pontas (horário de Santarém).
  const inicioMs = Date.parse(somarDias(de, -TOLERANCIA_DIAS) + 'T00:00:00Z') + OFFSET_MS;
  const fimMs = Date.parse(somarDias(ate, TOLERANCIA_DIAS + 1) + 'T00:00:00Z') + OFFSET_MS;
  const url =
    `/requests?select=id,status,plate,vehicle,fuel_type,liters,estimated_value,real_value,date,notes` +
    `&status=in.(completed,signed,pending)` +
    `&gas_station=eq.${encodeURIComponent(posto)}` +
    `&date=gte.${encodeURIComponent(new Date(inicioMs).toISOString())}` +
    `&date=lt.${encodeURIComponent(new Date(fimMs).toISOString())}` +
    `&order=date.asc,id.asc`;
  const brutas = await buscar(url);

  const reqs = brutas
    .map((r) => {
      const valor = lerMoedaTexto(r.real_value) ?? lerMoedaTexto(r.estimated_value);
      return {
        id: r.id,
        status: r.status,
        dia: diaLocal(r.date),
        valor,
        classe: classeCombustivel(r.fuel_type),
        litros: lerLitros(r.liters),
        veiculo: (r.plate ? `${r.vehicle || ''} (${r.plate})` : r.vehicle || '').trim(),
        placa: (r.plate || '').trim().toUpperCase(),
        usada: false,
      };
    })
    .filter((r) => r.dia && r.valor != null);

  const docs = itens
    .map((it, ordem) => ({
      ordem,
      documento: String(it.documento || '').trim() || `Cupom ${ordem + 1}`,
      data: it.data,
      valor: Number(it.valor),
      classe: classeCombustivel(it.combustivel),
      litros: it.litros != null && it.litros !== '' ? Number(it.litros) : null,
      placa: String(it.placa || '').trim().toUpperCase(),
      codigoPosto: it.codigoPosto || '',
      par: null,
      situacao: null,
    }))
    .sort((a, b) => a.data.localeCompare(b.data) || a.ordem - b.ordem);

  const classeOk = (a, b) => !a.classe || !b.classe || a.classe === b.classe;

  // Passadas, da mais exata para a mais frouxa. Em cada uma, o documento pega a
  // requisição livre mais próxima em data.
  const passadas = [
    { situacao: 'confere', ok: (d, r) => centavos(d.valor) === centavos(r.valor) && diasEntre(d.data, r.dia) === 0 },
    { situacao: 'data_diferente', ok: (d, r) => centavos(d.valor) === centavos(r.valor) && Math.abs(diasEntre(d.data, r.dia)) <= TOLERANCIA_DIAS },
    {
      situacao: 'valor_diferente',
      ok: (d, r) =>
        Math.abs(diasEntre(d.data, r.dia)) <= 1 &&
        (Math.abs(d.valor - r.valor) / d.valor) * 100 <= TOLERANCIA_VALOR_PCT,
    },
  ];
  for (const passada of passadas) {
    for (const d of docs) {
      if (d.par) continue;
      let melhor = null;
      for (const r of reqs) {
        if (r.usada || !classeOk(d, r) || !passada.ok(d, r)) continue;
        const dist = Math.abs(diasEntre(d.data, r.dia));
        const difValor = Math.abs(d.valor - r.valor);
        if (!melhor || dist < melhor.dist || (dist === melhor.dist && difValor < melhor.difValor)) {
          melhor = { r, dist, difValor };
        }
      }
      if (melhor) {
        melhor.r.usada = true;
        d.par = melhor.r;
        d.situacao = passada.situacao;
      }
    }
  }

  // Monta as linhas do resultado.
  const linhas = [];
  for (const d of docs) {
    const r = d.par;
    const alertas = [];
    if (r) {
      if (d.litros != null && r.litros != null && Math.abs(d.litros - r.litros) > 0.5) {
        alertas.push(`litros: nota ${d.litros} L, sistema ${r.litros} L`);
      }
      if (d.placa && r.placa && d.placa.replace(/[^A-Z0-9]/g, '') !== r.placa.replace(/[^A-Z0-9]/g, '')) {
        alertas.push(`placa: nota ${d.placa}, sistema ${r.placa}`);
      }
      if (r.status !== 'completed') {
        alertas.push(r.status === 'signed' ? 'requisição assinada, ainda sem baixa' : 'requisição pendente');
      }
    }
    linhas.push({
      situacao: d.situacao || 'sem_requisicao',
      documento: d.documento,
      data: d.data,
      combustivel: ROTULO_CLASSE[d.classe] || '',
      codigoPosto: d.codigoPosto,
      valorPosto: d.valor,
      litrosPosto: d.litros,
      requisicao: r?.id || null,
      dataSistema: r?.dia || null,
      statusSistema: r?.status || null,
      veiculo: r?.veiculo || '',
      valorSistema: r ? r.valor : null,
      litrosSistema: r ? r.litros : null,
      diferenca: r ? Math.round((d.valor - r.valor) * 100) / 100 : null,
      alertas,
    });
  }
  // Requisições do período que o posto não cobrou.
  for (const r of reqs) {
    if (r.usada || r.dia < de || r.dia > ate) continue;
    linhas.push({
      situacao: 'sem_nota',
      documento: '',
      data: r.dia,
      combustivel: ROTULO_CLASSE[r.classe] || '',
      codigoPosto: '',
      valorPosto: null,
      litrosPosto: null,
      requisicao: r.id,
      dataSistema: r.dia,
      statusSistema: r.status,
      veiculo: r.veiculo,
      valorSistema: r.valor,
      litrosSistema: r.litros,
      diferenca: null,
      alertas: r.status === 'completed' ? [] : [r.status === 'signed' ? 'requisição assinada, ainda sem baixa' : 'requisição pendente'],
    });
  }

  const contagem = { confere: 0, data_diferente: 0, valor_diferente: 0, sem_requisicao: 0, sem_nota: 0 };
  for (const l of linhas) contagem[l.situacao] += 1;

  const soma = (arr, campo) => Math.round(arr.reduce((s, l) => s + (l[campo] || 0), 0) * 100) / 100;
  const doPosto = linhas.filter((l) => l.situacao !== 'sem_nota');
  const doSistema = linhas.filter((l) => l.situacao !== 'sem_requisicao');
  const resumo = {
    posto: { qtd: doPosto.length, valor: soma(doPosto, 'valorPosto') },
    sistema: { qtd: doSistema.length, valor: soma(doSistema, 'valorSistema') },
  };
  resumo.diferenca = {
    qtd: resumo.posto.qtd - resumo.sistema.qtd,
    valor: Math.round((resumo.posto.valor - resumo.sistema.valor) * 100) / 100,
  };

  // Mais problemáticas primeiro; dentro de cada grupo, por data.
  const ORDEM = { valor_diferente: 0, sem_requisicao: 1, sem_nota: 2, data_diferente: 3, confere: 4 };
  linhas.sort((a, b) => ORDEM[a.situacao] - ORDEM[b.situacao] || a.data.localeCompare(b.data) || a.documento.localeCompare(b.documento));

  return { posto, de, ate, resumo, contagem, linhas };
}

// ---------------------------------------------------------------------------
// Exportação para Excel
// ---------------------------------------------------------------------------

const ROTULO_SITUACAO = {
  confere: 'Confere',
  data_diferente: 'Confere (data diferente)',
  valor_diferente: 'Valor diferente',
  sem_requisicao: 'Nota sem requisição',
  sem_nota: 'Requisição sem nota',
};

const ROTULO_STATUS = { completed: 'Concluída', signed: 'Assinada (sem baixa)', pending: 'Pendente' };

function br(dia) {
  return dia ? dia.split('-').reverse().join('/') : '';
}

export async function gerarXlsx(res) {
  const { utils, write } = await import('xlsx');
  const wb = utils.book_new();

  const resumo = [
    [`MEDIÇÃO ${res.posto.toUpperCase()} ${br(res.de)} À ${br(res.ate)}`],
    [],
    ['', 'Quantidade', 'Valor (R$)'],
    ['Cobrado pelo posto', res.resumo.posto.qtd, res.resumo.posto.valor],
    ['Requisições no sistema', res.resumo.sistema.qtd, res.resumo.sistema.valor],
    ['Diferença', res.resumo.diferenca.qtd, res.resumo.diferenca.valor],
    [],
    ['Situação', 'Quantidade'],
    ...Object.entries(ROTULO_SITUACAO).map(([k, rotulo]) => [rotulo, res.contagem[k] || 0]),
  ];
  const wsResumo = utils.aoa_to_sheet(resumo);
  wsResumo['!cols'] = [{ wch: 28 }, { wch: 14 }, { wch: 14 }];
  utils.book_append_sheet(wb, wsResumo, 'Resumo');

  const cab = [
    'Situação', 'Documento (posto)', 'Data', 'Combustível', 'Código do posto', 'Valor posto (R$)',
    'Requisição (sistema)', 'Data sistema', 'Status sistema', 'Veículo / bombona (sistema)',
    'Valor sistema (R$)', 'Diferença (R$)', 'Observações',
  ];
  const corpo = res.linhas.map((l) => [
    ROTULO_SITUACAO[l.situacao], l.documento, br(l.data), l.combustivel, l.codigoPosto,
    l.valorPosto ?? '', l.requisicao || '', br(l.dataSistema), ROTULO_STATUS[l.statusSistema] || '',
    l.veiculo, l.valorSistema ?? '', l.diferenca ?? '', l.alertas.join('; '),
  ]);
  const wsConf = utils.aoa_to_sheet([cab, ...corpo]);
  wsConf['!cols'] = [24, 20, 12, 13, 16, 16, 20, 13, 22, 40, 16, 14, 50].map((wch) => ({ wch }));
  utils.book_append_sheet(wb, wsConf, 'Conferência');

  return write(wb, { type: 'buffer', bookType: 'xlsx' });
}
