/* Central da Frota — frota.js
   Alimenta public/frota.html com dados de /api/frota/*
   ------------------------------------------------------------------ */

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

async function api(caminho) {
  const r = await fetch('/api/frota' + caminho);
  if (r.status === 401) {
    window.location.href = '/frota/login?erro=sessao_expirada';
    throw new Error('Sessão expirada.');
  }
  if (!r.ok) {
    const corpo = await r.json().catch(() => ({}));
    throw new Error(corpo.erro || `Erro ${r.status}`);
  }
  return r.json();
}

// ------------------------------------------------------------------ //
// Estado global
// ------------------------------------------------------------------ //

let abaAtiva = 'indicadores';
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
       <span style="color:var(--frota-texto)">${esc(msg)}</span>
       <button onclick="carregarDados(true)" style="margin-top:.5rem;padding:.4rem 1rem;border-radius:6px;border:1px solid var(--frota-borda);background:var(--frota-bg-card);cursor:pointer;font:600 .9rem Barlow,sans-serif;color:var(--frota-laranja);">Tentar novamente</button>
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
  else if (nome === 'abastecimento') el.innerHTML = htmlAbastecimento(dadosGlobais);
  else if (nome === 'rastreamento') el.innerHTML = htmlRastreamento();

  if (nome === 'abastecimento') configurarPeriodo();
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

  // Abastecimento (resumo)
  let abastResumido = '';
  const ab = d.abastecimento;
  if (ab && ab.disponivel !== false) {
    const tot = ab.totalGasto ?? ab.total_gasto ?? ab.totalReais;
    const lit  = ab.totalLitros ?? ab.total_litros;
    const med  = ab.precoMedio  ?? ab.preco_medio;
    abastResumido = `
      <div class="secao">
        <h3 class="secao-titulo">Abastecimento (${rotulosPeriodo[periodoAbast] || periodoAbast})</h3>
        <div class="indicadores-grid">
          ${tot  != null ? cardInd('Total gasto',   moeda(tot),  'laranja', '') : ''}
          ${lit  != null ? cardInd('Total litros',  num(lit)+' L', '', '') : ''}
          ${med  != null ? cardInd('Preço médio',   moeda(med)+'/L', '', '') : ''}
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

  return `
    ${aviso}
    ${cards}
    ${abastResumido}
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
      <div style="font-size:.88rem;color:var(--frota-texto-suave);margin-bottom:.9rem">
        Total mensal: <strong style="color:var(--frota-laranja)">${moeda(loc.custoTotal)}</strong>
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

function htmlAbastecimento(d) {
  const ab = d.abastecimento;

  const selPeriodo = `
    <div class="periodo-sel" id="selPeriodo">
      ${['hoje','7dias','30dias','mes'].map((p) =>
        `<button class="periodo-btn${p===periodoAbast?' ativo':''}" data-p="${p}">${rotulosPeriodo[p]}</button>`
      ).join('')}
    </div>`;

  if (!ab || ab.disponivel === false) {
    return selPeriodo +
      `<div class="aviso-erro">⚠️ ${esc(ab?.motivo || 'Dados de abastecimento indisponíveis.')}</div>`;
  }

  // Mapeamentos de campos (a API pode retornar em snake_case ou camelCase)
  const totalGasto  = ab.totalGasto  ?? ab.total_gasto;
  const totalLitros = ab.totalLitros ?? ab.total_litros;
  const precoMedio  = ab.precoMedio  ?? ab.preco_medio;
  const abastCount  = ab.abastecimentos ?? ab.total ?? ab.count;
  const postos      = ab.postos || [];
  const veiculos    = ab.veiculos || ab.porVeiculo || [];
  const combustiveis= ab.combustiveis || ab.porCombustivel || [];

  const cards = `
    <div class="abast-grid">
      ${totalGasto  != null ? cardInd('Total gasto',       moeda(totalGasto),     'laranja', '') : ''}
      ${totalLitros != null ? cardInd('Total litros',      num(totalLitros)+' L', '', '') : ''}
      ${precoMedio  != null ? cardInd('Preço médio',       moeda(precoMedio)+'/L', '', '') : ''}
      ${abastCount  != null ? cardInd('Abastecimentos',    num(abastCount), '', '') : ''}
    </div>`;

  const tabelaPostos = postos.length ? `
    <div class="secao">
      <h3 class="secao-titulo">Por posto</h3>
      <div class="tabela-wrap">
        <table>
          <thead><tr><th>Posto</th><th style="text-align:right">Litros</th><th style="text-align:right">Total</th></tr></thead>
          <tbody>
            ${postos.map((p) => `<tr>
              <td>${esc(p.nome || p.posto || p.name || '—')}</td>
              <td style="text-align:right">${num(p.litros || p.totalLitros || 0)} L</td>
              <td style="text-align:right;font-weight:600">${moeda(p.total || p.totalGasto || p.gasto || 0)}</td>
            </tr>`).join('')}
          </tbody>
        </table>
      </div>
    </div>` : '';

  const tabelaVeic = veiculos.length ? `
    <div class="secao">
      <h3 class="secao-titulo">Por veículo</h3>
      <div class="tabela-wrap">
        <table>
          <thead><tr><th>Placa</th><th style="text-align:right">Litros</th><th style="text-align:right">Total</th></tr></thead>
          <tbody>
            ${veiculos.map((v) => `<tr>
              <td><strong>${esc(v.placa || v.veiculo || '—')}</strong></td>
              <td style="text-align:right">${num(v.litros || v.totalLitros || 0)} L</td>
              <td style="text-align:right;font-weight:600">${moeda(v.total || v.totalGasto || v.gasto || 0)}</td>
            </tr>`).join('')}
          </tbody>
        </table>
      </div>
    </div>` : '';

  return selPeriodo + cards + tabelaPostos + tabelaVeic;
}

function configurarPeriodo() {
  document.querySelectorAll('.periodo-btn').forEach((btn) => {
    btn.addEventListener('click', async () => {
      if (btn.dataset.p === periodoAbast) return;
      periodoAbast = btn.dataset.p;
      // Atualiza visual imediatamente
      document.querySelectorAll('.periodo-btn').forEach((b) => b.classList.toggle('ativo', b.dataset.p === periodoAbast));
      // Busca só abastecimento para não recarregar tudo
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
