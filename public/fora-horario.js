// Página "Fora de Horário": lê a planilha do rastreador no navegador,
// aplica as regras (fora-horario-core.js) e gera Excel / PDF / texto de e-mail.
// Nada é enviado ao servidor — os nomes dos motoristas ficam só nesta aba.

import {
  analisar, fmtDuracao, fmtData, fmtHora, fmtDataHora, diaSemana, linkTrajeto, NAO_IDENTIFICADO, REGRAS_PADRAO,
} from './fora-horario-core.js';
import { lerPlanilha, gerarXlsx, E } from './xlsx-mini.js';

const $ = (id) => document.getElementById(id);
const fmtKm = (n) => (n ?? 0).toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const fmtInt = (n) => (n ?? 0).toLocaleString('pt-BR');
const escH = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

let resultado = null;
let nomeArquivo = '';
let linhasAtuais = null;

// ---------------- feriados extras (salvos no navegador) ----------------
const CHAVE_FER = 'foraHorario.feriadosExtras';
function carregarFeriados() {
  try { return JSON.parse(localStorage.getItem(CHAVE_FER) || '[]'); } catch { return []; }
}
function salvarFeriados(lista) {
  try { localStorage.setItem(CHAVE_FER, JSON.stringify(lista)); } catch { /* navegador sem storage: segue só nesta sessão */ }
}
let feriadosExtras = carregarFeriados();

function renderFeriados() {
  const box = $('ferList');
  box.innerHTML = '';
  if (!feriadosExtras.length) {
    box.innerHTML = '<span class="hint">Nenhum feriado extra cadastrado.</span>';
    return;
  }
  feriadosExtras
    .slice().sort((a, b) => a.data.localeCompare(b.data))
    .forEach((f) => {
      const [y, m, d] = f.data.split('-');
      const item = document.createElement('span');
      item.className = 'fer-item';
      item.innerHTML = `${d}/${m}/${y} · ${escH(f.nome)} <button type="button" title="Remover">×</button>`;
      item.querySelector('button').addEventListener('click', () => {
        feriadosExtras = feriadosExtras.filter((x) => x.data !== f.data);
        salvarFeriados(feriadosExtras); renderFeriados(); reprocessar();
      });
      box.appendChild(item);
    });
}

$('ferDetails').addEventListener('toggle', (e) => { $('ferBox').hidden = !e.target.open; });
$('ferAdd').addEventListener('click', () => {
  const data = $('ferData').value;
  const nome = $('ferNome').value.trim() || 'Feriado';
  if (!data) { $('ferData').focus(); return; }
  feriadosExtras = feriadosExtras.filter((x) => x.data !== data).concat({ data, nome });
  salvarFeriados(feriadosExtras);
  $('ferData').value = ''; $('ferNome').value = '';
  renderFeriados(); reprocessar();
});
renderFeriados();

// ---------------- upload ----------------
const drop = $('drop');
['dragenter', 'dragover'].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.add('over'); }));
['dragleave', 'drop'].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.remove('over'); }));
drop.addEventListener('drop', (e) => { const f = e.dataTransfer?.files?.[0]; if (f) processarArquivo(f); });
$('arquivo').addEventListener('change', (e) => { const f = e.target.files?.[0]; if (f) processarArquivo(f); e.target.value = ''; });

function mostrarErro(msg) {
  const box = $('erro');
  box.textContent = msg;
  box.style.display = msg ? 'block' : 'none';
}

async function processarArquivo(arquivo) {
  mostrarErro('');
  if (!/\.xlsx$/i.test(arquivo.name)) {
    mostrarErro('Use o arquivo .xlsx exportado do rastreador (se vier .xls ou .csv, abra no Excel e salve como .xlsx).');
    return;
  }
  $('dropT').innerHTML = `Lendo <span class="file">${escH(arquivo.name)}</span>…`;
  try {
    linhasAtuais = await lerPlanilha(await arquivo.arrayBuffer());
    nomeArquivo = arquivo.name;
    reprocessar();
    $('dropT').innerHTML = `<span class="file">${escH(arquivo.name)}</span> carregado`;
    $('dropD').textContent = 'Arraste outro arquivo ou clique para trocar.';
  } catch (err) {
    console.error(err);
    linhasAtuais = null;
    $('resultado').style.display = 'none';
    $('dropT').textContent = 'Arraste aqui a planilha exportada do rastreador';
    mostrarErro(err?.message || 'Não foi possível ler a planilha.');
  }
}

function reprocessar() {
  if (!linhasAtuais) return;
  try {
    resultado = analisar(linhasAtuais, { feriadosExtras });
    if (!resultado.totais.viagensNaPlanilha) throw new Error('Nenhuma viagem encontrada na planilha.');
    render(resultado);
  } catch (err) {
    console.error(err);
    $('resultado').style.display = 'none';
    mostrarErro(err?.message || 'Não foi possível analisar a planilha.');
  }
}

// ---------------- render ----------------
const textoPeriodo = (r) => (r.periodo ? `${fmtDataHora(r.periodo.de)} a ${fmtDataHora(r.periodo.ate)}` : '—');

function classeTag(motivo) {
  if (motivo.startsWith('Feriado')) return 'tag fer';
  if (motivo === 'Sábado' || motivo === 'Domingo') return 'tag fds';
  return 'tag';
}

function nomeGrupo(chave) {
  return chave.startsWith(NAO_IDENTIFICADO)
    ? `<span class="ni">Motorista não identificado</span>`
    : escH(chave);
}

function render(r) {
  const t = r.totais;
  $('resultado').style.display = 'flex';
  $('periodoTxt').innerHTML = `Período da planilha: <b>${textoPeriodo(r)}</b>`;
  $('printCab').innerHTML = `
    <div style="font-size:12px;color:var(--text-muted)">Período analisado: <b style="color:var(--text-primary)">${textoPeriodo(r)}</b> · Gerado em ${fmtDataHora(new Date())} · Arquivo: ${escH(nomeArquivo)}</div>`;

  const kpi = (l, v, f, cls = '') => `<div class="kpi ${cls}"><div class="l">${l}</div><div class="v">${v}</div>${f ? `<div class="f">${f}</div>` : ''}</div>`;
  $('kpis').innerHTML = [
    kpi('Viagens fora do horário', fmtInt(t.viagensFora), `de ${fmtInt(t.viagensNaPlanilha)} viagens na planilha`),
    kpi('Km rodados', fmtKm(t.km), 'fora do expediente'),
    kpi('Tempo em movimento', fmtDuracao(t.duracaoSeg), 'soma das viagens'),
    kpi('Veículos', fmtInt(t.veiculos), `${fmtInt(t.motoristas)} motoristas identificados`),
    kpi('Sem motorista', fmtInt(t.semMotorista), t.semMotorista ? 'viagens sem identificação no rastreador' : 'todas identificadas', t.semMotorista ? 'warn' : ''),
  ].join('');

  if (!t.viagensFora) {
    $('tblMot').innerHTML = '<tr><td class="muted">Nenhuma viagem fora do horário neste período.</td></tr>';
    $('tblVei').innerHTML = '';
    $('tblVia').innerHTML = '';
    $('nMot').textContent = ''; $('nVei').textContent = ''; $('nVia').textContent = '';
    return;
  }

  const maxKmMot = Math.max(...r.porMotorista.map((g) => g.km), 1);
  $('nMot').textContent = `${r.porMotorista.length}`;
  $('tblMot').innerHTML = `
    <thead><tr><th>Motorista</th><th>Veículo</th><th class="num">Viagens</th><th class="num">Km</th><th class="num">Tempo</th><th>Horários</th></tr></thead>
    <tbody>${r.porMotorista.map((g) => `
      <tr>
        <td>${nomeGrupo(g.chave)}<div class="bar"><span style="width:${Math.max(3, (g.km / maxKmMot) * 100)}%"></span></div></td>
        <td class="nw">${g.veiculos.map(escH).join('<br>')}</td>
        <td class="num">${g.viagens}</td>
        <td class="num">${fmtKm(g.km)}</td>
        <td class="num">${fmtDuracao(g.duracaoSeg)}</td>
        <td class="nw"><span class="muted">${fmtData(g.primeira)} ${fmtHora(g.primeira)} → ${fmtData(g.ultima) !== fmtData(g.primeira) ? fmtData(g.ultima) + ' ' : ''}${fmtHora(g.ultima)}</span></td>
      </tr>`).join('')}
    </tbody>`;

  $('nVei').textContent = `${r.porVeiculo.length}`;
  $('tblVei').innerHTML = `
    <thead><tr><th>Veículo</th><th>Motorista(s)</th><th class="num">Viagens</th><th class="num">Km</th><th class="num">Tempo</th></tr></thead>
    <tbody>${r.porVeiculo.map((g) => `
      <tr>
        <td class="nw"><b>${escH(g.chave)}</b></td>
        <td>${g.motoristas.map((m) => (m === NAO_IDENTIFICADO ? '<span class="ni">Não identificado</span>' : escH(m))).join('<br>')}</td>
        <td class="num">${g.viagens}</td>
        <td class="num">${fmtKm(g.km)}</td>
        <td class="num">${fmtDuracao(g.duracaoSeg)}</td>
      </tr>`).join('')}
    </tbody>`;

  // filtro da tabela de viagens
  const sel = $('filtroPessoa');
  const atual = sel.value;
  sel.innerHTML = '<option value="">Todos os motoristas / veículos</option>'
    + r.porMotorista.map((g) => `<option value="m:${escH(g.chave)}">${escH(g.chave.startsWith(NAO_IDENTIFICADO) ? `Não identificado (${g.veiculos[0]})` : g.chave)}</option>`).join('')
    + r.porVeiculo.map((g) => `<option value="v:${escH(g.chave)}">Veículo ${escH(g.chave)}</option>`).join('');
  sel.value = [...sel.options].some((o) => o.value === atual) ? atual : '';
  renderViagens();
}

function chaveMotorista(v) { return v.motorista ? v.motorista : `${NAO_IDENTIFICADO} · ${v.veiculo}`; }

function renderViagens() {
  if (!resultado) return;
  const f = $('filtroPessoa').value;
  const lista = resultado.viagens.filter((v) => !f
    || (f.startsWith('m:') && chaveMotorista(v) === f.slice(2))
    || (f.startsWith('v:') && v.veiculo === f.slice(2)));
  const temVelMax = resultado.viagens.some((v) => v.velMax != null);
  $('nVia').textContent = `${lista.length}${f ? ` de ${resultado.viagens.length}` : ''}`;
  $('tblVia').innerHTML = `
    <thead><tr><th>Data</th><th>Motivo</th><th>Veículo</th><th>Motorista</th><th>Início</th><th>Fim</th><th class="num">Duração</th><th class="num">Km</th><th class="num">Vel. média</th>${temVelMax ? '<th class="num">Vel. máx.</th>' : ''}<th>Origem → Destino</th><th class="no-print">Mapa</th></tr></thead>
    <tbody>${lista.map((v) => {
      const mapa = linkTrajeto(v.coordIni, v.coordFim);
      return `
      <tr>
        <td class="nw">${fmtData(v.inicio)}<div class="muted">${diaSemana(v.inicio)}</div></td>
        <td><span class="${classeTag(v.motivo)}">${escH(v.motivo)}</span></td>
        <td class="nw"><b>${escH(v.veiculo)}</b></td>
        <td>${v.motorista ? escH(v.motorista) : '<span class="ni">Não identificado</span>'}</td>
        <td class="nw">${fmtHora(v.inicio)}</td>
        <td class="nw">${fmtData(v.fim) !== fmtData(v.inicio) ? `${fmtData(v.fim)} ` : ''}${fmtHora(v.fim)}</td>
        <td class="num">${fmtDuracao(v.duracaoSeg)}</td>
        <td class="num">${fmtKm(v.km)}</td>
        <td class="num">${v.velMedia != null ? `${Math.round(v.velMedia)} km/h` : '—'}</td>
        ${temVelMax ? `<td class="num">${v.velMax != null ? `${Math.round(v.velMax)} km/h` : '—'}</td>` : ''}
        <td class="addr">${escH(v.origem || '—')}<br><span class="muted">→ ${escH(v.destino || '—')}</span></td>
        <td class="no-print">${mapa ? `<a href="${mapa}" target="_blank" rel="noopener">ver</a>` : ''}</td>
      </tr>`;
    }).join('')}
    </tbody>`;
}
$('filtroPessoa').addEventListener('change', renderViagens);

// ---------------- toast ----------------
let toastTimer;
function toast(msg) {
  const t = $('toast');
  t.textContent = msg; t.classList.add('show');
  clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove('show'), 2600);
}

// ---------------- Excel ----------------
const pad2 = (n) => String(n).padStart(2, '0');
const nomeArquivoSaida = (r) => {
  const d = r.periodo?.de || new Date(), a = r.periodo?.ate || new Date();
  const fmt = (x) => `${x.getFullYear()}-${pad2(x.getMonth() + 1)}-${pad2(x.getDate())}`;
  return `Fora_de_horario_${fmt(d)}${fmt(a) !== fmt(d) ? `_a_${fmt(a)}` : ''}.xlsx`;
};
const durExcel = (seg) => (seg ?? 0) / 86400;

function montarExcel(r) {
  const t = r.totais;
  const reg = r.regras || REGRAS_PADRAO;
  const criterio = `Expediente de segunda a sexta, das ${pad2(reg.inicioExpediente)}h às ${pad2(reg.fimExpediente)}h. Sábados, domingos e feriados contam o dia inteiro como fora do horário. Viagem que encosta no período fora do expediente conta inteira. Viagens abaixo de ${String(reg.kmMinimo).replace('.', ',')} km desconsideradas.`;
  const feriados = r.feriadosNoPeriodo.length
    ? r.feriadosNoPeriodo.map((f) => `${f.data.split('-').reverse().join('/')} (${f.nome})`).join('; ')
    : 'Nenhum';

  // ---- Aba Resumo ----
  const L = [];
  const alt = {};
  const mesclar = ['A1:H1', 'A2:H2', 'B4:H4', 'B5:H5', 'B6:H6', 'B7:H7'];
  L.push([{ v: 'Uso de veículos fora do horário de expediente', s: E.titulo }]); alt[0] = 24;
  L.push([{ v: `Rezende Energia · relatório gerado em ${fmtDataHora(new Date())} a partir do rastreamento veicular`, s: E.subtitulo }]);
  L.push([]);
  L.push([{ v: 'Período analisado', s: E.rotulo }, textoPeriodo(r)]);
  L.push([{ v: 'Critério', s: E.rotulo }, criterio]); alt[4] = 30;
  L.push([{ v: 'Feriados no período', s: E.rotulo }, feriados]);
  L.push([{ v: 'Arquivo de origem', s: E.rotulo }, nomeArquivo]);
  L.push([]);
  const kpi = (rotulo, valor, estilo = E.destaque) => L.push([{ v: rotulo, s: E.rotulo }, { v: valor, s: estilo }]);
  kpi('Viagens fora do horário', `${t.viagensFora} (de ${t.viagensNaPlanilha} viagens na planilha)`);
  kpi('Km rodados', `${fmtKm(t.km)} km`);
  kpi('Tempo em movimento', fmtDuracao(t.duracaoSeg));
  kpi('Veículos envolvidos', `${t.veiculos}`);
  kpi('Motoristas identificados', `${t.motoristas}`);
  kpi('Viagens sem motorista', t.semMotorista ? `${t.semMotorista} (sem identificação no rastreador)` : '0', t.semMotorista ? E.alerta : E.destaque);
  L.push([]);

  const cabGrupo = (titulo1, titulo2) => [titulo1, titulo2, 'Viagens', 'Dias', 'Km', 'Tempo', 'Primeira saída', 'Último retorno'].map((v) => ({ v, s: E.cabecalho }));
  const linhaGrupo = (nome, outros, g) => [
    { v: nome, s: E.texto }, { v: outros, s: E.texto }, { v: g.viagens, s: E.inteiro }, { v: g.dias, s: E.inteiro },
    { v: g.km, s: E.decimal }, { v: durExcel(g.duracaoSeg), s: E.duracao },
    { v: g.primeira, s: E.dataHora }, { v: g.ultima, s: E.dataHora },
  ];
  const linhaTotal = (grupos) => [
    { v: 'Total', s: E.totalTexto }, { v: '', s: E.totalTexto },
    { v: grupos.reduce((s, g) => s + g.viagens, 0), s: E.totalInteiro }, { v: '', s: E.totalTexto },
    { v: grupos.reduce((s, g) => s + g.km, 0), s: E.totalDecimal },
    { v: durExcel(grupos.reduce((s, g) => s + g.duracaoSeg, 0)), s: E.totalDuracao },
    { v: '', s: E.totalTexto }, { v: '', s: E.totalTexto },
  ];

  L.push([{ v: 'Por motorista', s: E.rotulo }]);
  L.push(cabGrupo('Motorista', 'Veículo(s)')); alt[L.length - 1] = 20;
  for (const g of r.porMotorista) {
    const nome = g.chave.startsWith(NAO_IDENTIFICADO) ? 'Motorista não identificado' : g.chave;
    L.push(linhaGrupo(nome, g.veiculos.join(', '), g));
  }
  L.push(linhaTotal(r.porMotorista));
  L.push([]);
  L.push([{ v: 'Por veículo', s: E.rotulo }]);
  L.push(cabGrupo('Veículo', 'Motorista(s)')); alt[L.length - 1] = 20;
  for (const g of r.porVeiculo) L.push(linhaGrupo(g.chave, g.motoristas.join(', '), g));
  L.push(linhaTotal(r.porVeiculo));

  const resumo = {
    nome: 'Resumo', larguras: [30, 34, 9, 7, 9, 9, 18, 18], linhas: L, alturas: alt, mesclar,
  };
  // texto longo do critério quebra linha
  L[4][1] = { v: criterio, s: E.quebra };
  L[5][1] = { v: feriados, s: E.quebra };

  // ---- Aba Viagens ----
  const temVelMax = r.viagens.some((v) => v.velMax != null);
  const cab = ['Data', 'Dia da semana', 'Motivo', 'Veículo', 'Motorista', 'Início', 'Fim', 'Duração', 'Km', 'Vel. média (km/h)']
    .concat(temVelMax ? ['Vel. máx. (km/h)'] : [])
    .concat(['Origem', 'Destino', 'Coord. inicial', 'Coord. final', 'Trajeto no mapa']);
  const V = [
    [{ v: 'Viagens fora do horário de expediente', s: E.titulo }],
    [{ v: `Período: ${textoPeriodo(r)} · ${t.viagensFora} viagens · ${fmtKm(t.km)} km`, s: E.subtitulo }],
    cab.map((v) => ({ v, s: E.cabecalho })),
  ];
  for (const v of r.viagens) {
    const mapa = linkTrajeto(v.coordIni, v.coordFim);
    V.push([
      { v: fmtData(v.inicio), s: E.texto }, { v: diaSemana(v.inicio), s: E.texto }, { v: v.motivo, s: E.texto },
      { v: v.veiculo, s: E.texto }, { v: v.motorista || NAO_IDENTIFICADO, s: E.texto },
      { v: v.inicio, s: E.dataHora }, { v: v.fim, s: E.dataHora }, { v: durExcel(v.duracaoSeg), s: E.duracao },
      { v: v.km, s: E.decimal }, { v: v.velMedia ?? '', s: E.inteiro },
      ...(temVelMax ? [{ v: v.velMax ?? '', s: E.inteiro }] : []),
      { v: v.origem, s: E.texto }, { v: v.destino, s: E.texto },
      { v: v.coordIni, s: E.texto }, { v: v.coordFim, s: E.texto },
      mapa ? { v: 'Abrir trajeto', link: mapa, s: E.link } : { v: '', s: E.texto },
    ]);
  }
  const ultimaCol = String.fromCharCode(64 + cab.length);
  const viagens = {
    nome: 'Viagens',
    larguras: [11, 13, 18, 11, 34, 16, 16, 9, 8, 9, ...(temVelMax ? [9] : []), 44, 44, 22, 22, 14],
    linhas: V, alturas: { 0: 22, 2: 30 }, mesclar: ['A1:H1', 'A2:H2'],
    congelar: { linha: 3, coluna: 0 }, filtro: `A3:${ultimaCol}${V.length}`, paisagem: true,
  };

  return gerarXlsx([resumo, viagens], { titulo: 'Uso de veículos fora do horário', autor: 'Rezende Energia · TI' });
}

$('btnExcel').addEventListener('click', () => {
  if (!resultado) return;
  const blob = montarExcel(resultado);
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = nomeArquivoSaida(resultado);
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
});

// ---------------- PDF (impressão do navegador) ----------------
$('btnPdf').addEventListener('click', () => {
  // imprime todas as viagens, mesmo que haja filtro aplicado na tela
  const sel = $('filtroPessoa');
  const filtroAntes = sel.value;
  if (filtroAntes) { sel.value = ''; renderViagens(); }
  window.print();
  if (filtroAntes) { sel.value = filtroAntes; renderViagens(); }
});

// ---------------- texto para e-mail ----------------
function textoEmail(r) {
  const t = r.totais;
  const linhas = [];
  linhas.push(`Assunto: Uso de veículos fora do horário — ${textoPeriodo(r)}`);
  linhas.push('');
  linhas.push('Prezado,');
  linhas.push('');
  linhas.push(`Segue o levantamento de uso da frota fora do horário de expediente (seg. a sex., 08h às 19h; sábados, domingos e feriados contam o dia todo), no período de ${textoPeriodo(r)}, com base no rastreamento veicular.`);
  linhas.push('');
  if (!t.viagensFora) {
    linhas.push('Não foram identificadas viagens fora do horário no período.');
  } else {
    linhas.push(`• ${t.viagensFora} viagens fora do horário, somando ${fmtKm(t.km)} km e ${fmtDuracao(t.duracaoSeg)} em movimento;`);
    linhas.push(`• ${t.veiculos} veículos e ${t.motoristas} motoristas identificados${t.semMotorista ? `; ${t.semMotorista} viagens sem motorista identificado no rastreador` : ''}.`);
    linhas.push('');
    linhas.push('Por motorista (km fora do horário):');
    r.porMotorista.forEach((g, i) => {
      const nome = g.chave.startsWith(NAO_IDENTIFICADO) ? 'Motorista não identificado' : g.chave;
      linhas.push(`${i + 1}. ${nome} (${g.veiculos.join(', ')}) — ${fmtKm(g.km)} km em ${g.viagens} viage${g.viagens > 1 ? 'ns' : 'm'}`);
    });
  }
  linhas.push('');
  linhas.push('O detalhamento de cada viagem (horários, origem, destino e trajeto no mapa) está na planilha em anexo.');
  linhas.push('');
  linhas.push('Atenciosamente,');
  return linhas.join('\n');
}

$('btnEmail').addEventListener('click', async () => {
  if (!resultado) return;
  const txt = textoEmail(resultado);
  try {
    await navigator.clipboard.writeText(txt);
    toast('Texto copiado — é só colar no e-mail e anexar o Excel');
  } catch {
    // sem permissão de clipboard: abre o cliente de e-mail com o texto
    const [assunto, ...corpo] = txt.split('\n');
    window.location.href = `mailto:?subject=${encodeURIComponent(assunto.replace(/^Assunto: /, ''))}&body=${encodeURIComponent(corpo.join('\n').trim())}`;
  }
});

// Exposto só para testes automatizados
window.__foraHorario = { montarExcel: () => resultado && montarExcel(resultado), textoEmail: () => resultado && textoEmail(resultado) };
