'use strict';

// ------------------------------------------------------------------ //
// ABA: Medição do posto
//
// O financeiro envia o que o posto cobra (borderô em PDF ou cupons digitados) e
// a tela compara, linha a linha, com as requisições do sistema de abastecimento.
// Só consulta: nada aqui altera requisição.
//
// Usa moeda(), num(), esc() e api() de frota.js.
// ------------------------------------------------------------------ //

const _med = {
  postos: null,      // lista de postos (carregada uma vez)
  posto: '',
  de: '',
  ate: '',
  itens: [],         // documentos do posto: { documento, data, combustivel, litros, valor, placa, codigoPosto }
  resultado: null,   // última comparação
  filtro: 'todos',   // filtro de situação na tabela de resultado
  aviso: '',         // mensagem de leitura do PDF
  ocupado: false,
};

const _MED_SITUACOES = {
  confere:         { rotulo: 'Confere',                  classe: 'med-ok' },
  data_diferente:  { rotulo: 'Confere (data diferente)', classe: 'med-ok' },
  valor_diferente: { rotulo: 'Valor diferente',          classe: 'med-erro' },
  sem_requisicao:  { rotulo: 'Nota sem requisição',      classe: 'med-erro' },
  sem_nota:        { rotulo: 'Requisição sem nota',      classe: 'med-aviso' },
};

const _MED_STATUS = { completed: 'Concluída', signed: 'Assinada (sem baixa)', pending: 'Pendente' };

function _medBr(dia) {
  return dia ? dia.split('-').reverse().join('/') : '';
}

function _medSemAcento(s) {
  return String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}

function _medInjetarEstilo() {
  if (document.getElementById('med-estilo')) return;
  const st = document.createElement('style');
  st.id = 'med-estilo';
  st.textContent = `
    .med-bloco { background: var(--sup); border: 1px solid var(--linha); border-radius: var(--raio); padding: 1rem 1.1rem; margin-bottom: 1.25rem; }
    .med-bloco h4 { font-family: var(--f-titulo); font-size: .9rem; margin: 0 0 .7rem; color: var(--texto-2); }
    .med-linha { display: flex; flex-wrap: wrap; gap: .6rem; align-items: flex-end; }
    .med-linha .abast-sel { cursor: text; }
    .med-linha select.abast-sel { cursor: pointer; }
    .med-btn { height: 32px; padding: 0 .9rem; border-radius: var(--raio-p); border: 1px solid var(--linha-forte);
      background: var(--sup); color: var(--texto); font: 600 .82rem var(--f-texto); cursor: pointer; }
    .med-btn:hover { background: var(--sup-3); }
    .med-btn.principal { background: var(--laranja); border-color: var(--laranja); color: #1A0F02; }
    .med-btn.principal:hover { background: var(--laranja-hover); }
    .med-btn:disabled { opacity: .5; cursor: not-allowed; }
    .med-dica { font-size: .78rem; color: var(--texto-3); margin-top: .5rem; }
    .med-chip { display: inline-block; border-radius: 20px; padding: .15rem .6rem; font-size: .75rem; font-weight: 600; white-space: nowrap; }
    .med-ok { background: var(--ok-fundo); color: var(--ok); }
    .med-erro { background: var(--alerta-fundo); color: var(--alerta); }
    .med-aviso { background: var(--aviso-fundo); color: var(--aviso); }
    .med-filtros { display: flex; flex-wrap: wrap; gap: .4rem; margin-bottom: .8rem; }
    .med-filtro { border: 1px solid var(--linha-forte); background: var(--sup); color: var(--texto-2); border-radius: 20px;
      padding: .25rem .75rem; font: 600 .78rem var(--f-texto); cursor: pointer; }
    .med-filtro.ativo { background: var(--laranja-fundo); border-color: var(--laranja); color: var(--laranja-texto); }
    .med-num { text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap; }
    .med-obs { font-size: .78rem; color: var(--texto-3); }
    .med-x { background: none; border: none; color: var(--texto-3); cursor: pointer; font-size: 1rem; }
    .med-x:hover { color: var(--alerta); }
  `;
  document.head.appendChild(st);
}

async function renderMedicao() {
  _medInjetarEstilo();
  const el = document.getElementById('conteudo');
  el.innerHTML = '<div class="estado-global"><span class="spinner"></span> Carregando…</div>';

  if (!_med.postos) {
    try {
      _med.postos = (await api('/medicao/postos')).postos || [];
    } catch (err) {
      el.innerHTML = `<div class="aviso-erro">⚠️ ${esc(err.message)}</div>`;
      return;
    }
  }

  el.innerHTML = `
    <div class="med-bloco">
      <h4>1. Período e posto</h4>
      <div class="med-linha">
        <div class="abast-filtro-grupo">
          <span class="abast-filtro-label">Posto</span>
          <select class="abast-sel" id="med-posto">
            <option value="">Escolha…</option>
            ${_med.postos.map((p) => `<option value="${esc(p)}"${p === _med.posto ? ' selected' : ''}>${esc(p)}</option>`).join('')}
          </select>
        </div>
        <div class="abast-filtro-grupo">
          <span class="abast-filtro-label">De</span>
          <input class="abast-sel" type="date" id="med-de" value="${esc(_med.de)}">
        </div>
        <div class="abast-filtro-grupo">
          <span class="abast-filtro-label">Até</span>
          <input class="abast-sel" type="date" id="med-ate" value="${esc(_med.ate)}">
        </div>
      </div>
    </div>

    <div class="med-bloco">
      <h4>2. O que o posto cobrou</h4>
      <div class="med-linha" style="margin-bottom:.9rem">
        <div class="abast-filtro-grupo">
          <span class="abast-filtro-label">Borderô em PDF</span>
          <input class="abast-sel" type="file" id="med-pdf" accept="application/pdf" style="padding-top:4px;max-width:300px">
        </div>
      </div>
      <div id="med-aviso-pdf"></div>
      <div class="med-linha">
        <div class="abast-filtro-grupo">
          <span class="abast-filtro-label">Documento / cupom</span>
          <input class="abast-sel" type="text" id="med-doc" placeholder="Ex.: NFC-e 225" style="min-width:140px">
        </div>
        <div class="abast-filtro-grupo">
          <span class="abast-filtro-label">Data</span>
          <input class="abast-sel" type="date" id="med-doc-data">
        </div>
        <div class="abast-filtro-grupo">
          <span class="abast-filtro-label">Combustível</span>
          <select class="abast-sel" id="med-doc-comb" style="min-width:120px">
            <option>Gasolina</option><option>Diesel</option><option>Etanol</option>
          </select>
        </div>
        <div class="abast-filtro-grupo">
          <span class="abast-filtro-label">Litros (opcional)</span>
          <input class="abast-sel" type="number" step="0.001" min="0" id="med-doc-litros" style="min-width:100px;width:100px">
        </div>
        <div class="abast-filtro-grupo">
          <span class="abast-filtro-label">Valor (R$)</span>
          <input class="abast-sel" type="number" step="0.01" min="0" id="med-doc-valor" style="min-width:110px;width:110px">
        </div>
        <div class="abast-filtro-grupo">
          <span class="abast-filtro-label">Placa (opcional)</span>
          <input class="abast-sel" type="text" id="med-doc-placa" style="min-width:100px;width:100px;text-transform:uppercase">
        </div>
        <button class="med-btn" id="med-add">Adicionar cupom</button>
      </div>
      <p class="med-dica">PDF digitalizado ou foto de cupom não é lido sozinho: digite os dados acima.</p>
      <div id="med-itens" style="margin-top:.9rem"></div>
    </div>

    <div class="med-bloco">
      <div class="med-linha">
        <button class="med-btn principal" id="med-comparar">Comparar com o sistema</button>
        <button class="med-btn" id="med-exportar">Baixar Excel</button>
        <span id="med-status" class="med-obs"></span>
      </div>
    </div>

    <div id="med-resultado"></div>`;

  _medDesenharAviso();
  _medDesenharItens();
  _medDesenharResultado();

  document.getElementById('med-posto').addEventListener('change', (e) => { _med.posto = e.target.value; });
  document.getElementById('med-de').addEventListener('change', (e) => { _med.de = e.target.value; });
  document.getElementById('med-ate').addEventListener('change', (e) => { _med.ate = e.target.value; });
  document.getElementById('med-pdf').addEventListener('change', _medLerPdf);
  document.getElementById('med-add').addEventListener('click', _medAdicionar);
  document.getElementById('med-comparar').addEventListener('click', _medComparar);
  document.getElementById('med-exportar').addEventListener('click', _medExportar);
}

function _medDesenharAviso() {
  const el = document.getElementById('med-aviso-pdf');
  if (el) el.innerHTML = _med.aviso;
}

function _medDesenharItens() {
  const el = document.getElementById('med-itens');
  if (!el) return;
  if (!_med.itens.length) {
    el.innerHTML = '<p class="med-obs">Nenhum documento ainda. Envie o borderô ou adicione os cupons.</p>';
    return;
  }
  const total = _med.itens.reduce((s, i) => s + i.valor, 0);
  el.innerHTML = `
    <div class="tabela-wrap" style="max-height:320px;overflow-y:auto">
      <table>
        <thead><tr><th>Documento</th><th>Data</th><th>Combustível</th><th class="med-num">Litros</th><th class="med-num">Valor</th><th></th></tr></thead>
        <tbody>
          ${_med.itens.map((i, idx) => `<tr>
            <td>${esc(i.documento)}${i.codigoPosto ? ` <span class="med-obs">(${esc(i.codigoPosto)})</span>` : ''}</td>
            <td>${esc(_medBr(i.data))}</td>
            <td>${esc(i.combustivel)}</td>
            <td class="med-num">${i.litros != null ? num(i.litros) + ' L' : '—'}</td>
            <td class="med-num">${moeda(i.valor)}</td>
            <td><button class="med-x" data-rm="${idx}" title="Remover">✕</button></td>
          </tr>`).join('')}
        </tbody>
      </table>
    </div>
    <div class="med-linha" style="margin-top:.5rem;justify-content:space-between">
      <span class="med-obs"><strong>${_med.itens.length}</strong> documento(s) · total <strong>${moeda(total)}</strong></span>
      <button class="med-btn" id="med-limpar">Limpar lista</button>
    </div>`;
  el.querySelectorAll('[data-rm]').forEach((b) => b.addEventListener('click', () => {
    _med.itens.splice(Number(b.dataset.rm), 1);
    _med.resultado = null;
    _medDesenharItens();
    _medDesenharResultado();
  }));
  document.getElementById('med-limpar').addEventListener('click', () => {
    _med.itens = [];
    _med.resultado = null;
    _med.aviso = '';
    _medDesenharAviso();
    _medDesenharItens();
    _medDesenharResultado();
  });
}

function _medStatus(msg) {
  const el = document.getElementById('med-status');
  if (el) el.textContent = msg || '';
}

async function _medLerPdf(ev) {
  const arquivo = ev.target.files?.[0];
  if (!arquivo) return;
  _medStatus('Lendo o PDF…');
  try {
    const r = await fetch('/api/frota/medicao/ler-pdf', {
      method: 'POST',
      headers: { 'Content-Type': 'application/pdf' },
      body: arquivo,
    });
    if (r.status === 401) { window.location.href = '/frota/login?erro=sessao_expirada'; return; }
    const corpo = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(corpo.erro || `Erro ${r.status}`);

    const jaTem = new Set(_med.itens.map((i) => i.documento));
    let novos = 0;
    for (const it of corpo.itens) {
      if (jaTem.has(it.documento)) continue;
      _med.itens.push({ ...it, litros: null, placa: '' });
      novos += 1;
    }
    _med.resultado = null;
    if (!_med.de || corpo.de < _med.de) _med.de = corpo.de;
    if (!_med.ate || corpo.ate > _med.ate) _med.ate = corpo.ate;

    // Tenta escolher o posto pelo nome que veio no PDF.
    if (corpo.postoNoDocumento) {
      const chave = _medSemAcento(corpo.postoNoDocumento).replace(/\b(auto|posto)\b/g, '').trim();
      const achado = chave && _med.postos.find((p) => _medSemAcento(p).includes(chave));
      if (achado) _med.posto = achado;
    }

    const linhas = [`<div class="med-obs" style="margin-bottom:.6rem">✔ ${novos} documento(s) lido(s) de "${esc(arquivo.name)}"` +
      (corpo.totalRodape ? ` — o total do PDF (${corpo.totalRodape.qtd} notas, ${moeda(corpo.totalRodape.valor)}) ${corpo.confereRodape ? 'confere com a leitura' : 'NÃO confere com a leitura'}.` : '.') + '</div>'];
    for (const a of corpo.avisos || []) linhas.push(`<div class="aviso-erro">⚠️ ${esc(a)}</div>`);
    _med.aviso = linhas.join('');
    _medStatus('');
    await renderMedicao();
  } catch (err) {
    _med.aviso = `<div class="aviso-erro">⚠️ ${esc(err.message)}</div>`;
    _medStatus('');
    _medDesenharAviso();
  } finally {
    ev.target.value = '';
  }
}

function _medAdicionar() {
  const v = (id) => document.getElementById(id).value.trim();
  const documento = v('med-doc');
  const data = v('med-doc-data');
  const valor = Number(v('med-doc-valor'));
  if (!documento) return _medStatus('Informe o documento ou número do cupom.');
  if (!data) return _medStatus('Informe a data do cupom.');
  if (!(valor > 0)) return _medStatus('Informe o valor do cupom.');
  if (_med.itens.some((i) => i.documento === documento)) return _medStatus('Já existe um documento com esse número na lista.');
  const litros = v('med-doc-litros');
  _med.itens.push({
    documento, data, valor,
    combustivel: v('med-doc-comb'),
    litros: litros !== '' ? Number(litros) : null,
    placa: v('med-doc-placa').toUpperCase(),
    codigoPosto: '',
  });
  if (!_med.de || data < _med.de) { _med.de = data; document.getElementById('med-de').value = data; }
  if (!_med.ate || data > _med.ate) { _med.ate = data; document.getElementById('med-ate').value = data; }
  _med.resultado = null;
  ['med-doc', 'med-doc-litros', 'med-doc-valor', 'med-doc-placa'].forEach((id) => { document.getElementById(id).value = ''; });
  _medStatus('');
  _medDesenharItens();
  _medDesenharResultado();
}

function _medEntrada() {
  return {
    posto: _med.posto,
    de: _med.de,
    ate: _med.ate,
    itens: _med.itens.map((i) => ({
      documento: i.documento, data: i.data, valor: i.valor, combustivel: i.combustivel,
      litros: i.litros, placa: i.placa, codigoPosto: i.codigoPosto,
    })),
  };
}

function _medFalta() {
  if (!_med.posto) return 'Escolha o posto.';
  if (!_med.de || !_med.ate) return 'Informe o período (de / até).';
  if (!_med.itens.length) return 'Adicione ao menos um documento do posto.';
  return '';
}

async function _medComparar() {
  const falta = _medFalta();
  if (falta) return _medStatus(falta);
  const btn = document.getElementById('med-comparar');
  btn.disabled = true;
  _medStatus('Comparando…');
  try {
    _med.resultado = await api('/medicao/comparar', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(_medEntrada()),
    });
    _med.filtro = 'todos';
    _medStatus('');
    _medDesenharResultado();
    document.getElementById('med-resultado')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  } catch (err) {
    _medStatus(err.message);
  } finally {
    btn.disabled = false;
  }
}

async function _medExportar() {
  const falta = _medFalta();
  if (falta) return _medStatus(falta);
  _medStatus('Gerando o Excel…');
  try {
    const r = await fetch('/api/frota/medicao/exportar', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(_medEntrada()),
    });
    if (r.status === 401) { window.location.href = '/frota/login?erro=sessao_expirada'; return; }
    if (!r.ok) throw new Error((await r.json().catch(() => ({}))).erro || `Erro ${r.status}`);
    const blob = await r.blob();
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `Medicao_${_med.posto.replace(/[^A-Za-z0-9]+/g, '_')}_${_med.de}_a_${_med.ate}.xlsx`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
    _medStatus('');
  } catch (err) {
    _medStatus(err.message);
  }
}

function _medDesenharResultado() {
  const el = document.getElementById('med-resultado');
  if (!el) return;
  const res = _med.resultado;
  if (!res) { el.innerHTML = ''; return; }

  const { posto, sistema, diferenca } = res.resumo;
  const bateu = diferenca.qtd === 0 && Math.abs(diferenca.valor) < 0.005 &&
    res.contagem.valor_diferente + res.contagem.sem_requisicao + res.contagem.sem_nota === 0;
  const problemas = res.contagem.valor_diferente + res.contagem.sem_requisicao + res.contagem.sem_nota;

  const cards = `
    <div class="indicadores-grid">
      ${cardInd('Cobrado pelo posto', moeda(posto.valor), 'laranja', `${posto.qtd} abastecimento(s)`)}
      ${cardInd('Requisições no sistema', moeda(sistema.valor), '', `${sistema.qtd} abastecimento(s)`)}
      ${cardInd('Diferença', moeda(diferenca.valor), bateu ? '' : 'alerta',
        `${diferenca.qtd > 0 ? '+' : ''}${diferenca.qtd} abastecimento(s) · ${problemas} item(ns) para conferir`)}
    </div>`;

  const filtros = [['todos', 'Todos', res.linhas.length]]
    .concat(Object.entries(_MED_SITUACOES).map(([k, s]) => [k, s.rotulo, res.contagem[k] || 0]))
    .filter(([k, , n]) => k === 'todos' || n > 0);
  const botoes = filtros.map(([k, rotulo, n]) =>
    `<button class="med-filtro${_med.filtro === k ? ' ativo' : ''}" data-f="${k}">${esc(rotulo)} (${n})</button>`).join('');

  const linhas = res.linhas.filter((l) => _med.filtro === 'todos' || l.situacao === _med.filtro);
  const corpo = linhas.map((l) => {
    const s = _MED_SITUACOES[l.situacao];
    const obs = [...l.alertas];
    if (l.situacao === 'data_diferente') obs.unshift(`requisição de ${_medBr(l.dataSistema)}`);
    return `<tr>
      <td><span class="med-chip ${s.classe}">${esc(s.rotulo)}</span></td>
      <td>${esc(l.documento) || '—'}${l.codigoPosto ? ` <span class="med-obs">(${esc(l.codigoPosto)})</span>` : ''}</td>
      <td>${esc(_medBr(l.data))}</td>
      <td>${esc(l.combustivel)}</td>
      <td class="med-num">${l.valorPosto != null ? moeda(l.valorPosto) : '—'}</td>
      <td>${esc(l.requisicao) || '—'}</td>
      <td>${esc(l.veiculo)}${l.statusSistema ? ` <span class="med-obs">· ${esc(_MED_STATUS[l.statusSistema] || l.statusSistema)}</span>` : ''}</td>
      <td class="med-num">${l.valorSistema != null ? moeda(l.valorSistema) : '—'}</td>
      <td class="med-num">${l.diferenca != null ? moeda(l.diferenca) : '—'}</td>
      <td class="med-obs">${esc(obs.join('; '))}</td>
    </tr>`;
  }).join('');

  el.innerHTML = `
    <div class="secao">
      <h3 class="secao-titulo">Resultado — ${esc(res.posto)} · ${esc(_medBr(res.de))} a ${esc(_medBr(res.ate))}</h3>
      ${bateu ? '<div class="med-bloco" style="border-color:var(--ok)"><strong style="color:var(--ok)">✔ Tudo confere:</strong> mesma quantidade e mesmo valor do posto.</div>' : ''}
      ${cards}
      <div class="med-filtros">${botoes}</div>
      <div class="tabela-wrap">
        <table>
          <thead><tr>
            <th>Situação</th><th>Documento</th><th>Data</th><th>Combustível</th><th class="med-num">Valor posto</th>
            <th>Requisição</th><th>Veículo / bombona</th><th class="med-num">Valor sistema</th><th class="med-num">Diferença</th><th>Observações</th>
          </tr></thead>
          <tbody>${corpo || '<tr><td colspan="10" class="med-obs">Nada nesta situação.</td></tr>'}</tbody>
        </table>
      </div>
      <p class="med-dica">O casamento é por dia, valor e combustível (o código impresso pelo posto não é usado). Requisição pode estar registrada até 2 dias antes ou depois da nota. "Assinada (sem baixa)" = motorista assinou, mas a requisição ainda não foi concluída no sistema.</p>
    </div>`;

  el.querySelectorAll('[data-f]').forEach((b) => b.addEventListener('click', () => {
    _med.filtro = b.dataset.f;
    _medDesenharResultado();
  }));
}
