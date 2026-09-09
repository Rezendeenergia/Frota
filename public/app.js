// Front-end da TV — sem build step, direto no navegador.
// Busca /api/painel, renderiza as 3 colunas e se mantém viva por longos
// períodos (relógio, re-fetch periódico e reload de segurança).

const REFRESH_MS = 5 * 60 * 1000;       // TV pergunta a cada 5 min...
const RELOAD_SAFETY_MS = 6 * 60 * 60 * 1000; // ...mas recarrega a página inteira a cada 6h (evita vazamento de memória em sessão infinita)
const STALE_AFTER_MS = 45 * 60 * 1000;  // se o payload for mais velho que isso, mostra aviso

// Cor única para todas as barras de gráfico do painel (Manutenção,
// Abastecimento e bombonas) — pedido do presidente, substitui o antigo
// esquema de cor por posição (1º/2º/3º lugar).
const BAR_COLOR = '#f7931e';

function fmtBRL(n) {
  if (n === null || n === undefined || Number.isNaN(n)) return '—';
  return n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 });
}

function fmtNum(n, opts = {}) {
  if (n === null || n === undefined || Number.isNaN(n)) return '—';
  return n.toLocaleString('pt-BR', opts);
}

function fmtDias(n) {
  if (n === null || n === undefined || Number.isNaN(n)) return '—';
  return `${n.toLocaleString('pt-BR', { maximumFractionDigits: 1 })} dia${n >= 2 ? 's' : ''}`;
}

function el(tag, attrs = {}, children = []) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') node.className = v;
    else if (k === 'html') node.innerHTML = v;
    else node.setAttribute(k, v);
  }
  for (const c of [].concat(children)) {
    if (c === null || c === undefined) continue;
    node.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
  }
  return node;
}

function kpiTile(label, value, foot) {
  return el('div', { class: 'kpi-tile' }, [
    el('div', { class: 'label' }, label),
    el('div', { class: 'value' }, value),
    foot ? el('div', { class: 'foot' }, foot) : null,
  ]);
}

function miniBars(title, rows, valueFmt = fmtBRL) {
  const max = Math.max(1, ...rows.map((r) => r.custo ?? r.litros ?? 0));
  const wrap = el('div', {}, [el('div', { class: 'mini-title' }, title)]);
  const list = el('div', { class: 'mini-bars' });
  rows.slice(0, 5).forEach((r) => {
    const val = r.custo ?? r.litros ?? 0;
    const pct = Math.max(4, Math.round((val / max) * 100));
    list.appendChild(
      el('div', { class: 'mini-row' }, [
        el('div', { class: 'rl', title: r.chave }, r.chave),
        el('div', { class: 'mini-track' }, [
          el('div', { class: 'mini-fill', style: `width:${pct}%; background:${BAR_COLOR}` }),
        ]),
        el('div', { class: 'rv' }, valueFmt(val)),
      ])
    );
  });
  if (!rows.length) {
    list.appendChild(el('div', { class: 'foot' }, 'Sem dados no período.'));
  }
  wrap.appendChild(list);
  return wrap;
}

// Gráfico de linha bem pequeno (cabe dentro de um kpi-tile) — usado hoje só
// para "custo total por mês" no card de Abastecimento, mas serve pra
// qualquer série {mes/rótulo, custo}. Sem libs — SVG puro.
function miniLineChart(rows) {
  const width = 160;
  const height = 44;
  const pad = 4;
  const svgNS = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(svgNS, 'svg');
  svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
  svg.setAttribute('preserveAspectRatio', 'none');
  svg.setAttribute('class', 'mini-linechart');

  const vals = rows.map((r) => r.custo ?? 0);
  if (!rows.length || !vals.some((v) => v > 0)) return svg;

  const max = Math.max(1, ...vals);
  const stepX = rows.length > 1 ? (width - pad * 2) / (rows.length - 1) : 0;
  const points = rows.map((r, i) => {
    const x = pad + i * stepX;
    const y = height - pad - ((r.custo ?? 0) / max) * (height - pad * 2);
    return [x, y];
  });

  const pathD = points.map(([x, y], i) => `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`).join(' ');
  const baseline = height - pad;
  const areaD = `${pathD} L${points[points.length - 1][0].toFixed(1)},${baseline} L${points[0][0].toFixed(1)},${baseline} Z`;

  const area = document.createElementNS(svgNS, 'path');
  area.setAttribute('d', areaD);
  area.setAttribute('fill', 'rgba(247,147,30,0.16)');
  area.setAttribute('stroke', 'none');
  svg.appendChild(area);

  const line = document.createElementNS(svgNS, 'path');
  line.setAttribute('d', pathD);
  line.setAttribute('fill', 'none');
  line.setAttribute('stroke', BAR_COLOR);
  line.setAttribute('stroke-width', '2');
  line.setAttribute('stroke-linecap', 'round');
  line.setAttribute('stroke-linejoin', 'round');
  svg.appendChild(line);

  const [lastX, lastY] = points[points.length - 1];
  const dot = document.createElementNS(svgNS, 'circle');
  dot.setAttribute('cx', lastX.toFixed(1));
  dot.setAttribute('cy', lastY.toFixed(1));
  dot.setAttribute('r', '2.6');
  dot.setAttribute('fill', BAR_COLOR);
  svg.appendChild(dot);

  return svg;
}

function chartTile(label, rows, foot) {
  const tile = el('div', { class: 'kpi-tile chart-tile' }, [el('div', { class: 'label' }, label)]);
  tile.appendChild(miniLineChart(rows));
  if (foot) tile.appendChild(el('div', { class: 'foot' }, foot));
  return tile;
}

function emptyState(icon, title, desc) {
  return el('div', { class: 'empty-state' }, [
    el('div', { class: 'ic' }, icon),
    el('div', { class: 't' }, title),
    el('div', { class: 'd' }, desc || ''),
  ]);
}

// ---------- MANUTENÇÃO ----------
function renderManutencao(container, data) {
  container.innerHTML = '';
  if (!data || data.disponivel === false) {
    container.appendChild(
      emptyState('⚠️', 'Sem dados de manutenção', data?.motivo || 'Não foi possível carregar a planilha do SharePoint.')
    );
    return;
  }

  // Valor e % gasto em cada tipo de manutenção (em vez de contagem de OS) —
  // % é a fatia do custo confirmado total (mesma base do 1º card).
  const porTipo = data.porTipo || [];
  const custoPreventiva = porTipo.find((t) => t.chave === 'Preventiva')?.custo ?? 0;
  const custoCorretiva = porTipo.find((t) => t.chave === 'Corretiva')?.custo ?? 0;
  const pctDoTotal = (v) => (data.custoConfirmado ? `${Math.round((v / data.custoConfirmado) * 100)}% do custo confirmado` : null);

  const kpis = el('div', { class: 'kpi-grid' }, [
    kpiTile('Custo confirmado', fmtBRL(data.custoConfirmado), `${fmtNum(data.totalOrdens)} ordens no total`),
    kpiTile('Gasto com preventiva', fmtBRL(custoPreventiva), pctDoTotal(custoPreventiva)),
    kpiTile('Tempo parado (médio)', fmtDias(data.tempoMedioParadoDias), data.tempoMaxParadoDias != null ? `pico: ${fmtDias(data.tempoMaxParadoDias)}` : null),
    kpiTile('Gasto com corretiva', fmtBRL(custoCorretiva), pctDoTotal(custoCorretiva)),
  ]);
  container.appendChild(kpis);
  container.appendChild(miniBars('Custo por oficina', data.porOficina || []));
  container.appendChild(miniBars('Custo por veículo', data.porVeiculo || []));
}

// ---------- ABASTECIMENTO ----------
function renderAbastecimento(container, data) {
  container.innerHTML = '';
  if (!data || data.disponivel === false) {
    container.appendChild(
      emptyState('⛽', 'Integração em configuração', data?.motivo || 'Aguardando endpoint /api/painel-tv do sistema de abastecimento.')
    );
    return;
  }

  const kpis = el('div', { class: 'kpi-grid' }, [
    kpiTile('Litros abastecidos', fmtNum(data.totalLitros, { maximumFractionDigits: 0 }), data.periodo || null),
    kpiTile('Custo total', fmtBRL(data.custoTotal), `${fmtNum(data.qtdAbastecimentos)} abastecimentos`),
    // Teste: no lugar de "pendentes de aprovação", um gráfico de linha bem
    // pequeno com o custo total dos últimos 6 meses (não segue o filtro de
    // período — é sempre os últimos 6 meses corridos, ver server.js/Abast).
    chartTile('Custo total por mês (6 meses)', data.custoPorMes || []),
    kpiTile('Preço médio/L', data.totalLitros ? fmtBRL(data.custoTotal / data.totalLitros) : '—', null),
  ]);
  container.appendChild(kpis);
  container.appendChild(miniBars('Valor por tipo de combustível', data.porTipoCombustivel || []));
  container.appendChild(miniBars('Custo por veículo', data.porVeiculo || []));

  if (data.bombonas && data.bombonas.length) {
    const wrap = el('div', {}, [el('div', { class: 'mini-title' }, 'Bombonas de campo')]);
    const list = el('div', { class: 'mini-bars' });
    data.bombonas.slice(0, 4).forEach((b) => {
      const pct = b.capacidade ? Math.max(4, Math.round((b.litrosRestantes / b.capacidade) * 100)) : 0;
      list.appendChild(
        el('div', { class: 'mini-row' }, [
          el('div', { class: 'rl', title: b.nome }, b.nome),
          el('div', { class: 'mini-track' }, [el('div', { class: 'mini-fill', style: `width:${pct}%; background:${BAR_COLOR}` })]),
          el('div', { class: 'rv' }, `${fmtNum(b.litrosRestantes, { maximumFractionDigits: 0 })} L`),
        ])
      );
    });
    wrap.appendChild(list);
    container.appendChild(wrap);
  }
}

// ---------- ESTOQUE ----------
function renderEstoque(container, data) {
  container.innerHTML = '';
  container.appendChild(
    emptyState('🛢️', 'Em breve', data?.motivo || 'Estoque de combustível por localidade entra numa próxima etapa.')
  );
}

// ---------- status / relógio ----------
function updateClock() {
  const now = new Date();
  document.getElementById('clock').textContent = now.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  document.getElementById('dateLabel').textContent = now.toLocaleDateString('pt-BR', {
    weekday: 'long', day: '2-digit', month: 'long',
  });
}

function updateStatus(payload) {
  const strip = document.getElementById('statusStrip');
  const text = document.getElementById('statusText');
  if (!payload) {
    strip.classList.add('stale');
    text.textContent = 'Sem conexão com o servidor do painel.';
    return;
  }
  const gerado = new Date(payload.generatedAt);
  const idadeMs = Date.now() - gerado.getTime();
  const stale = payload.stale || idadeMs > STALE_AFTER_MS;
  strip.classList.toggle('stale', !!stale);
  const horario = gerado.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  text.textContent = stale
    ? `Dados desatualizados — última atualização às ${horario}`
    : `Dados atualizados às ${horario}${payload.fromCache ? ' (cache)' : ''}`;
}

// ---------- filtro de período ----------
// Afeta Manutenção e Abastecimento (não afeta o gráfico "custo por mês" de
// cima, que é sempre os últimos 6 meses, nem o Estoque, que ainda não tem
// dado real). Botões clicáveis direto na tela — ver .period-filter no HTML.
let currentPeriodo = '7dias';

function setupPeriodFilter() {
  const buttons = Array.from(document.querySelectorAll('.pf-btn'));
  buttons.forEach((btn) => {
    btn.addEventListener('click', () => {
      const periodo = btn.dataset.periodo;
      if (!periodo || periodo === currentPeriodo) return;
      currentPeriodo = periodo;
      buttons.forEach((b) => b.classList.toggle('active', b === btn));
      // force=1: troca de filtro deve refletir na hora, sem esperar o cache
      // do servidor vencer (ver server/index.js).
      loadPainel({ force: true });
    });
  });
}

// ---------- ciclo principal ----------
async function loadPainel({ force = false } = {}) {
  try {
    const params = new URLSearchParams({ periodo: currentPeriodo });
    if (force) params.set('force', '1');
    const res = await fetch(`/api/painel?${params.toString()}`, { cache: 'no-store' });
    const payload = await res.json();
    renderManutencao(document.getElementById('manutencaoBody'), payload.manutencao);
    renderAbastecimento(document.getElementById('abastecimentoBody'), payload.abastecimento);
    renderEstoque(document.getElementById('estoqueBody'), payload.estoque);
    updateStatus(payload);
  } catch (err) {
    console.error('Falha ao carregar /api/painel:', err);
    updateStatus(null);
  }
}

updateClock();
setInterval(updateClock, 1000);

setupPeriodFilter();
loadPainel();
setInterval(() => loadPainel(), REFRESH_MS);
setTimeout(() => window.location.reload(), RELOAD_SAFETY_MS);
