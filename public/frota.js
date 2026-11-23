/* Central da Frota — frota.js
   Alimenta public/frota.html com dados de /api/frota/*
   ------------------------------------------------------------------ */

// ------------------------------------------------------------------ //
// Chart.js — utilitários de tema
// ------------------------------------------------------------------ //

function rzVar(v) { return getComputedStyle(document.documentElement).getPropertyValue(v).trim(); }
const PAL_GRAFICO = ['#F7931E','#1E3A8A','#0D9488','#B45309','#7C3AED','#64748B','#EC4899','#059669'];

// Registra o plugin de rótulos de dados assim que Chart.js estiver disponível
document.addEventListener('DOMContentLoaded', () => {
  if (typeof ChartDataLabels !== 'undefined') {
    Chart.register(ChartDataLabels);
    // Desativa por padrão — cada gráfico ativa individualmente quando necessário
    Chart.defaults.set('plugins.datalabels', { display: false });
  }
});

function optsDonut(labels, vals, cores) {
  return {
    type: 'doughnut',
    data: { labels, datasets: [{ data: vals, backgroundColor: cores,
      borderColor: rzVar('--sup'), borderWidth: 3, hoverOffset: 6 }] },
    options: {
      responsive: true, maintainAspectRatio: false, cutout: '64%',
      plugins: {
        legend: { position: 'bottom', labels: { color: rzVar('--texto-2'),
          font: { family: 'Barlow', size: 11 }, padding: 10, boxWidth: 12 } },
        tooltip: { callbacks: { label: (ctx) => {
          const t = vals.reduce((a, b) => a + b, 0);
          return ` ${ctx.parsed.toLocaleString('pt-BR',{style:'currency',currency:'BRL'})} (${t ? ((ctx.parsed/t)*100).toFixed(1)+'%' : '0%'})`;
        } } }
      }
    }
  };
}

function optsBarHoriz(labels, dados, cor) {
  const fmtBRL = (v) => v >= 1000
    ? 'R$ ' + (v / 1000).toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 }) + 'k'
    : v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
  return {
    type: 'bar',
    data: { labels, datasets: [{ data: dados, backgroundColor: cor || '#F7931E',
      borderRadius: 4, borderSkipped: false }] },
    options: {
      indexAxis: 'y', responsive: true, maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        datalabels: {
          display: true,
          anchor: 'end', align: 'right', offset: 4,
          color: rzVar('--texto-2'), font: { family: 'Barlow', size: 10, weight: '600' },
          formatter: fmtBRL,
          clip: false,
        },
        tooltip: { callbacks: { label: (ctx) =>
          ` ${ctx.parsed.x.toLocaleString('pt-BR',{style:'currency',currency:'BRL'})}` } }
      },
      layout: { padding: { right: 72 } },
      scales: {
        x: { ticks: { color: rzVar('--texto-3'), font: { family: 'Barlow', size: 11 } },
             grid: { color: rzVar('--linha') } },
        y: { ticks: { color: rzVar('--texto-3'), font: { family: 'Barlow', size: 11 } },
             grid: { color: rzVar('--linha') } }
      }
    }
  };
}

function optsBarVert(labels, dados, cor) {
  const fmtBRL = (v) => v >= 1000
    ? 'R$ ' + (v / 1000).toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 }) + 'k'
    : v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
  return {
    type: 'bar',
    data: { labels, datasets: [{ data: dados,
      backgroundColor: cor || dados.map((_, i) => PAL_GRAFICO[i % PAL_GRAFICO.length] + 'dd'),
      borderRadius: 4 }] },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        datalabels: {
          display: true,
          anchor: 'end', align: 'top', offset: 2,
          color: rzVar('--texto-2'), font: { family: 'Barlow', size: 10, weight: '600' },
          formatter: fmtBRL,
          clip: false,
        },
        tooltip: { callbacks: { label: (ctx) =>
          ` ${ctx.parsed.y.toLocaleString('pt-BR',{style:'currency',currency:'BRL'})}` } }
      },
      layout: { padding: { top: 24 } },
      scales: {
        x: { ticks: { color: rzVar('--texto-3'), font: { family: 'Barlow', size: 11 }, maxRotation: 45 },
             grid: { color: rzVar('--linha') } },
        y: { ticks: { color: rzVar('--texto-3'), font: { family: 'Barlow', size: 11 } },
             grid: { color: rzVar('--linha') } }
      }
    }
  };
}

function optsLinha(labels, dados, cor) {
  const fmtBRL = (v) => v >= 1000
    ? 'R$ ' + (v / 1000).toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 }) + 'k'
    : v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
  const c = cor || '#F7931E';
  return {
    type: 'line',
    data: { labels, datasets: [{ data: dados,
      borderColor: c, backgroundColor: c + '22',
      borderWidth: 2.5, pointRadius: 5, pointBackgroundColor: c,
      pointBorderColor: rzVar('--sup'), pointBorderWidth: 2,
      fill: true, tension: 0.35 }] },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        datalabels: {
          display: true,
          anchor: 'end', align: 'top', offset: 4,
          color: rzVar('--texto-2'), font: { family: 'Barlow', size: 10, weight: '600' },
          formatter: fmtBRL,
          clip: false,
        },
        tooltip: { callbacks: { label: (ctx) =>
          ` ${ctx.parsed.y.toLocaleString('pt-BR',{style:'currency',currency:'BRL'})}` } }
      },
      layout: { padding: { top: 24 } },
      scales: {
        x: { ticks: { color: rzVar('--texto-3'), font: { family: 'Barlow', size: 11 }, maxRotation: 40 },
             grid: { color: rzVar('--linha') } },
        y: { ticks: { color: rzVar('--texto-3'), font: { family: 'Barlow', size: 11 } },
             grid: { color: rzVar('--linha') } }
      }
    }
  };
}

const _chartRefs = {};
function destruirChart(id) { if (_chartRefs[id]) { _chartRefs[id].destroy(); delete _chartRefs[id]; } }
function criarChart(id, cfg) {
  destruirChart(id);
  const el = document.getElementById(id);
  if (!el) return;
  _chartRefs[id] = new Chart(el, cfg);
}
function atualizarCoresCharts() {
  Object.values(_chartRefs).forEach((c) => {
    if (!c.options.scales) return;
    ['x', 'y'].forEach((ax) => {
      if (c.options.scales[ax]) {
        c.options.scales[ax].ticks.color = rzVar('--texto-3');
        c.options.scales[ax].grid.color  = rzVar('--linha');
      }
    });
    if (c.options.plugins?.legend?.labels)
      c.options.plugins.legend.labels.color = rzVar('--texto-2');
    c.update();
  });
}

'use strict';

// ------------------------------------------------------------------ //
// Utilitários
// ------------------------------------------------------------------ //

function moeda(v) {
  if (v == null || isNaN(v)) return '—';
  return v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', minimumFractionDigits: 2 });
}

function num(v) {
  if (v == null || isNaN(v)) return '—';
  return Number(v).toLocaleString('pt-BR');
}

function esc(s) {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// ------------------------------------------------------------------ //
// API
// ------------------------------------------------------------------ //

async function api(caminho, opts = {}) {
  const r = await fetch('/api/frota' + caminho, opts);
  if (r.status === 401) {
    window.location.href = '/frota/login?erro=sessao_expirada';
    throw new Error('Sessão expirada.');
  }
  if (!r.ok) {
    const corpo = await r.json().catch(() => ({}));
    throw new Error(corpo.erro || `Erro ${r.status}`);
  }
  // DELETE retorna 200 com JSON ou 204 sem corpo
  if (r.status === 204) return {};
  return r.json();
}

// ------------------------------------------------------------------ //
// Estado global
// ------------------------------------------------------------------ //

let abaAtiva = 'indicadores';
// Dados detalhados de abastecimento (carregados da rota /abastecimento-detalhado)
let _abastDetalhado = null;
let _abastDetalhadoPeriodo = null;
// v3: dados persistidos no Supabase via /api/frota/manut (não mais localStorage)
// localStorage ainda guarda uma cópia local como cache offline
const MANUT_STORAGE_KEY = 'frota_manut_v3';

function manutSalvarCache(dados) {
  try {
    if (dados == null) localStorage.removeItem(MANUT_STORAGE_KEY);
    else localStorage.setItem(MANUT_STORAGE_KEY, JSON.stringify(dados));
  } catch (_) {}
}
function manutCarregarCache() {
  try {
    const raw = localStorage.getItem(MANUT_STORAGE_KEY);
    if (raw) return JSON.parse(raw);
  } catch (_) {}
  return null;
}

// Carrega do servidor; atualiza cache local e _manutDados
async function manutCarregarServidor() {
  try {
    const resp = await api('/frota/manut');
    const dados = resp.registros || [];
    _manutDados = dados;
    manutSalvarCache(dados);
    return dados;
  } catch (err) {
    console.warn('[manut] falha ao carregar do servidor; usando cache local:', err?.message);
    return manutCarregarCache() || [];
  }
}

// Envia novos registros ao servidor; retorna { adicionados, total }
async function manutEnviarServidor(novosRegistros) {
  const resp = await api('/frota/manut', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ registros: novosRegistros }),
  });
  return resp; // { total, mensagem }
}

// Mescla local para preview imediato antes de confirmar no servidor
function manutMesclarLocal(existentes, novos) {
  // Deduplicação pela mesma lógica do servidor (OSM ou placa+data+item)
  function chave(r) {
    if (r.osm) return `osm:${r.osm.trim()}`;
    return `pfdi:${(r.placa||'').trim()}|${(r.data||'').trim()}|${(r.item||'').trim()}`;
  }
  const conhecidos = new Set(existentes.map(chave));
  const adicionados = novos.filter((r) => !conhecidos.has(chave(r)));
  return [...existentes, ...adicionados];
}

let _manutDados = manutCarregarCache();  // inicia com cache; substituído ao carregar do servidor
let _manutFiltros = { mes: '', tipo: '', tipoManut: '', placa: '' };
let _manutBusca = '';
let _manutSortCol = 'data'; let _manutSortDir = 1;
let _manutPagina = 1;
const MANUT_POR_PAG = 20;
let dadosGlobais = null;   // resultado de /api/frota/dados
let periodoAbast = '30dias';

// ------------------------------------------------------------------ //
// Inicialização
// ------------------------------------------------------------------ //

async function iniciar() {
  // Verifica sessão
  let eu;
  try {
    eu = await api('/eu');
  } catch {
    window.location.href = '/frota/login';
    return;
  }

  document.getElementById('nomeUsuario').textContent = eu.nome || eu.email;

  // Botão sair
  document.getElementById('btnSair').addEventListener('click', async () => {
    try {
      const r = await api('/logout');
      window.location.href = r.redirect || '/frota/login';
    } catch {
      window.location.href = '/frota/login';
    }
  });

  // Abas
  document.querySelectorAll('.aba-btn').forEach((btn) => {
    btn.addEventListener('click', () => trocarAba(btn.dataset.aba));
  });

  // Carrega dados
  await carregarDados();
}

async function carregarDados(force = false) {
  mostrarCarregando(true);
  try {
    dadosGlobais = await api('/dados?periodo=' + periodoAbast + (force ? '&force=1' : ''));
    renderizarAba(abaAtiva);
  } catch (err) {
    mostrarErroGlobal(err.message);
  } finally {
    mostrarCarregando(false);
  }
}

function mostrarCarregando(sim) {
  const el = document.getElementById('carregando');
  if (el) el.style.display = sim ? 'flex' : 'none';
}

function mostrarErroGlobal(msg) {
  document.getElementById('conteudo').innerHTML =
    `<div class="estado-global" style="flex-direction:column;gap:.5rem;">
       <span style="font-size:1.5rem">⚠️</span>
       <span style="color:var(--texto)">${esc(msg)}</span>
       <button onclick="carregarDados(true)" style="margin-top:.5rem;padding:.4rem 1rem;border-radius:6px;border:1px solid var(--linha-forte);background:var(--sup);cursor:pointer;font:600 .9rem Barlow,sans-serif;color:var(--laranja-texto);">Tentar novamente</button>
     </div>`;
}

// ------------------------------------------------------------------ //
// Troca de aba
// ------------------------------------------------------------------ //

function trocarAba(nome) {
  abaAtiva = nome;
  document.querySelectorAll('.aba-btn').forEach((b) => {
    const ativa = b.dataset.aba === nome;
    b.classList.toggle('ativa', ativa);
    b.setAttribute('aria-selected', String(ativa));
  });
  if (dadosGlobais) renderizarAba(nome);
}

function renderizarAba(nome) {
  const el = document.getElementById('conteudo');
  // Remove spinner se presente
  const spin = document.getElementById('carregando');
  if (spin) spin.style.display = 'none';

  if (nome === 'indicadores') el.innerHTML = htmlIndicadores(dadosGlobais);
  else if (nome === 'locacao') el.innerHTML = htmlLocacao(dadosGlobais);
  else if (nome === 'abastecimento') { renderAbastecimento(); return; }
  else if (nome === 'manutencao') { renderManutencao().then(() => configurarManutencao()); return; }
  else if (nome === 'rastreamento') el.innerHTML = htmlRastreamento();
}

// ------------------------------------------------------------------ //
// ABA: Indicadores
// ------------------------------------------------------------------ //

function htmlIndicadores(d) {
  const ind = d.indicadores || {};
  const aviso = d.erroVeiculos
    ? `<div class="aviso-erro">⚠️ ${esc(d.erroVeiculos)}</div>` : '';

  // Cards de topo
  const cards = `
    <div class="indicadores-grid">
      ${cardInd('Total de veículos', ind.totalVeiculos ?? '—', '', 'Locados e próprios')}
      ${cardInd('Veículos locados', ind.totalLocados ?? '—', '', '')}
      ${cardInd('Veículos próprios', ind.totalProprios ?? '—', '', '')}
      ${cardInd('Custo de locação', moeda(ind.custoLocacaoMensal), 'laranja', '/mês')}
      ${cardInd('Patrimônio (próprios)', moeda(ind.valorImobilizado), '', 'valor NF')}
    </div>`;

  // Abastecimento (resumo com detalhes se já carregados)
  let abastResumido = '';
  const ab = d.abastecimento;
  if (ab && ab.disponivel !== false) {
    const tot = ab.totalGasto ?? ab.total_gasto ?? ab.totalReais;
    const lit  = ab.totalLitros ?? ab.total_litros;
    const med  = ab.precoMedio  ?? ab.preco_medio;
    // Dados detalhados já carregados?
    const det = (_abastDetalhadoPeriodo === periodoAbast) ? _abastDetalhado : null;
    const kmL  = det?.kmLMedio;
    const topComb = det?.combustiveis?.[0];
    abastResumido = `
      <div class="secao">
        <h3 class="secao-titulo">Abastecimento (${rotulosPeriodo[periodoAbast] || periodoAbast})</h3>
        <div class="indicadores-grid">
          ${tot  != null ? cardInd('Total gasto',   moeda(tot),  'laranja', '') : ''}
          ${lit  != null ? cardInd('Total litros',  num(lit)+' L', '', '') : ''}
          ${med  != null ? cardInd('Preço médio',   moeda(med)+'/L', '', '') : ''}
          ${kmL  != null ? cardInd('Média km/L',    kmL.toFixed(2), kmL < 2 ? 'alerta' : '', 'frota geral') : ''}
          ${topComb      ? cardInd('Mais usado',    topComb.tipo,   '', num(topComb.litros)+' L ('+topComb.pct.toFixed(0)+'%)') : ''}
        </div>
      </div>`;
  }

  // Tipos de veículo
  const porTipo = (ind.porTipo || []);
  const maxTipo = porTipo[0]?.qtd || 1;
  const barrasTipo = porTipo.map((g) =>
    `<div class="grupo-item">
       <span class="grupo-nome">${esc(g.chave)}</span>
       <div class="grupo-barra-wrap"><div class="grupo-barra" style="width:${Math.round(g.qtd/maxTipo*100)}%"></div></div>
       <span class="grupo-qtd">${g.qtd}</span>
     </div>`).join('');

  // Locadoras
  const porLoc = (ind.porLocadora || []);
  const maxLoc = porLoc[0]?.qtd || 1;
  const barrasLoc = porLoc.map((g) =>
    `<div class="grupo-item">
       <span class="grupo-nome">${esc(g.chave)}</span>
       <div class="grupo-barra-wrap"><div class="grupo-barra" style="width:${Math.round(g.qtd/maxLoc*100)}%"></div></div>
       <span class="grupo-qtd">${g.qtd}</span>
     </div>`).join('');

  // Manutenção — resumo dos dados já carregados
  let manutResumido = '';
  if (_manutDados && _manutDados.length) {
    const total = _manutDados.reduce((s, r) => s + r.vt, 0);
    const corr  = _manutDados.filter((r) => r.tipo === 'CORRETIVA').reduce((s, r) => s + r.vt, 0);
    const veics = new Set(_manutDados.map((r) => r.placa)).size;
    const osms  = new Set(_manutDados.map((r) => r.osm)).size;
    manutResumido = `
      <div class="secao">
        <h3 class="secao-titulo">Manutenção (período carregado)</h3>
        <div class="indicadores-grid">
          ${cardInd('Custo total', moeda(total), 'laranja', '')}
          ${cardInd('Manutenção corretiva', moeda(corr), '', ((corr/total)*100).toFixed(1)+'% do total')}
          ${cardInd('Veículos atendidos', veics, '', osms+' OSMs')}
        </div>
      </div>`;
  }

  return `
    ${aviso}
    ${cards}
    ${abastResumido}
    ${manutResumido}
    <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(300px,1fr));gap:1.5rem">
      ${barrasTipo ? `<div class="secao"><h3 class="secao-titulo">Por tipo de veículo</h3><div class="grupo-lista">${barrasTipo}</div></div>` : ''}
      ${barrasLoc  ? `<div class="secao"><h3 class="secao-titulo">Por locadora</h3><div class="grupo-lista">${barrasLoc}</div></div>` : ''}
    </div>`;
}

function cardInd(label, valor, classe, detalhe) {
  return `<div class="ind-card">
    <div class="ind-label">${esc(label)}</div>
    <div class="ind-valor ${esc(classe)}">${esc(String(valor))}</div>
    ${detalhe ? `<div class="ind-detalhe">${esc(detalhe)}</div>` : ''}
  </div>`;
}

// ------------------------------------------------------------------ //
// ABA: Locação
// ------------------------------------------------------------------ //

function htmlLocacao(d) {
  const loc = d.locacao || {};
  const veiculos = loc.veiculos || [];
  const aviso = d.erroVeiculos
    ? `<div class="aviso-erro">⚠️ ${esc(d.erroVeiculos)}</div>` : '';

  if (!veiculos.length) {
    return aviso + '<div class="estado-global">Nenhum veículo locado encontrado.</div>';
  }

  const rows = veiculos.map((v) => `
    <tr>
      <td><strong>${esc(v.placa)}</strong></td>
      <td>${esc(v.marca)} ${esc(v.modelo)}</td>
      <td><span class="chip">${esc(v.tipo)}</span></td>
      <td>${esc(v.ano)}</td>
      <td>${esc(v.combustivel)}</td>
      <td>${esc(v.locadora)}</td>
      <td style="text-align:right;font-weight:600">${v.valorMensal != null ? moeda(v.valorMensal) : '—'}</td>
    </tr>`).join('');

  return `
    ${aviso}
    <div class="secao">
      <h3 class="secao-titulo">Veículos locados (${veiculos.length})</h3>
      <div style="font-size:.88rem;color:var(--texto-2);margin-bottom:.9rem">
        Total mensal: <strong style="color:var(--laranja-texto)">${moeda(loc.custoTotal)}</strong>
      </div>
      <div class="tabela-wrap">
        <table>
          <thead>
            <tr>
              <th>Placa</th><th>Veículo</th><th>Tipo</th>
              <th>Ano</th><th>Combustível</th><th>Locadora</th>
              <th style="text-align:right">Valor/mês</th>
            </tr>
          </thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
    </div>`;
}

// ------------------------------------------------------------------ //
// ABA: Abastecimento
// ------------------------------------------------------------------ //

const rotulosPeriodo = { hoje: 'Hoje', '7dias': 'Últimos 7 dias', '30dias': 'Últimos 30 dias', mes: 'Este mês' };

// Renderiza a aba de abastecimento: mostra dados básicos imediatamente,
// carrega dados detalhados em paralelo (postos, placas, combustíveis, km/L).
async function renderAbastecimento() {
  const el = document.getElementById('conteudo');
  const ab = dadosGlobais?.abastecimento;

  const selPeriodo = `
    <div class="periodo-sel" id="selPeriodo">
      ${['hoje','7dias','30dias','mes'].map((p) =>
        `<button class="periodo-btn${p===periodoAbast?' ativo':''}" data-p="${p}">${rotulosPeriodo[p]}</button>`
      ).join('')}
    </div>`;

  if (!ab || ab.disponivel === false) {
    el.innerHTML = selPeriodo +
      `<div class="aviso-erro">⚠️ ${esc(ab?.motivo || 'Dados de abastecimento indisponíveis.')}</div>`;
    configurarPeriodo();
    return;
  }

  // Exibe cards básicos imediatamente
  const totalGasto  = ab.totalGasto  ?? ab.total_gasto;
  const totalLitros = ab.totalLitros ?? ab.total_litros;
  const precoMedio  = ab.precoMedio  ?? ab.preco_medio;
  const abastCount  = ab.abastecimentos ?? ab.total ?? ab.count;

  el.innerHTML = selPeriodo + `
    <div class="abast-grid" id="abast-cards">
      ${totalGasto  != null ? cardInd('Total gasto',    moeda(totalGasto),     'laranja', '') : ''}
      ${totalLitros != null ? cardInd('Litros totais',  num(totalLitros)+' L', '', '') : ''}
      ${precoMedio  != null ? cardInd('Preço médio',    moeda(precoMedio)+'/L', '', '') : ''}
      ${abastCount  != null ? cardInd('Abastecimentos', num(abastCount),       '', '') : ''}
      <div id="card-kml" class="ind-card"><div class="ind-label">Média km/L</div><div class="ind-valor">carregando…</div></div>
    </div>
    <div id="abast-detalhes"><div class="estado-global" style="font-size:.9rem;color:var(--texto-2)">Carregando detalhes…</div></div>`;

  configurarPeriodo();

  // Busca detalhes no servidor (pode demorar um pouco)
  if (_abastDetalhado && _abastDetalhadoPeriodo === periodoAbast) {
    _renderAbastDetalhes(_abastDetalhado);
  } else {
    try {
      const det = await api('/abastecimento-detalhado?periodo=' + periodoAbast);
      _abastDetalhado = det;
      _abastDetalhadoPeriodo = periodoAbast;
      _renderAbastDetalhes(det);
    } catch (err) {
      const divDet = document.getElementById('abast-detalhes');
      if (divDet) divDet.innerHTML = `<div class="aviso-erro">⚠️ Não foi possível carregar os detalhes: ${esc(err.message)}</div>`;
    }
  }
}

function _renderAbastDetalhes(det) {
  // Atualiza card km/L
  const cardKml = document.getElementById('card-kml');
  if (cardKml) {
    const kmL = det.kmLMedio;
    cardKml.innerHTML = `
      <div class="ind-label">Média km/L</div>
      <div class="ind-valor ${kmL != null && kmL < 2 ? 'alerta' : ''}">${kmL != null ? kmL.toFixed(2) : '—'}</div>
      <div class="ind-detalhe">média de L/abast: ${num(det.mediaLPorAbast)} L</div>`;
  }

  // Monta tabelas
  const tabelaPlacas = det.placas?.length ? `
    <div class="secao">
      <h3 class="secao-titulo">Por placa (${det.placas.length} veículos)</h3>
      <div class="tabela-wrap">
        <table>
          <thead>
            <tr>
              <th>Placa</th>
              <th style="text-align:right">Litros</th>
              <th style="text-align:right">KM rodados</th>
              <th style="text-align:right">km/L</th>
              <th style="text-align:right">Abast.</th>
            </tr>
          </thead>
          <tbody>
            ${det.placas.map((p) => `<tr>
              <td><strong>${esc(p.placa)}</strong></td>
              <td style="text-align:right">${num(p.litros)} L</td>
              <td style="text-align:right">${p.kmRodados > 0 ? num(p.kmRodados)+' km' : '—'}</td>
              <td style="text-align:right${p.kmL != null && p.kmL < 2 ? ';color:var(--alerta)' : ''}">
                ${p.kmL != null ? p.kmL.toFixed(2) : '—'}
              </td>
              <td style="text-align:right">${p.contagem}</td>
            </tr>`).join('')}
          </tbody>
        </table>
      </div>
    </div>` : '';

  const tabelaPostos = det.postos?.length ? `
    <div class="secao">
      <h3 class="secao-titulo">Por posto (${det.postos.length} postos)</h3>
      <div class="tabela-wrap">
        <table>
          <thead><tr><th>Posto</th><th style="text-align:right">Litros</th><th style="text-align:right">Abast.</th></tr></thead>
          <tbody>
            ${det.postos.map((p) => `<tr>
              <td>${esc(p.posto)}</td>
              <td style="text-align:right">${num(p.litros)} L</td>
              <td style="text-align:right">${p.contagem}</td>
            </tr>`).join('')}
          </tbody>
        </table>
      </div>
    </div>` : '';

  // Combustíveis com barra de progresso
  const totalLitrosComb = det.combustiveis?.reduce((s, c) => s + c.litros, 0) || 0;
  const tabelaComb = det.combustiveis?.length ? `
    <div class="secao">
      <h3 class="secao-titulo">Tipo de combustível</h3>
      <div class="grupo-lista">
        ${det.combustiveis.map((c) => `
          <div class="grupo-item">
            <span class="grupo-nome">${esc(c.tipo)}</span>
            <div class="grupo-barra-wrap">
              <div class="grupo-barra" style="width:${c.pct}%"></div>
            </div>
            <span class="grupo-qtd">${num(c.litros)} L (${c.pct.toFixed(1)}%)</span>
          </div>`).join('')}
      </div>
    </div>` : '';

  const divDet = document.getElementById('abast-detalhes');
  if (divDet) divDet.innerHTML = `
    <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(340px,1fr));gap:1.5rem">
      ${tabelaComb}
      ${tabelaPostos}
    </div>
    ${tabelaPlacas}`;
}

function configurarPeriodo() {
  document.querySelectorAll('.periodo-btn').forEach((btn) => {
    btn.addEventListener('click', async () => {
      if (btn.dataset.p === periodoAbast) return;
      periodoAbast = btn.dataset.p;
      _abastDetalhado = null; // invalida cache do período anterior
      // Atualiza visual imediatamente
      document.querySelectorAll('.periodo-btn').forEach((b) => b.classList.toggle('ativo', b.dataset.p === periodoAbast));
      // Busca abastecimento básico e detalhado
      try {
        const ab = await api('/abastecimento?periodo=' + periodoAbast);
        dadosGlobais = { ...dadosGlobais, abastecimento: ab };
        renderizarAba('abastecimento');
      } catch (err) {
        const el = document.getElementById('conteudo');
        if (el) el.insertAdjacentHTML('afterbegin',
          `<div class="aviso-erro">⚠️ ${esc(err.message)}</div>`);
      }
    });
  });
}

// ------------------------------------------------------------------ //
// ABA: Manutenção
// ------------------------------------------------------------------ //

// Extrai "YYYY-MM" de uma data "DD/MM/YYYY HH:MM:SS" ou "DD/MM/YYYY"
function manutMesAno(dataStr) {
  if (!dataStr) return '';
  const m = dataStr.match(/^(\d{2})\/(\d{2})\/(\d{4})/);
  return m ? `${m[3]}-${m[2]}` : '';
}

function manutFiltrados() {
  if (!_manutDados) return [];
  return _manutDados.filter((r) => {
    if (_manutFiltros.mes       && manutMesAno(r.data) !== _manutFiltros.mes) return false;
    if (_manutFiltros.tipo      && r.cat   !== _manutFiltros.tipo)            return false;
    if (_manutFiltros.tipoManut && r.tipo  !== _manutFiltros.tipoManut)       return false;
    if (_manutFiltros.placa     && r.placa !== _manutFiltros.placa)           return false;
    return true;
  });
}

function manutBusca(base) {
  if (!_manutBusca) return base;
  const q = _manutBusca.toLowerCase();
  return base.filter((r) =>
    (r.placa || '').toLowerCase().includes(q) ||
    (r.item  || '').toLowerCase().includes(q) ||
    (r.fornecedor || '').toLowerCase().includes(q) ||
    (r.modelo || '').toLowerCase().includes(q) ||
    (r.regional || '').toLowerCase().includes(q)
  );
}

function manutAgrupar(arr, campo) {
  const acc = {};
  arr.forEach((r) => { const k = r[campo] || '—'; acc[k] = (acc[k] || 0) + r.vt; });
  return Object.entries(acc).sort((a, b) => b[1] - a[1]);
}

function htmlManutencaoShell() {
  // HTML estático — preenchido via JS depois
  const temDados = !!(_manutDados && _manutDados.length);
  const uploadCard = `
    <div id="manut-upload-card" style="
      background:var(--sup); border:2px dashed var(--linha-forte);
      border-radius:var(--raio); padding:1rem 1.25rem;
      display:flex; align-items:center; gap:1rem; flex-wrap:wrap;
      margin-bottom:1.25rem;
      ${temDados ? 'border-style:solid;border-color:var(--ok);' : ''}
    ">
      <span style="font-size:1.5rem">${temDados ? '✅' : '📂'}</span>
      <div style="flex:1;min-width:200px">
        <div style="font-size:.88rem;font-weight:600;color:var(--texto);margin-bottom:.2rem">
          ${temDados
            ? `Dados carregados — ${_manutDados.length} registros`
            : 'Importar planilha de manutenção'}
        </div>
        <div style="font-size:.78rem;color:var(--texto-3)">
          ${temDados
            ? 'Para atualizar, selecione um novo arquivo CSV.'
            : 'Selecione o arquivo CSV exportado do sistema de manutenção.'}
        </div>
      </div>
      <label for="manut-csv-input" style="
        display:inline-flex; align-items:center; gap:.4rem;
        background:var(--laranja); color:var(--sobre-laranja);
        padding:.45rem 1rem; border-radius:var(--raio-p);
        font:600 .85rem var(--f-texto); cursor:pointer;
        white-space:nowrap;
      ">
        📄 ${temDados ? 'Trocar arquivo' : 'Selecionar arquivo'}
      </label>
      <input type="file" id="manut-csv-input" accept=".csv,.xlsx" style="display:none">
      ${temDados ? `<button id="mbtn-limpar-dados" style="
        display:inline-flex; align-items:center; gap:.4rem;
        background:transparent; color:var(--alerta);
        border:1px solid var(--alerta); border-radius:var(--raio-p);
        padding:.45rem 1rem; font:600 .85rem var(--f-texto); cursor:pointer;
        white-space:nowrap; transition:background var(--transicao);
      " onmouseover="this.style.background='var(--alerta-fundo)'" onmouseout="this.style.background='transparent'">
        🗑 Limpar dados
      </button>` : ''}
      <span id="manut-csv-status" style="font-size:.8rem;color:var(--ok);font-weight:600"></span>
    </div>`;

  return uploadCard + `
    <!-- Filtros -->
    <div class="manut-filtros" id="mfiltros">
      <div class="manut-filtro-grupo">
        <span class="manut-filtro-label">Mês</span>
        <select class="manut-sel" id="mf-mes"><option value="">Todos</option></select>
      </div>
      <div class="manut-filtro-grupo">
        <span class="manut-filtro-label">Tipo</span>
        <select class="manut-sel" id="mf-tipo">
          <option value="">Todos</option>
          <option value="Peça">Peça</option>
          <option value="Serviço">Serviço</option>
        </select>
      </div>
      <div class="manut-filtro-grupo">
        <span class="manut-filtro-label">Tipo de Manutenção</span>
        <select class="manut-sel" id="mf-tipoManut">
          <option value="">Todos</option>
          <option value="CORRETIVA">Corretiva</option>
          <option value="PREVENTIVA">Preventiva</option>
          <option value="PREDITIVA">Preditiva</option>
        </select>
      </div>
      <div class="manut-filtro-grupo">
        <span class="manut-filtro-label">Placa do Veículo</span>
        <select class="manut-sel" id="mf-placa"><option value="">Todas</option></select>
      </div>
      <div class="manut-filtro-grupo" style="flex:1;min-width:200px">
        <span class="manut-filtro-label">Pesquisar</span>
        <input class="manut-busca" id="mbusca-filtro" type="search"
          placeholder="Descrição, fornecedor, OSM…"
          style="width:100%;box-sizing:border-box;height:32px">
      </div>
      <button class="btn-limpar-manut" id="mbtn-limpar" style="align-self:flex-end">✕ Limpar</button>
    </div>

    <!-- Sub-abas -->
    <div class="manut-abas">
      <button class="manut-aba-btn ativa" data-maba="visao">Visão Geral</button>
      <button class="manut-aba-btn" data-maba="veiculos">Por Veículo</button>
      <button class="manut-aba-btn" data-maba="fornecedores">Fornecedores</button>
      <button class="manut-aba-btn" data-maba="detalhe">Detalhamento</button>
    </div>

    <!-- ── Sub-aba: Visão Geral ── -->
    <div class="manut-painel ativo" id="maba-visao">
      <div class="indicadores-grid" id="mkpi-grid"></div>
      <div class="charts-grid-manut">
        <div class="chart-card-manut">
          <div class="chart-titulo-manut">Corretiva × Preventiva</div>
          <div style="height:200px;position:relative"><canvas id="mchart-tipo"></canvas></div>
        </div>
        <div class="chart-card-manut">
          <div class="chart-titulo-manut">Peça × Serviço</div>
          <div style="height:200px;position:relative"><canvas id="mchart-cat"></canvas></div>
        </div>
        <div class="chart-card-manut">
          <div class="chart-titulo-manut">Por Regional</div>
          <div style="height:200px;position:relative"><canvas id="mchart-contr"></canvas></div>
        </div>
        <div class="chart-card-manut">
          <div class="chart-titulo-manut">Por Modelo de Veículo</div>
          <div style="height:200px;position:relative"><canvas id="mchart-cc"></canvas></div>
        </div>
      </div>
    </div>

    <!-- ── Sub-aba: Por Veículo ── -->
    <div class="manut-painel" id="maba-veiculos">
      <div class="chart-card-manut" style="margin-bottom:1.25rem">
        <div class="chart-titulo-manut">Custo por veículo (R$)</div>
        <div id="mchart-veic-wrap" style="position:relative"><canvas id="mchart-veic"></canvas></div>
      </div>
      <div class="chart-card-manut" style="margin-bottom:1.25rem">
        <div class="chart-titulo-manut">Custo por modelo (R$)</div>
        <div id="mchart-modelo-wrap" style="position:relative"><canvas id="mchart-modelo"></canvas></div>
      </div>
      <div class="chart-card-manut">
        <div class="chart-titulo-manut">Top itens (ocorrências)</div>
        <div id="mchart-itens-wrap" style="position:relative"><canvas id="mchart-itens"></canvas></div>
      </div>
    </div>

    <!-- ── Sub-aba: Fornecedores ── -->
    <div class="manut-painel" id="maba-fornecedores">
      <div class="chart-card-manut">
        <div class="chart-titulo-manut">Gasto por fornecedor (R$)</div>
        <div style="height:320px;position:relative"><canvas id="mchart-forn"></canvas></div>
      </div>
    </div>

    <!-- ── Sub-aba: Detalhamento ── -->
    <div class="manut-painel" id="maba-detalhe">
      <div class="secao" style="margin-bottom:0">

        <!-- Cabeçalho com contagem e total -->
        <div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:.5rem;margin-bottom:.6rem">
          <span id="mtab-titulo" style="font:700 .9rem var(--f-titulo);color:var(--texto-2)">Registros</span>
          <span id="mtab-total" style="font:700 1rem var(--f-titulo);color:var(--laranja-texto)"></span>
        </div>

        <div class="tabela-wrap">
          <table>
            <thead>
              <tr>
                <th data-col="data">Data</th>
                <th data-col="item">Descrição</th>
                <th data-col="fornecedor">Fornecedor</th>
                <th data-col="qtd" style="text-align:right">Qtd</th>
                <th data-col="vu"  style="text-align:right">Valor Unit.</th>
                <th data-col="vt"  style="text-align:right">Total</th>
              </tr>
            </thead>
            <tbody id="mtabela-body"></tbody>
            <tfoot id="mtabela-tfoot"></tfoot>
          </table>
        </div>
        <div class="manut-pag">
          <span id="mpag-info">–</span>
          <button class="manut-pag-btn" id="mpag-prev">‹ Anterior</button>
          <button class="manut-pag-btn" id="mpag-next">Próximo ›</button>
        </div>
      </div>
    </div>

    `;
}

function popularSelectsManut() {
  if (!_manutDados) return;
  const uniq = (campo) => [...new Set(_manutDados.map((r) => r[campo]))].filter(Boolean).sort();
  const preencherSel = (id, vals) => {
    const el = document.getElementById(id);
    if (!el) return;
    const val = el.value;
    // limpa opções extras
    while (el.options.length > 1) el.remove(1);
    vals.forEach((v) => { const o = document.createElement('option'); o.value = v; o.textContent = v; el.appendChild(o); });
    el.value = val;
  };
  preencherSel('mf-placa', uniq('placa'));

  // Meses únicos ordenados, exibidos como "MMM/YYYY" mas valor "YYYY-MM"
  const MESES_PT = ['Jan','Fev','Mar','Abr','Mai','Jun','Jul','Ago','Set','Out','Nov','Dez'];
  const mesesUniq = [...new Set(_manutDados.map((r) => manutMesAno(r.data)))]
    .filter(Boolean).sort();
  const selMes = document.getElementById('mf-mes');
  if (selMes) {
    selMes.innerHTML = '<option value="">Todos</option>' +
      mesesUniq.map((ym) => {
        const [ano, m] = ym.split('-');
        const label = `${MESES_PT[parseInt(m, 10) - 1]}/${ano}`;
        return `<option value="${ym}">${label}</option>`;
      }).join('');
    selMes.value = _manutFiltros.mes || '';
  }
}

function renderManutKPIs(df) {
  const total = df.reduce((s, r) => s + r.vt, 0);
  const corr  = df.filter((r) => r.tipo === 'CORRETIVA').reduce((s, r) => s + r.vt, 0);
  const prev  = df.filter((r) => r.tipo === 'PREVENTIVA').reduce((s, r) => s + r.vt, 0);
  const pred  = df.filter((r) => r.tipo === 'PREDITIVA').reduce((s, r) => s + r.vt, 0);
  const osms  = new Set(df.map((r) => r.osm)).size;
  const veics = new Set(df.map((r) => r.placa)).size;
  const pct   = (a, t) => t ? ((a / t) * 100).toFixed(1) + '%' : '0%';
  const el    = document.getElementById('mkpi-grid');
  if (!el) return;
  el.innerHTML = `
    ${cardInd('Custo Total',   moeda(total), 'laranja', df.length + ' itens · ' + osms + ' OSMs')}
    ${cardInd('Corretiva',     moeda(corr),  '', pct(corr, total) + ' do total')}
    ${cardInd('Preventiva',    moeda(prev),  '', pct(prev, total) + ' do total')}
    ${pred ? cardInd('Preditiva', moeda(pred), '', pct(pred, total) + ' do total') : cardInd('Veículos', veics, '', 'atendidos no período')}
    ${cardInd('Custo/Veículo', veics ? moeda(total / veics) : '—', '', 'média por veículo')}
    ${cardInd('Peças', pct(df.filter((r) => r.cat === 'Peça').reduce((s, r) => s + r.vt, 0), total), '', 'do total em peças')}
  `;
}

function renderManutCharts(df) {
  const corr = df.filter((r) => r.tipo === 'CORRETIVA').reduce((s, r) => s + r.vt, 0);
  const prev = df.filter((r) => r.tipo === 'PREVENTIVA').reduce((s, r) => s + r.vt, 0);
  const pred = df.filter((r) => r.tipo === 'PREDITIVA').reduce((s, r) => s + r.vt, 0);
  const labTipo = pred > 0 ? ['Corretiva', 'Preventiva', 'Preditiva'] : ['Corretiva', 'Preventiva'];
  const valTipo = pred > 0 ? [corr, prev, pred] : [corr, prev];
  const corTipo = pred > 0 ? ['#BE123C', '#047857', '#1D4ED8'] : ['#BE123C', '#047857'];
  criarChart('mchart-tipo', optsDonut(labTipo, valTipo, corTipo));

  const peca = df.filter((r) => r.cat === 'Peça').reduce((s, r) => s + r.vt, 0);
  const serv = df.filter((r) => r.cat === 'Serviço').reduce((s, r) => s + r.vt, 0);
  criarChart('mchart-cat', optsDonut(['Peça', 'Serviço'], [peca, serv], ['#F7931E', '#1E3A8A']));

  // Por Regional — barras verticais com rótulos
  const grpReg = manutAgrupar(df, 'regional');
  criarChart('mchart-contr', optsBarVert(
    grpReg.map((x) => x[0]),
    grpReg.map((x) => x[1]),
    grpReg.map((_, i) => PAL_GRAFICO[i % PAL_GRAFICO.length])
  ));

  // Por Modelo de Veículo — donut colorido
  const grpM2 = manutAgrupar(df, 'modelo').slice(0, 8);
  criarChart('mchart-cc', optsDonut(
    grpM2.map((x) => x[0]),
    grpM2.map((x) => x[1]),
    ['#7C3AED', '#0D9488', '#B45309', '#1E3A8A', '#F7931E', '#BE123C', '#047857', '#1D4ED8']
  ));

  // Por veículo — barras horizontais com rótulos; altura proporcional ao nº de itens
  const grpV = manutAgrupar(df, 'placa').slice(0, 30);
  const altVeic = Math.max(260, grpV.length * 32 + 60);
  document.getElementById('mchart-veic-wrap').style.height = altVeic + 'px';
  criarChart('mchart-veic', optsBarHoriz(
    grpV.map((x) => x[0]),
    grpV.map((x) => x[1]),
    grpV.map((_, i) => i === 0 ? '#F7931E' : PAL_GRAFICO[i % PAL_GRAFICO.length] + 'cc')
  ));

  // Por modelo — barras horizontais, altura proporcional
  const grpM = manutAgrupar(df, 'modelo').slice(0, 10);
  const altModelo = Math.max(200, grpM.length * 32 + 60);
  document.getElementById('mchart-modelo-wrap').style.height = altModelo + 'px';
  criarChart('mchart-modelo', optsBarHoriz(grpM.map((x) => x[0]), grpM.map((x) => x[1]),
    grpM.map((_, i) => PAL_GRAFICO[i % PAL_GRAFICO.length] + 'cc')));

  // Top itens — barras horizontais com contagem + rótulo; altura proporcional
  const acc = {};
  df.forEach((r) => { const k = r.item || '—'; acc[k] = (acc[k] || 0) + 1; });
  const grpI = Object.entries(acc).sort((a, b) => b[1] - a[1]).slice(0, 10);
  const altItens = Math.max(200, grpI.length * 32 + 60);
  document.getElementById('mchart-itens-wrap').style.height = altItens + 'px';
  criarChart('mchart-itens', {
    type: 'bar',
    data: { labels: grpI.map((x) => x[0].length > 28 ? x[0].slice(0, 26) + '…' : x[0]),
            datasets: [{ data: grpI.map((x) => x[1]), backgroundColor: '#1E3A8A', borderRadius: 4 }] },
    options: {
      indexAxis: 'y',
      responsive: true, maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        datalabels: {
          display: true,
          anchor: 'end', align: 'end', offset: 4,
          color: rzVar('--texto-2'), font: { family: 'Barlow', size: 10, weight: '600' },
          formatter: (v) => v + 'x',
          clamp: true,
          clip: false,
        },
        tooltip: { callbacks: { label: (ctx) => ` ${ctx.parsed.x} ocorrência(s)` } }
      },
      layout: { padding: { right: 48 } },
      scales: {
        x: { ticks: { color: rzVar('--texto-3'), font: { family: 'Barlow', size: 11 } }, grid: { color: rzVar('--linha') } },
        y: { ticks: { color: rzVar('--texto-3'), font: { family: 'Barlow', size: 11 } }, grid: { color: rzVar('--linha') } }
      }
    }
  });

  // Por fornecedor — barras horizontais com rótulos
  const grpF = manutAgrupar(df, 'fornecedor').slice(0, 12);
  criarChart('mchart-forn', optsBarHoriz(
    grpF.map((x) => x[0]),
    grpF.map((x) => x[1]),
    grpF.map((_, i) => PAL_GRAFICO[i % PAL_GRAFICO.length] + 'dd')
  ));
}

function renderManutTabela(df) {
  const base = manutBusca(df);

  const sorted = [...base].sort((a, b) => {
    const va = a[_manutSortCol] ?? ''; const vb = b[_manutSortCol] ?? '';
    if (typeof va === 'number') return (va - vb) * _manutSortDir;
    return va.toString().localeCompare(vb.toString(), 'pt-BR') * _manutSortDir;
  });

  const totalRegs  = sorted.length;
  const totalValor = sorted.reduce((s, r) => s + r.vt, 0);
  const ini  = (_manutPagina - 1) * MANUT_POR_PAG;
  const fim  = Math.min(ini + MANUT_POR_PAG, totalRegs);
  const pags = sorted.slice(ini, fim);

  const tit   = document.getElementById('mtab-titulo');
  const tot   = document.getElementById('mtab-total');
  const info  = document.getElementById('mpag-info');
  const prev  = document.getElementById('mpag-prev');
  const next  = document.getElementById('mpag-next');
  const tfoot = document.getElementById('mtabela-tfoot');

  if (tit)  tit.textContent  = `${totalRegs} registro(s)`;
  if (tot)  tot.textContent  = totalRegs ? `Total: ${moeda(totalValor)}` : '';
  if (info) info.textContent = `${totalRegs ? ini + 1 : 0}–${fim} de ${totalRegs}`;
  if (prev) prev.disabled    = _manutPagina <= 1;
  if (next) next.disabled    = fim >= totalRegs;

  const tbody = document.getElementById('mtabela-body');
  if (!tbody) return;

  const fmtQtd = (v) => v ? v.toLocaleString('pt-BR', { maximumFractionDigits: 2 }) : '—';

  tbody.innerHTML = pags.map((r) => `
    <tr>
      <td style="white-space:nowrap">${esc(r.data || '—')}</td>
      <td>${esc(r.item || '—')}</td>
      <td>${esc(r.fornecedor || '—')}</td>
      <td style="text-align:right">${fmtQtd(r.qtd)}</td>
      <td style="text-align:right;white-space:nowrap">${r.vu ? moeda(r.vu) : '—'}</td>
      <td style="text-align:right;font-weight:600;white-space:nowrap">${moeda(r.vt)}</td>
    </tr>`).join('') ||
    `<tr><td colspan="6" style="text-align:center;padding:1.5rem;color:var(--texto-3)">Nenhum registro encontrado.</td></tr>`;

  // Linha de total no rodapé da tabela
  if (tfoot) {
    tfoot.innerHTML = totalRegs ? `
      <tr style="border-top:2px solid var(--linha-forte)">
        <td colspan="5" style="font-weight:700;color:var(--texto-2);padding:.6rem .75rem">
          Total (${totalRegs} registros)
        </td>
        <td style="text-align:right;font-weight:800;color:var(--laranja-texto);padding:.6rem .75rem;white-space:nowrap">
          ${moeda(totalValor)}
        </td>
      </tr>` : '';
  }
}

function atualizarManut() {
  const df = manutFiltrados();
  renderManutKPIs(df);
  renderManutCharts(df);
  _manutPagina = 1;
  renderManutTabela(df);
  // Atualiza cards da aba Indicadores se estiver renderizada
  if (abaAtiva === 'indicadores') renderizarAba('indicadores');
}

async function renderManutencao() {
  const el = document.getElementById('conteudo');
  el.innerHTML = htmlManutencaoShell();
  popularSelectsManut();

  if (_manutDados && _manutDados.length) {
    // Exibe cache local imediatamente enquanto busca atualização do servidor
    atualizarManut();
  } else {
    document.getElementById('mkpi-grid').innerHTML =
      `<div style="grid-column:1/-1;padding:1.5rem;text-align:center;color:var(--texto-3);font-size:.9rem">
         Carregando dados…
       </div>`;
  }

  // Carrega (ou atualiza) do servidor em background
  const dadosServidor = await manutCarregarServidor();
  if (dadosServidor.length) {
    _manutDados = dadosServidor;
    popularSelectsManut();
    atualizarManut();
  } else if (!(_manutDados && _manutDados.length)) {
    document.getElementById('mkpi-grid').innerHTML =
      `<div style="grid-column:1/-1;padding:1.5rem;text-align:center;color:var(--texto-3);font-size:.9rem">
         Importe o arquivo CSV do sistema de manutenção para visualizar os indicadores.
       </div>`;
  }
}

function configurarManutencao() {
  // Filtros (selects)
  [['mf-mes', 'mes'], ['mf-tipo', 'tipo'], ['mf-tipoManut', 'tipoManut'], ['mf-placa', 'placa']].forEach(([id, chave]) => {
    const el = document.getElementById(id);
    if (!el) return;
    el.value = _manutFiltros[chave] || '';
    el.addEventListener('change', (e) => {
      _manutFiltros[chave] = e.target.value;
      _manutPagina = 1;
      atualizarManut();
    });
  });

  document.getElementById('mbtn-limpar')?.addEventListener('click', () => {
    _manutFiltros = { mes: '', tipo: '', tipoManut: '', placa: '' };
    _manutBusca = '';
    ['mf-mes', 'mf-tipo', 'mf-tipoManut', 'mf-placa'].forEach((id) => {
      const el = document.getElementById(id);
      if (el) el.value = '';
    });
    const b = document.getElementById('mbusca-filtro');
    if (b) b.value = '';
    atualizarManut();
  });

  // Campo de pesquisa global
  document.getElementById('mbusca-filtro')?.addEventListener('input', (e) => {
    _manutBusca = e.target.value;
    _manutPagina = 1;
    atualizarManut();
  });

  // Paginação
  document.getElementById('mpag-prev')?.addEventListener('click', () => {
    if (_manutPagina > 1) { _manutPagina--; renderManutTabela(manutFiltrados()); }
  });
  document.getElementById('mpag-next')?.addEventListener('click', () => {
    _manutPagina++; renderManutTabela(manutFiltrados());
  });

  // Ordenação
  document.querySelectorAll('thead th[data-col]').forEach((th) => {
    th.addEventListener('click', () => {
      const col = th.dataset.col;
      if (_manutSortCol === col) _manutSortDir *= -1;
      else { _manutSortCol = col; _manutSortDir = 1; }
      renderManutTabela(manutFiltrados());
    });
  });

  // Sub-abas
  document.querySelectorAll('.manut-aba-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.manut-aba-btn').forEach((b) => b.classList.remove('ativa'));
      document.querySelectorAll('.manut-painel').forEach((p) => p.classList.remove('ativo'));
      btn.classList.add('ativa');
      document.getElementById('maba-' + btn.dataset.maba)?.classList.add('ativo');
    });
  });

  // Upload CSV
  document.getElementById('manut-csv-input')?.addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const status = document.getElementById('manut-csv-status');
    if (status) status.textContent = 'Lendo arquivo…';
    try {
      const text = await file.text();
      const novos = parsearCsvManut(text);
      if (!novos.length) {
        if (status) status.textContent = '✗ Arquivo sem registros reconhecidos.';
        return;
      }

      // Mescla local para preview imediato
      const anteriores = _manutDados || [];
      const mesclado = manutMesclarLocal(anteriores, novos);
      const adicionadosLocal = mesclado.length - anteriores.length;

      if (adicionadosLocal === 0) {
        if (status) status.textContent = `✓ Nenhum registro novo — ${anteriores.length} registros no total`;
        return;
      }

      // Exibe imediatamente no painel
      _manutDados = mesclado;
      manutSalvarCache(mesclado);
      popularSelectsManut();
      atualizarManut();
      if (status) status.textContent = `Salvando ${adicionadosLocal} registros novos no servidor…`;

      // Envia apenas os novos ao servidor
      const novosParaEnviar = mesclado.slice(anteriores.length); // os que foram acrescentados
      try {
        const resp = await manutEnviarServidor(novosParaEnviar);
        if (status) status.textContent =
          `✓ ${adicionadosLocal} novos registros salvos (total no servidor: ${resp.total})`;
        // Recarrega do servidor para garantir consistência
        const atualizado = await manutCarregarServidor();
        if (atualizado.length) { _manutDados = atualizado; popularSelectsManut(); atualizarManut(); }
      } catch (errSrv) {
        console.error('[manut] erro ao salvar no servidor:', errSrv?.message);
        if (status) status.textContent =
          `⚠ Exibido localmente mas não foi possível salvar no servidor. Tente novamente.`;
      }
    } catch (err) {
      if (status) status.textContent = '✗ Erro ao ler arquivo';
      console.error('CSV manutenção:', err);
    }
    // Limpa o input para permitir re-enviar o mesmo arquivo
    e.target.value = '';
  });

  // Limpar todos os dados de manutenção (apaga no servidor também)
  document.getElementById('mbtn-limpar-dados')?.addEventListener('click', async () => {
    if (!confirm('Tem certeza? Todos os registros de manutenção serão removidos do servidor e não poderão ser recuperados.')) return;
    const status = document.getElementById('manut-csv-status');
    if (status) status.textContent = 'Apagando…';
    try {
      await api('/frota/manut', { method: 'DELETE' });
      _manutDados = null;
      manutSalvarCache(null);
      if (status) status.textContent = 'Histórico apagado.';
      await renderManutencao();
      configurarManutencao();
    } catch (err) {
      if (status) status.textContent = '✗ Erro ao apagar dados no servidor.';
      console.error('[manut] apagar:', err?.message);
    }
  });

  // Atualiza cores quando o tema muda
  document.documentElement.addEventListener('rz:tema', atualizarCoresCharts);
}

// Normaliza o campo 'tipo' do CSV (Materiais/Peças → 'Peça', Serviço → 'Serviço')
function normalizarCat(raw) {
  const v = (raw || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().trim();
  if (v.includes('PE') || v.startsWith('MA') || v === 'P') return 'Peça';
  if (v.startsWith('SE') || v === 'S') return 'Serviço';
  return (raw || '').trim() || '—';
}

// Parser CSV RFC-4180 completo: respeita campos entre aspas com ; e \n dentro
function parseCsvRFC(text, delim) {
  const registros = [];
  let campo = '';
  let campos = [];
  let dentroAspas = false;
  let i = 0;
  while (i < text.length) {
    const ch = text[i];
    if (dentroAspas) {
      if (ch === '"') {
        // aspas duplas dentro de campo = aspas literal
        if (text[i + 1] === '"') { campo += '"'; i += 2; continue; }
        dentroAspas = false;
      } else {
        campo += ch;
      }
    } else {
      if (ch === '"') {
        dentroAspas = true;
      } else if (ch === delim) {
        campos.push(campo.trim());
        campo = '';
      } else if (ch === '\r' && text[i + 1] === '\n') {
        campos.push(campo.trim());
        campo = '';
        registros.push(campos);
        campos = [];
        i += 2; continue;
      } else if (ch === '\n') {
        campos.push(campo.trim());
        campo = '';
        registros.push(campos);
        campos = [];
      } else {
        campo += ch;
      }
    }
    i++;
  }
  // última linha sem \n final
  if (campo.trim() || campos.length) {
    campos.push(campo.trim());
    if (campos.some(c => c)) registros.push(campos);
  }
  return registros;
}

function parsearCsvManut(text) {
  // Remove BOM UTF-8 se presente
  const limpo = text.replace(/^﻿/, '');

  // Detecta delimitador (CSV real usa ';')
  const delim = limpo.includes(';') ? ';' : ',';

  // Parse correto respeitando aspas e quebras de linha dentro de campos
  const registros = parseCsvRFC(limpo, delim);
  if (registros.length < 2) return [];

  const cabecalho = registros[0].map((c) => c.replace(/"/g, '').trim());
  const idx = (nomes) => {
    for (const n of nomes) {
      const i = cabecalho.findIndex((c) => c.toLowerCase() === n.toLowerCase());
      if (i >= 0) return i;
    }
    return -1;
  };

  // Colunas do arquivo real exportado pelo GPM
  const cols = {
    osm:        idx(['cod_osme_osm', 'cod_osm', 'osm']),
    placa:      idx(['cod_placa_vei', 'placa']),
    modelo:     idx(['des_mod_veic_mdv', 'modelo_veiculo', 'modelo']),
    regional:   idx(['des_cent_cus_ccu', 'centro_custo', 'cc']),
    fornecedor: idx(['oficina_fornecedor', 'fornecedor']),
    tipo:       idx(['tipo_manuntencao', 'tipo_manutencao', 'tipo_manut']),  // CORRETIVA / PREVENTIVA / PREDITIVA
    cat:        idx(['tipo', 'categoria_item', 'categoria']),                // Materiais/Peças ou Serviço
    item:       idx(['descricao', 'des_item', 'item']),
    data:       idx(['dtae', 'data_manutencao', 'data']),
    qtd:        idx(['qtd', 'quantidade']),
    vu:         idx(['valor', 'valor_unitario', 'vr_unit']),
    vt:         idx(['total', 'valor_total']),
  };

  const parseBR = (s) => parseFloat((s || '0').replace(/\./g, '').replace(',', '.')) || 0;
  const rows = [];
  for (let i = 1; i < registros.length; i++) {
    const campos = registros[i];
    const get = (c) => (c >= 0 && c < campos.length ? campos[c] || '' : '');
    if (!get(cols.osm) && !get(cols.placa)) continue; // linha vazia / fragmento
    rows.push({
      osm:        get(cols.osm),
      placa:      get(cols.placa).toUpperCase(),
      modelo:     get(cols.modelo),
      regional:   get(cols.regional),
      fornecedor: get(cols.fornecedor),
      tipo:       get(cols.tipo).toUpperCase().trim(),  // CORRETIVA / PREVENTIVA / PREDITIVA
      cat:        normalizarCat(get(cols.cat)),          // Peça ou Serviço
      item:       get(cols.item),
      data:       get(cols.data),
      qtd:        parseBR(get(cols.qtd)),
      vu:         parseBR(get(cols.vu)),
      vt:         parseBR(get(cols.vt)),
    });
  }
  return rows;
}

// ------------------------------------------------------------------ //
// ABA: Rastreamento
// ------------------------------------------------------------------ //

function htmlRastreamento() {
  return `
    <div class="rast-promo">
      <h2>🗺️ Rastreamento da Frota</h2>
      <p>Análise de viagens fora do horário, motor ligado parado, histórico por veículo e evidências — tudo em uma tela dedicada.</p>
      <ul>
        <li>Viagens fora do expediente (seg–sex 08h–19h, sáb 08h–12h)</li>
        <li>Motor ligado parado por mais de 5 minutos</li>
        <li>Custo estimado de ociosidade (L/h configurável)</li>
        <li>Histórico completo com evidências por importação</li>
      </ul>
      <a class="btn-primario" href="/rastreamento" target="_blank">
        Abrir Rastreamento →
      </a>
    </div>`;
}

// ------------------------------------------------------------------ //
// Arranque
// ------------------------------------------------------------------ //
iniciar().catch(console.error);
