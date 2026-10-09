// Página /rastreamento — análises das planilhas do rastreador com histórico.
//  • Login próprio (sessão em cookie HttpOnly; o navegador não vê chave do banco)
//  • Importação: lê a planilha aqui, envia linhas + arquivo original ao servidor,
//    que guarda a evidência e ignora o que já existe (sem duplicar)
//  • Abas: Fora de horário · Motor ligado parado · Importações · Usuários (admin)

import {
  lerViagens, analisarViagens, parseDataHora, fmtDuracao, fmtData, fmtHora, fmtDataHora,
  diaSemana, linkTrajeto, NAO_IDENTIFICADO, REGRAS_PADRAO,
} from './fora-horario-core.js';
import { lerOciosidade, analisarOciosidade, ehRelatorioOciosidade, PADRAO_OCIOSIDADE } from './ociosidade-core.js';
import { lerPlanilha, gerarXlsx, E } from './xlsx-mini.js';

// ======================= utilidades =======================
const $ = (id) => document.getElementById(id);
const pad2 = (n) => String(n).padStart(2, '0');
const escH = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmtKm = (n) => (n ?? 0).toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const fmtInt = (n) => (n ?? 0).toLocaleString('pt-BR');
const fmtL = (n) => `${(n ?? 0).toLocaleString('pt-BR', { maximumFractionDigits: 0 })} L`;
const fmtBRL = (n) => (n == null ? '—' : n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }));
const fmtPct = (x) => (x == null ? '—' : `${Math.round(x * 100)}%`);
const ts = (d) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())} ${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}`;
const isoDia = (d) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
const diaBR = (iso) => iso.split('-').reverse().join('/');
const durExcel = (seg) => (seg ?? 0) / 86400;
const nomeExib = (chave) => (chave.startsWith(NAO_IDENTIFICADO) ? 'Motorista não identificado' : chave);
const nomeHtml = (chave) => (chave.startsWith(NAO_IDENTIFICADO) ? '<span class="ni">Motorista não identificado</span>' : escH(chave));

let toastTimer;
function toast(msg) {
  const t = $('toast');
  t.textContent = msg; t.classList.add('show');
  clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove('show'), 3200);
}

function baixar(blob, nome) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = nome;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

async function copiarOuEmail(txt) {
  try {
    await navigator.clipboard.writeText(txt);
    toast('Texto copiado — cole no e-mail e anexe o Excel');
  } catch {
    const [assunto, ...corpo] = txt.split('\n');
    window.location.href = `mailto:?subject=${encodeURIComponent(assunto.replace(/^Assunto: /, ''))}&body=${encodeURIComponent(corpo.join('\n').trim())}`;
  }
}

// ======================= API =======================
class ErroApi extends Error {}
async function api(caminho, { method = 'GET', body } = {}) {
  const res = await fetch(`/api/rast${caminho}`, {
    method,
    credentials: 'same-origin',
    headers: body !== undefined ? { 'Content-Type': 'application/json' } : {},
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  let data = null;
  try { data = await res.json(); } catch { /* resposta vazia */ }
  if (res.status === 401) { mostrarLogin(data?.erro); throw new ErroApi(data?.erro || 'Sessão expirada.'); }
  if (res.status === 403 && data?.trocarSenha) { mostrarTela('telaSenha'); throw new ErroApi(data.erro); }
  if (!res.ok) throw new ErroApi(data?.erro || `Erro ${res.status}`);
  return data;
}

// ======================= tema claro / noturno =======================
function aplicarTema(tema) {
  if (tema === 'dark') document.documentElement.dataset.theme = 'dark';
  else delete document.documentElement.dataset.theme;
  try { localStorage.setItem('rast.tema', tema); } catch { /* sem storage: vale só nesta aba */ }
  document.querySelectorAll('[data-tema]').forEach((b) => { b.textContent = tema === 'dark' ? '☀️ Claro' : '🌙 Noturno'; });
}
document.querySelectorAll('[data-tema]').forEach((b) => b.addEventListener('click', () => {
  aplicarTema(document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark');
}));
aplicarTema(document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light');

// ======================= telas / login =======================
let usuario = null;
function mostrarTela(id) {
  for (const t of ['telaLogin', 'telaSenha', 'telaApp']) $(t).hidden = t !== id;
}
function mostrarLogin(msg) {
  usuario = null;
  mostrarTela('telaLogin');
  const e = $('loginErro');
  if (msg && msg !== 'Sessão expirada. Entre novamente.') { e.textContent = msg; e.hidden = false; } else e.hidden = true;
  setTimeout(() => $('loginEmail').focus(), 50);
}

$('formLogin').addEventListener('submit', async (ev) => {
  ev.preventDefault();
  const btn = $('loginBtn');
  btn.disabled = true; $('loginErro').hidden = true;
  try {
    const res = await fetch('/api/rast/login', {
      method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: $('loginEmail').value, senha: $('loginSenha').value }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.erro || 'Não foi possível entrar.');
    $('loginSenha').value = '';
    entrou(data);
  } catch (err) {
    $('loginErro').textContent = err.message; $('loginErro').hidden = false;
  } finally { btn.disabled = false; }
});

$('formSenha').addEventListener('submit', async (ev) => {
  ev.preventDefault();
  const erro = $('senhaErro');
  erro.hidden = true;
  if ($('senhaNova').value !== $('senhaNova2').value) { erro.textContent = 'As duas senhas novas não são iguais.'; erro.hidden = false; return; }
  try {
    await api('/senha', { method: 'POST', body: { atual: $('senhaAtual').value, nova: $('senhaNova').value } });
    ['senhaAtual', 'senhaNova', 'senhaNova2'].forEach((id) => { $(id).value = ''; });
    entrou({ ...usuario, trocarSenha: false });
    toast('Senha definida');
  } catch (err) { erro.textContent = err.message; erro.hidden = false; }
});

document.querySelectorAll('[data-sair]').forEach((b) => b.addEventListener('click', async () => {
  await fetch('/api/rast/logout', { method: 'POST', credentials: 'same-origin' }).catch(() => {});
  cache.clear();
  mostrarLogin();
}));

let appIniciado = false;
function entrou(u) {
  usuario = u;
  if (u.trocarSenha) { mostrarTela('telaSenha'); setTimeout(() => $('senhaAtual').focus(), 50); return; }
  mostrarTela('telaApp');
  $('userNome').innerHTML = `<b>${escH(u.nome || u.email)}</b>`;
  $('tabUsuarios').hidden = u.papel !== 'admin';
  if (!appIniciado) { appIniciado = true; iniciarApp(); } else consultar();
}

// ======================= estado =======================
const estado = {
  aba: 'horario',
  de: null, ate: null,
  config: { litros_hora_ocioso: PADRAO_OCIOSIDADE.litrosHora, ociosidade_minutos: PADRAO_OCIOSIDADE.limiteMin, feriados_extras: [] },
  horario: null,  // resultado da análise
  ocioso: null,
};
const cache = new Map(); // 'tipo|de|ate' -> linhas do banco

async function carregarConfig() {
  const c = await api('/config');
  estado.config.litros_hora_ocioso = Number(c.litros_hora_ocioso?.valor ?? PADRAO_OCIOSIDADE.litrosHora);
  estado.config.ociosidade_minutos = Number(c.ociosidade_minutos?.valor ?? PADRAO_OCIOSIDADE.limiteMin);
  try { estado.config.feriados_extras = JSON.parse(c.feriados_extras?.valor || '[]'); } catch { estado.config.feriados_extras = []; }
  estado.config.meta = c;
}

async function iniciarApp() {
  try {
    await carregarConfig();
    const resumo = await api('/resumo');
    const ultimas = [resumo.viagens?.ultima, resumo.ociosidade?.ultima].filter(Boolean).map(parseDataHora).filter(Boolean);
    const ref = ultimas.length ? new Date(Math.max(...ultimas)) : new Date();
    definirPeriodo(new Date(ref.getFullYear(), ref.getMonth(), 1), new Date(ref.getFullYear(), ref.getMonth() + 1, 0));
  } catch (err) {
    if (!(err instanceof ErroApi)) console.error(err);
    const hoje = new Date();
    definirPeriodo(new Date(hoje.getFullYear(), hoje.getMonth(), 1), hoje);
  }
  consultar();
}

// ======================= período =======================
function definirPeriodo(de, ate) {
  estado.de = isoDia(de); estado.ate = isoDia(ate);
  $('perDe').value = estado.de; $('perAte').value = estado.ate;
}
$('perOk').addEventListener('click', () => {
  if (!$('perDe').value || !$('perAte').value) return;
  if ($('perDe').value > $('perAte').value) { toast('A data inicial é depois da final'); return; }
  estado.de = $('perDe').value; estado.ate = $('perAte').value;
  consultar();
});
document.querySelectorAll('[data-rapido]').forEach((b) => b.addEventListener('click', async () => {
  const hoje = new Date();
  const r = b.dataset.rapido;
  if (r === '7') definirPeriodo(new Date(hoje.getFullYear(), hoje.getMonth(), hoje.getDate() - 6), hoje);
  else if (r === 'mes') definirPeriodo(new Date(hoje.getFullYear(), hoje.getMonth(), 1), hoje);
  else if (r === 'mesant') definirPeriodo(new Date(hoje.getFullYear(), hoje.getMonth() - 1, 1), new Date(hoje.getFullYear(), hoje.getMonth(), 0));
  else if (r === 'tudo') {
    try {
      const resumo = await api('/resumo');
      const datas = [resumo.viagens?.primeira, resumo.viagens?.ultima, resumo.ociosidade?.primeira, resumo.ociosidade?.ultima].filter(Boolean).map(parseDataHora);
      if (datas.length) definirPeriodo(new Date(Math.min(...datas)), new Date(Math.max(...datas)));
    } catch { return; }
  }
  estado.de = $('perDe').value; estado.ate = $('perAte').value;
  consultar();
}));
const textoPer = () => `${diaBR(estado.de)} a ${diaBR(estado.ate)}`;

// ======================= abas =======================
document.querySelectorAll('#tabs .tab').forEach((b) => b.addEventListener('click', () => { msgImport('', ''); trocarAba(b.dataset.tab); }));
function trocarAba(aba) {
  estado.aba = aba;
  document.querySelectorAll('#tabs .tab').forEach((b) => b.classList.toggle('active', b.dataset.tab === aba));
  for (const p of ['horario', 'ocioso', 'importacoes', 'usuarios']) $(`pane-${p}`).hidden = p !== aba;
  $('periodBar').hidden = !['horario', 'ocioso'].includes(aba);
  consultar();
}

async function buscarLinhas(tipo) {
  const chave = `${tipo}|${estado.de}|${estado.ate}`;
  if (!cache.has(chave)) cache.set(chave, (await api(`/dados?tipo=${tipo}&de=${estado.de}&ate=${estado.ate}`)).linhas);
  return cache.get(chave);
}

let consultaSeq = 0;
async function consultar() {
  if (!usuario || usuario.trocarSenha) return;
  const seq = ++consultaSeq;
  const aba = estado.aba;
  const pane = $(`pane-${aba}`);
  try {
    if (aba === 'horario') {
      pane.innerHTML = '<div class="loading">Carregando…</div>';
      const linhas = await buscarLinhas('viagens');
      if (seq !== consultaSeq) return;
      renderHorario(linhas);
    } else if (aba === 'ocioso') {
      pane.innerHTML = '<div class="loading">Carregando…</div>';
      const [linhas, precos] = await Promise.all([buscarLinhas('ociosidade'), api(`/precos?de=${estado.de}&ate=${estado.ate}`)]);
      if (seq !== consultaSeq) return;
      renderOcioso(linhas, precos);
    } else if (aba === 'importacoes') {
      pane.innerHTML = '<div class="loading">Carregando…</div>';
      const lista = await api('/importacoes');
      if (seq !== consultaSeq) return;
      renderImportacoes(lista);
    } else if (aba === 'usuarios') {
      pane.innerHTML = '<div class="loading">Carregando…</div>';
      const lista = await api('/usuarios');
      if (seq !== consultaSeq) return;
      renderUsuarios(lista);
    }
  } catch (err) {
    if (seq !== consultaSeq) return;
    if (!(err instanceof ErroApi)) console.error(err);
    pane.innerHTML = `<div class="msg err">${escH(err.message || 'Falha ao carregar.')}</div>`;
  }
}

// ======================= importação =======================
const drop = $('drop');
['dragenter', 'dragover'].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.add('over'); }));
['dragleave', 'drop'].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.remove('over'); }));
drop.addEventListener('drop', (e) => { const f = e.dataTransfer?.files?.[0]; if (f) importar(f); });
$('arquivo').addEventListener('change', (e) => { const f = e.target.files?.[0]; if (f) importar(f); e.target.value = ''; });

function msgImport(tipo, html) {
  const m = $('importMsg');
  m.className = `msg no-print ${tipo}`;
  m.innerHTML = html; m.hidden = !html;
}

function paraBase64(buf) {
  const u8 = new Uint8Array(buf);
  let s = '';
  for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000));
  return btoa(s);
}

async function importar(arquivo) {
  msgImport('', '');
  if (!/\.xlsx$/i.test(arquivo.name)) { msgImport('err', 'Use o arquivo <b>.xlsx</b> exportado do rastreador.'); return; }
  drop.classList.add('busy');
  $('dropT').innerHTML = `Lendo <b>${escH(arquivo.name)}</b>…`;
  try {
    const buf = await arquivo.arrayBuffer();
    const linhas = await lerPlanilha(buf);
    let tipo, registros, inicioMin, fimMax;
    if (ehRelatorioOciosidade(linhas)) {
      tipo = 'ociosidade';
      const { trechos } = lerOciosidade(linhas);
      if (!trechos.length) throw new Error('Nenhum trecho encontrado na planilha.');
      registros = trechos.map((t) => ({
        veiculo: t.veiculo, motorista: t.motorista, inicio: ts(t.inicio), fim: ts(t.fim),
        movimento_seg: t.movimentoSeg, motor_seg: t.motorSeg, ocioso_seg: t.ociosoSeg,
        origem: t.origem, destino: t.destino, odometro_ini: t.odometroIni, odometro_fim: t.odometroFim, deslocamento_km: t.deslocamentoKm,
      }));
      inicioMin = new Date(Math.min(...trechos.map((t) => t.inicio))); fimMax = new Date(Math.max(...trechos.map((t) => t.fim)));
    } else {
      tipo = 'viagens';
      const { viagens } = lerViagens(linhas);
      if (!viagens.length) throw new Error('Nenhuma viagem encontrada na planilha.');
      registros = viagens.map((v) => ({
        veiculo: v.veiculo, motorista: v.motorista, inicio: ts(v.inicio), fim: ts(v.fim), duracao_seg: v.duracaoSeg,
        km: v.km, vel_media: v.velMedia, vel_max: v.velMax, origem: v.origem, destino: v.destino, coord_ini: v.coordIni, coord_fim: v.coordFim,
      }));
      inicioMin = new Date(Math.min(...viagens.map((v) => v.inicio))); fimMax = new Date(Math.max(...viagens.map((v) => v.fim)));
    }
    const rotulo = tipo === 'viagens' ? 'viagens' : 'trechos';
    $('dropT').innerHTML = `Enviando <b>${escH(arquivo.name)}</b> (${fmtInt(registros.length)} ${rotulo})…`;
    const r = await api('/importar', {
      method: 'POST',
      body: { tipo, arquivoNome: arquivo.name, arquivoBase64: paraBase64(buf), periodoDe: ts(inicioMin), periodoAte: ts(fimMax), registros },
    });
    const nomeTipo = tipo === 'viagens' ? 'Relatório de viagens (horário)' : 'Relatório de motor ligado parado';
    if (r.jaImportado) {
      const quando = r.importado_em ? fmtDataHora(new Date(r.importado_em)) : '';
      msgImport('info', `<b>${escH(arquivo.name)}</b> já tinha sido importado${quando ? ` em ${quando}` : ''}${r.importado_por ? ` por ${escH(r.importado_por)}` : ''}. Nada foi duplicado. Mostrando o período desse arquivo.`);
    } else {
      msgImport('ok', `<b>${escH(nomeTipo)}</b> importado: ${fmtInt(r.registros)} ${rotulo} — <b>${fmtInt(r.novos)} novos</b>${r.duplicados ? `, ${fmtInt(r.duplicados)} já estavam no histórico (não duplicados)` : ''}. Planilha original guardada como evidência.`);
    }
    cache.clear();
    definirPeriodo(inicioMin, fimMax);
    trocarAba(tipo === 'viagens' ? 'horario' : 'ocioso');
  } catch (err) {
    if (!(err instanceof ErroApi)) console.error(err);
    msgImport('err', escH(err.message || 'Não foi possível importar a planilha.'));
  } finally {
    drop.classList.remove('busy');
    $('dropT').textContent = 'Importar planilha do rastreador';
  }
}

// ======================= helpers de render =======================
const kpi = (l, v, f, cls = '') => `<div class="kpi ${cls}"><div class="l">${l}</div><div class="v">${v}</div>${f ? `<div class="f">${f}</div>` : ''}</div>`;
const vazio = (titulo, texto) => `<div class="card vazio"><div class="t">${titulo}</div>${texto}</div>`;
const acoes = (id) => `
  <div class="actions">
    <div class="periodo">Período consultado: <b>${textoPer()}</b></div>
    <button class="btn primary no-print" type="button" data-acao="excel-${id}">⬇ Baixar Excel</button>
    <button class="btn no-print" type="button" data-acao="pdf-${id}">🖨 Imprimir / PDF</button>
    <button class="btn no-print" type="button" data-acao="email-${id}">✉ Copiar texto p/ e-mail</button>
  </div>`;
const cabImpressao = (titulo) => `<div class="print-only"><h2 style="margin:0 0 4px">${titulo}</h2><div class="muted">Período: <b>${textoPer()}</b> · gerado em ${fmtDataHora(new Date())} por ${escH(usuario?.nome || usuario?.email || '')}</div></div>`;

// ======================= FORA DE HORÁRIO =======================
const viagemDoBanco = (r) => {
  const inicio = parseDataHora(r.inicio), fim = parseDataHora(r.fim);
  return {
    veiculo: r.veiculo, motorista: r.motorista || '', inicio, fim,
    duracaoSeg: r.duracao_seg ?? Math.max(0, Math.round((fim - inicio) / 1000)),
    km: Number(r.km) || 0, velMedia: r.vel_media == null ? null : Number(r.vel_media), velMax: r.vel_max == null ? null : Number(r.vel_max),
    origem: r.origem || '', destino: r.destino || '', coordIni: r.coord_ini || '', coordFim: r.coord_fim || '',
  };
};

function classeTag(m) {
  if (m.startsWith('Feriado')) return 'tag fer';
  if (m.startsWith('Sábado') || m === 'Domingo') return 'tag fds';
  return 'tag';
}

function renderHorario(linhasBanco) {
  const pane = $('pane-horario');
  const regras = REGRAS_PADRAO;
  const regrasHtml = `
    <div class="card rules">
      <span class="chip"><span><b>Expediente:</b> seg. a sex., ${pad2(regras.inicioExpediente)}h às ${pad2(regras.fimExpediente)}h · sábado, ${pad2(regras.inicioExpediente)}h às ${pad2(regras.fimSabado)}h</span></span>
      <span class="chip"><span><b>Domingo e feriado:</b> dia inteiro</span></span>
      <span class="chip"><span>Viagem que encosta no horário proibido conta <b>inteira</b></span></span>
      <span class="chip"><span>Ignora viagens de <b>até ${String(regras.kmIgnorarAte).replace('.', ',')} km</b></span></span>
      <button class="link no-print" type="button" id="ferToggle">Feriados (${estado.config.feriados_extras.length} extras) ▾</button>
      <div id="ferBox" class="no-print" style="width:100%" hidden>
        <div class="hint" style="margin:10px 0">Automáticos: feriados nacionais (inclui Sexta-feira Santa e Consciência Negra) e Adesão do Pará (15/08). Cadastre aqui feriados municipais e pontos facultativos — vale para todos os usuários e para o histórico.</div>
        <div class="form-row" style="margin-bottom:10px">
          <label class="f" style="flex:0 0 170px">Data<input class="in" type="date" id="ferData"></label>
          <label class="f">Nome<input class="in" type="text" id="ferNome" placeholder="Ex.: Aniversário de Santarém"></label>
          <button class="btn" type="button" id="ferAdd">Adicionar</button>
        </div>
        <div class="fer-list" id="ferList"></div>
      </div>
    </div>`;

  const viagens = linhasBanco.map(viagemDoBanco);
  if (!viagens.length) {
    estado.horario = null;
    pane.innerHTML = regrasHtml + vazio('Nenhuma viagem no histórico para este período', 'Importe o relatório de viagens do rastreador ou escolha outro período.');
    ligarFeriados();
    return;
  }
  const r = analisarViagens(viagens, { feriadosExtras: estado.config.feriados_extras });
  estado.horario = r;
  const t = r.totais;

  let corpo = '';
  if (!t.viagensFora) {
    corpo = vazio('Nenhuma viagem fora do horário neste período', `${fmtInt(t.viagensNaPlanilha)} viagens analisadas.`);
  } else {
    const maxKm = Math.max(...r.porMotorista.map((g) => g.km), 1);
    corpo = `
    <div class="grid2">
      <section class="card">
        <h2 class="sec">Por motorista <span class="n">${r.porMotorista.length}</span></h2>
        <div class="tbl-wrap"><table>
          <thead><tr><th>Motorista</th><th>Veículo</th><th class="num">Viagens</th><th class="num">Dias</th><th class="num">Km</th><th class="num">Tempo</th></tr></thead>
          <tbody>${r.porMotorista.map((g) => `
            <tr>
              <td>${nomeHtml(g.chave)}<div class="bar"><span style="width:${Math.max(3, (g.km / maxKm) * 100)}%"></span></div></td>
              <td class="nw">${g.veiculos.map(escH).join('<br>')}</td>
              <td class="num">${g.viagens}</td><td class="num">${g.dias}</td>
              <td class="num">${fmtKm(g.km)}</td><td class="num">${fmtDuracao(g.duracaoSeg)}</td>
            </tr>`).join('')}</tbody>
        </table></div>
      </section>
      <section class="card">
        <h2 class="sec">Por veículo <span class="n">${r.porVeiculo.length}</span></h2>
        <div class="tbl-wrap"><table>
          <thead><tr><th>Veículo</th><th>Motorista(s)</th><th class="num">Viagens</th><th class="num">Km</th><th class="num">Tempo</th></tr></thead>
          <tbody>${r.porVeiculo.map((g) => `
            <tr>
              <td class="nw"><b>${escH(g.chave)}</b></td>
              <td>${g.motoristas.map((m) => (m === NAO_IDENTIFICADO ? '<span class="ni">Não identificado</span>' : escH(m))).join('<br>')}</td>
              <td class="num">${g.viagens}</td><td class="num">${fmtKm(g.km)}</td><td class="num">${fmtDuracao(g.duracaoSeg)}</td>
            </tr>`).join('')}</tbody>
        </table></div>
      </section>
    </div>
    <section class="card quebra">
      <h2 class="sec">Viagens fora do horário <span class="n" id="hNVia"></span></h2>
      <div class="filtro-tbl no-print">
        <select class="in" id="hFiltro"><option value="">Todos os motoristas / veículos</option>
          ${r.porMotorista.map((g) => `<option value="m:${escH(g.chave)}">${escH(g.chave.startsWith(NAO_IDENTIFICADO) ? `Não identificado (${g.veiculos[0]})` : g.chave)}</option>`).join('')}
          ${r.porVeiculo.map((g) => `<option value="v:${escH(g.chave)}">Veículo ${escH(g.chave)}</option>`).join('')}
        </select>
      </div>
      <div class="tbl-wrap"><table id="hTabela"></table></div>
    </section>`;
  }

  pane.innerHTML = `
    ${cabImpressao('Uso de veículos fora do horário de expediente')}
    ${regrasHtml}
    ${acoes('horario')}
    <div class="kpis">
      ${kpi('Viagens fora do horário', fmtInt(t.viagensFora), `de ${fmtInt(t.viagensNaPlanilha)} viagens no período`)}
      ${kpi('Km rodados', fmtKm(t.km), 'fora do expediente')}
      ${kpi('Tempo em movimento', fmtDuracao(t.duracaoSeg), 'soma das viagens')}
      ${kpi('Veículos', fmtInt(t.veiculos), `${fmtInt(t.motoristas)} motoristas identificados`)}
      ${kpi('Sem motorista', fmtInt(t.semMotorista), t.semMotorista ? 'viagens sem identificação no rastreador' : 'todas identificadas', t.semMotorista ? 'warn' : '')}
    </div>
    ${corpo}`;

  ligarFeriados();
  if (t.viagensFora) {
    $('hFiltro').addEventListener('change', renderTabelaHorario);
    renderTabelaHorario();
  }
}

function renderTabelaHorario() {
  const r = estado.horario;
  if (!r || !$('hTabela')) return;
  const f = $('hFiltro')?.value || '';
  const chaveMot = (v) => (v.motorista ? v.motorista : `${NAO_IDENTIFICADO} · ${v.veiculo}`);
  const lista = r.viagens.filter((v) => !f || (f.startsWith('m:') && chaveMot(v) === f.slice(2)) || (f.startsWith('v:') && v.veiculo === f.slice(2)));
  const temVelMax = r.viagens.some((v) => v.velMax != null);
  $('hNVia').textContent = `${lista.length}${f ? ` de ${r.viagens.length}` : ''}`;
  $('hTabela').innerHTML = `
    <thead><tr><th>Data</th><th>Motivo</th><th>Veículo</th><th>Motorista</th><th>Início</th><th>Fim</th><th class="num">Duração</th><th class="num">Km</th><th class="num">Vel. média</th>${temVelMax ? '<th class="num">Vel. máx.</th>' : ''}<th>Origem → Destino</th><th class="no-print">Mapa</th></tr></thead>
    <tbody>${lista.map((v) => {
      const mapa = linkTrajeto(v.coordIni, v.coordFim);
      return `<tr>
        <td class="nw">${fmtData(v.inicio)}<div class="muted">${diaSemana(v.inicio)}</div></td>
        <td><span class="${classeTag(v.motivo)}">${escH(v.motivo)}</span></td>
        <td class="nw"><b>${escH(v.veiculo)}</b></td>
        <td>${v.motorista ? escH(v.motorista) : '<span class="ni">Não identificado</span>'}</td>
        <td class="nw">${fmtHora(v.inicio)}</td>
        <td class="nw">${fmtData(v.fim) !== fmtData(v.inicio) ? `${fmtData(v.fim)} ` : ''}${fmtHora(v.fim)}</td>
        <td class="num">${fmtDuracao(v.duracaoSeg)}</td><td class="num">${fmtKm(v.km)}</td>
        <td class="num">${v.velMedia != null ? `${Math.round(v.velMedia)} km/h` : '—'}</td>
        ${temVelMax ? `<td class="num">${v.velMax != null ? `${Math.round(v.velMax)} km/h` : '—'}</td>` : ''}
        <td class="addr">${escH(v.origem || '—')}<br><span class="muted">→ ${escH(v.destino || '—')}</span></td>
        <td class="no-print">${mapa ? `<a href="${mapa}" target="_blank" rel="noopener">ver</a>` : ''}</td>
      </tr>`;
    }).join('')}</tbody>`;
}

function ligarFeriados() {
  const tog = $('ferToggle');
  if (!tog) return;
  tog.addEventListener('click', () => { $('ferBox').hidden = !$('ferBox').hidden; });
  const lista = () => {
    const box = $('ferList');
    const fs = [...estado.config.feriados_extras].sort((a, b) => a.data.localeCompare(b.data));
    box.innerHTML = fs.length ? '' : '<span class="hint">Nenhum feriado extra cadastrado.</span>';
    for (const f of fs) {
      const item = document.createElement('span');
      item.className = 'fer-item';
      item.innerHTML = `${diaBR(f.data)} · ${escH(f.nome)} <button type="button" title="Remover">×</button>`;
      item.querySelector('button').addEventListener('click', () => salvarFeriados(estado.config.feriados_extras.filter((x) => x.data !== f.data)));
      box.appendChild(item);
    }
  };
  lista();
  $('ferAdd').addEventListener('click', () => {
    const data = $('ferData').value;
    if (!data) { $('ferData').focus(); return; }
    const nome = $('ferNome').value.trim() || 'Feriado';
    salvarFeriados(estado.config.feriados_extras.filter((x) => x.data !== data).concat({ data, nome }));
  });
}
async function salvarFeriados(novaLista) {
  try {
    await api('/config', { method: 'PUT', body: { feriados_extras: novaLista } });
    estado.config.feriados_extras = novaLista;
    toast('Feriados atualizados');
    const aberto = !$('ferBox')?.hidden;
    consultar();
    setTimeout(() => { if (aberto && $('ferBox')) $('ferBox').hidden = false; }, 300);
  } catch (err) { toast(err.message); }
}

function excelHorario(r) {
  const t = r.totais;
  const reg = { ...REGRAS_PADRAO, ...(r.regras || {}) };
  const criterio = `Expediente de segunda a sexta, das ${pad2(reg.inicioExpediente)}h às ${pad2(reg.fimExpediente)}h, e sábado das ${pad2(reg.inicioExpediente)}h às ${pad2(reg.fimSabado)}h. Domingos e feriados contam o dia inteiro como fora do horário. Viagem que encosta no período fora do expediente conta inteira. Viagens de até ${String(reg.kmIgnorarAte).replace('.', ',')} km desconsideradas.`;
  const feriados = r.feriadosNoPeriodo.length ? r.feriadosNoPeriodo.map((f) => `${diaBR(f.data)} (${f.nome})`).join('; ') : 'Nenhum';
  const L = []; const alt = {};
  L.push([{ v: 'Uso de veículos fora do horário de expediente', s: E.titulo }]); alt[0] = 24;
  L.push([{ v: `Rezende Energia · gerado em ${fmtDataHora(new Date())} por ${usuario?.nome || usuario?.email} a partir do histórico do rastreamento veicular`, s: E.subtitulo }]);
  L.push([]);
  L.push([{ v: 'Período consultado', s: E.rotulo }, textoPer()]);
  L.push([{ v: 'Critério', s: E.rotulo }, { v: criterio, s: E.quebra }]); alt[4] = 30;
  L.push([{ v: 'Feriados no período', s: E.rotulo }, { v: feriados, s: E.quebra }]);
  L.push([]);
  const k = (rot, val, est = E.destaque) => L.push([{ v: rot, s: E.rotulo }, { v: val, s: est }]);
  k('Viagens fora do horário', `${t.viagensFora} (de ${t.viagensNaPlanilha} viagens no período)`);
  k('Km rodados', `${fmtKm(t.km)} km`);
  k('Tempo em movimento', fmtDuracao(t.duracaoSeg));
  k('Veículos envolvidos', `${t.veiculos}`);
  k('Motoristas identificados', `${t.motoristas}`);
  k('Viagens sem motorista', t.semMotorista ? `${t.semMotorista} (sem identificação no rastreador)` : '0', t.semMotorista ? E.alerta : E.destaque);
  L.push([]);
  const cab = (a, b) => [a, b, 'Viagens', 'Dias', 'Km', 'Tempo', 'Primeira saída', 'Último retorno'].map((v) => ({ v, s: E.cabecalho }));
  const lin = (nome, outros, g) => [{ v: nome, s: E.texto }, { v: outros, s: E.texto }, { v: g.viagens, s: E.inteiro }, { v: g.dias, s: E.inteiro }, { v: g.km, s: E.decimal }, { v: durExcel(g.duracaoSeg), s: E.duracao }, { v: g.primeira, s: E.dataHora }, { v: g.ultima, s: E.dataHora }];
  const tot = (gs) => [{ v: 'Total', s: E.totalTexto }, { v: '', s: E.totalTexto }, { v: gs.reduce((s, g) => s + g.viagens, 0), s: E.totalInteiro }, { v: '', s: E.totalTexto }, { v: gs.reduce((s, g) => s + g.km, 0), s: E.totalDecimal }, { v: durExcel(gs.reduce((s, g) => s + g.duracaoSeg, 0)), s: E.totalDuracao }, { v: '', s: E.totalTexto }, { v: '', s: E.totalTexto }];
  L.push([{ v: 'Por motorista', s: E.rotulo }]); L.push(cab('Motorista', 'Veículo(s)')); alt[L.length - 1] = 20;
  r.porMotorista.forEach((g) => L.push(lin(nomeExib(g.chave), g.veiculos.join(', '), g)));
  L.push(tot(r.porMotorista)); L.push([]);
  L.push([{ v: 'Por veículo', s: E.rotulo }]); L.push(cab('Veículo', 'Motorista(s)')); alt[L.length - 1] = 20;
  r.porVeiculo.forEach((g) => L.push(lin(g.chave, g.motoristas.join(', '), g)));
  L.push(tot(r.porVeiculo));
  const resumo = { nome: 'Resumo', larguras: [30, 34, 9, 7, 9, 9, 18, 18], linhas: L, alturas: alt, mesclar: ['A1:H1', 'A2:H2', 'B4:H4', 'B5:H5', 'B6:H6'] };

  const temVelMax = r.viagens.some((v) => v.velMax != null);
  const cabV = ['Data', 'Dia da semana', 'Motivo', 'Veículo', 'Motorista', 'Início', 'Fim', 'Duração', 'Km', 'Vel. média (km/h)'].concat(temVelMax ? ['Vel. máx. (km/h)'] : []).concat(['Origem', 'Destino', 'Coord. inicial', 'Coord. final', 'Trajeto no mapa']);
  const V = [[{ v: 'Viagens fora do horário de expediente', s: E.titulo }], [{ v: `Período: ${textoPer()} · ${t.viagensFora} viagens · ${fmtKm(t.km)} km`, s: E.subtitulo }], cabV.map((v) => ({ v, s: E.cabecalho }))];
  for (const v of r.viagens) {
    const mapa = linkTrajeto(v.coordIni, v.coordFim);
    V.push([
      { v: fmtData(v.inicio), s: E.texto }, { v: diaSemana(v.inicio), s: E.texto }, { v: v.motivo, s: E.texto },
      { v: v.veiculo, s: E.texto }, { v: v.motorista || NAO_IDENTIFICADO, s: E.texto },
      { v: v.inicio, s: E.dataHora }, { v: v.fim, s: E.dataHora }, { v: durExcel(v.duracaoSeg), s: E.duracao },
      { v: v.km, s: E.decimal }, { v: v.velMedia ?? '', s: E.inteiro }, ...(temVelMax ? [{ v: v.velMax ?? '', s: E.inteiro }] : []),
      { v: v.origem, s: E.texto }, { v: v.destino, s: E.texto }, { v: v.coordIni, s: E.texto }, { v: v.coordFim, s: E.texto },
      mapa ? { v: 'Abrir trajeto', link: mapa, s: E.link } : { v: '', s: E.texto },
    ]);
  }
  const viagens = { nome: 'Viagens', larguras: [11, 13, 18, 11, 34, 16, 16, 9, 8, 9, ...(temVelMax ? [9] : []), 44, 44, 22, 22, 14], linhas: V, alturas: { 0: 22, 2: 30 }, mesclar: ['A1:H1', 'A2:H2'], congelar: { linha: 3, coluna: 0 }, filtro: `A3:${String.fromCharCode(64 + cabV.length)}${V.length}`, paisagem: true };
  return gerarXlsx([resumo, viagens], { titulo: 'Uso de veículos fora do horário', autor: 'Rezende Energia' });
}

function emailHorario(r) {
  const t = r.totais;
  const L = [`Assunto: Uso de veículos fora do horário — ${textoPer()}`, '', 'Prezado,', '',
    `Segue o levantamento de uso da frota fora do horário de expediente (seg. a sex., 08h às 19h; sábado, 08h às 12h; domingos e feriados contam o dia todo), no período de ${textoPer()}, com base no rastreamento veicular.`, ''];
  if (!t.viagensFora) L.push('Não foram identificadas viagens fora do horário no período.');
  else {
    L.push(`• ${t.viagensFora} viagens fora do horário, somando ${fmtKm(t.km)} km e ${fmtDuracao(t.duracaoSeg)} em movimento;`);
    L.push(`• ${t.veiculos} veículos e ${t.motoristas} motoristas identificados${t.semMotorista ? `; ${t.semMotorista} viagens sem motorista identificado no rastreador` : ''}.`);
    L.push('', 'Por motorista (km fora do horário):');
    r.porMotorista.forEach((g, i) => L.push(`${i + 1}. ${nomeExib(g.chave)} (${g.veiculos.join(', ')}) — ${fmtKm(g.km)} km em ${g.viagens} viage${g.viagens > 1 ? 'ns' : 'm'}`));
  }
  L.push('', 'O detalhamento de cada viagem (horários, origem, destino e trajeto no mapa) está na planilha em anexo.', '', 'Atenciosamente,');
  return L.join('\n');
}

// ======================= MOTOR LIGADO PARADO =======================
const trechoDoBanco = (r) => ({
  veiculo: r.veiculo, motorista: r.motorista || '', inicio: parseDataHora(r.inicio), fim: parseDataHora(r.fim),
  movimentoSeg: r.movimento_seg, motorSeg: r.motor_seg, ociosoSeg: r.ocioso_seg || 0,
  origem: r.origem || '', destino: r.destino || '',
  odometroIni: r.odometro_ini == null ? null : Number(r.odometro_ini), odometroFim: r.odometro_fim == null ? null : Number(r.odometro_fim),
  deslocamentoKm: r.deslocamento_km == null ? null : Number(r.deslocamento_km),
});

const textoPrecos = (precos) => {
  const p = precos?.precos || {};
  const parte = (k, nome) => (p[k]?.preco ? `${nome} ${fmtBRL(Number(p[k].preco))}/L (${p[k].fonte}${p[k].n ? `, ${p[k].n} abastecimentos` : ''})` : `${nome}: sem preço`);
  return `${parte('diesel', 'Diesel')} · ${parte('gasolina', 'Gasolina')}`;
};

function renderOcioso(linhasBanco, precos) {
  const pane = $('pane-ocioso');
  const limiteMin = estado.config.ociosidade_minutos;
  const litrosHora = estado.config.litros_hora_ocioso;
  const meta = estado.config.meta || {};
  const atualizado = meta.litros_hora_ocioso?.atualizado_por ? `alterado por ${escH(meta.litros_hora_ocioso.atualizado_por)} em ${fmtDataHora(new Date(meta.litros_hora_ocioso.atualizado_em))}` : 'valor padrão';
  const paramsHtml = `
    <div class="card params">
      <label class="f">Alerta acima de (min)<input class="in" type="number" id="oLimite" min="1" max="120" step="1" value="${limiteMin}"></label>
      <label class="f">Consumo parado (L/h)<input class="in" type="number" id="oLh" min="0.1" max="20" step="0.1" value="${litrosHora}"></label>
      <button class="btn no-print" type="button" id="oSalvar">Salvar parâmetros</button>
      <div class="info">
        <b>Como é calculado:</b> cada trecho do rastreador com mais de ${limiteMin} min de motor ligado parado vira um alerta. Litros = horas paradas com motor ligado × ${String(litrosHora).replace('.', ',')} L/h (${atualizado}). R$ = litros × preço médio pago no período no sistema de abastecimento.<br>
        <b>Preços usados:</b> ${escH(textoPrecos(precos))}. Veículos sem cadastro (ex.: lanchas) usam a média dos dois.
      </div>
    </div>`;

  const trechos = linhasBanco.map(trechoDoBanco);
  if (!trechos.length) {
    estado.ocioso = null;
    pane.innerHTML = paramsHtml + vazio('Nenhum dado de motor ligado parado para este período', 'Importe o relatório de ociosidade do rastreador ou escolha outro período.');
    ligarParams();
    return;
  }
  const r = analisarOciosidade(trechos, { limiteMin, litrosHora, precos });
  estado.ocioso = r;
  const t = r.totais;
  const h = (s) => fmtDuracao(s);

  let corpo = '';
  if (!t.alertas) corpo = vazio('Nenhum alerta neste período', `${fmtInt(t.trechos)} trechos analisados.`);
  else {
    const maxV = Math.max(...r.porVeiculo.map((g) => g.ociosoAlertaSeg), 1);
    const maxM = Math.max(...r.porMotorista.map((g) => g.ociosoAlertaSeg), 1);
    corpo = `
    <section class="card">
      <h2 class="sec">Por veículo <span class="n">${r.porVeiculo.length}</span></h2>
      <div class="tbl-wrap"><table>
        <thead><tr><th>Veículo</th><th>Motorista(s)</th><th class="num">Alertas</th><th class="num">Parado c/ motor</th><th class="num">% do motor parado</th><th class="num">Maior</th><th class="num">Litros est.</th><th class="num">R$ est.</th></tr></thead>
        <tbody>${r.porVeiculo.map((g) => `
          <tr>
            <td class="nw"><b>${escH(g.chave)}</b><div class="bar"><span style="width:${Math.max(3, (g.ociosoAlertaSeg / maxV) * 100)}%"></span></div></td>
            <td>${g.motoristas.map((m) => (m === NAO_IDENTIFICADO ? '<span class="ni">Não identificado</span>' : escH(m))).join('<br>')}</td>
            <td class="num">${g.alertas}</td><td class="num">${h(g.ociosoAlertaSeg)}</td>
            <td class="num">${fmtPct(g.pctOcioso)}</td><td class="num">${h(g.maiorAlertaSeg)}</td>
            <td class="num">${fmtL(g.litros)}</td><td class="num">${fmtBRL(g.custo)}${g.precoEstimado ? '<span class="muted" title="Veículo sem combustível cadastrado: média diesel/gasolina"> *</span>' : ''}</td>
          </tr>`).join('')}</tbody>
      </table></div>
      ${r.porVeiculo.some((g) => g.precoEstimado) ? '<div class="hint" style="margin-top:8px">* veículo sem combustível cadastrado no sistema de abastecimento: usada a média diesel/gasolina.</div>' : ''}
    </section>
    <section class="card">
      <h2 class="sec">Por motorista <span class="n">${r.porMotorista.length}</span></h2>
      <div class="tbl-wrap"><table>
        <thead><tr><th>Motorista</th><th>Veículo(s)</th><th class="num">Alertas</th><th class="num">Dias</th><th class="num">Parado c/ motor</th><th class="num">Maior</th><th class="num">Litros est.</th><th class="num">R$ est.</th></tr></thead>
        <tbody>${r.porMotorista.map((g) => `
          <tr>
            <td>${nomeHtml(g.chave)}<div class="bar"><span style="width:${Math.max(3, (g.ociosoAlertaSeg / maxM) * 100)}%"></span></div></td>
            <td class="nw">${g.veiculos.map(escH).join('<br>')}</td>
            <td class="num">${g.alertas}</td><td class="num">${g.dias}</td><td class="num">${h(g.ociosoAlertaSeg)}</td>
            <td class="num">${h(g.maiorAlertaSeg)}</td><td class="num">${fmtL(g.litros)}</td><td class="num">${fmtBRL(g.custo)}</td>
          </tr>`).join('')}</tbody>
      </table></div>
    </section>
    <section class="card quebra">
      <h2 class="sec">Alertas <span class="n" id="oNAl"></span></h2>
      <div class="filtro-tbl no-print">
        <select class="in" id="oFiltro"><option value="">Todos os motoristas / veículos</option>
          ${r.porMotorista.map((g) => `<option value="m:${escH(g.chave)}">${escH(g.chave.startsWith(NAO_IDENTIFICADO) ? `Não identificado (${g.veiculos[0]})` : g.chave)}</option>`).join('')}
          ${r.porVeiculo.map((g) => `<option value="v:${escH(g.chave)}">Veículo ${escH(g.chave)}</option>`).join('')}
        </select>
        <select class="in" id="oOrdem"><option value="data">Ordenar por data</option><option value="tempo">Ordenar por tempo parado</option></select>
      </div>
      <div class="tbl-wrap"><table id="oTabela"></table></div>
    </section>`;
  }

  pane.innerHTML = `
    ${cabImpressao('Veículos parados com motor ligado')}
    ${paramsHtml}
    ${acoes('ocioso')}
    <div class="kpis">
      ${kpi('Alertas', fmtInt(t.alertas), `trechos com mais de ${limiteMin} min, de ${fmtInt(t.trechos)}`)}
      ${kpi('Parado c/ motor ligado', h(t.ociosoAlertaSeg), `${fmtPct(t.motorSeg ? t.ociosoTotalSeg / t.motorSeg : null)} de todo o tempo de motor`)}
      ${kpi('Litros estimados', fmtL(t.litros), `a ${String(litrosHora).replace('.', ',')} L/h`)}
      ${kpi('Custo estimado', fmtBRL(t.custo), 'preço médio pago no período')}
      ${kpi('Veículos', fmtInt(t.veiculos), `${fmtInt(t.motoristas)} motoristas identificados`)}
      ${kpi('Sem motorista', h(t.ociosoSemMotoristaSeg), t.alertasSemMotorista ? `${fmtInt(t.alertasSemMotorista)} alertas sem identificação` : 'todos identificados', t.alertasSemMotorista ? 'warn' : '')}
    </div>
    ${corpo}`;

  ligarParams();
  if (t.alertas) {
    $('oFiltro').addEventListener('change', renderTabelaOcioso);
    $('oOrdem').addEventListener('change', renderTabelaOcioso);
    renderTabelaOcioso();
  }
}

function renderTabelaOcioso() {
  const r = estado.ocioso;
  if (!r || !$('oTabela')) return;
  const f = $('oFiltro').value;
  const chaveMot = (a) => (a.motorista ? a.motorista : `${NAO_IDENTIFICADO} · ${a.veiculo}`);
  let lista = r.alertas.filter((a) => !f || (f.startsWith('m:') && chaveMot(a) === f.slice(2)) || (f.startsWith('v:') && a.veiculo === f.slice(2)));
  if ($('oOrdem').value === 'tempo') lista = [...lista].sort((a, b) => b.ociosoSeg - a.ociosoSeg);
  $('oNAl').textContent = `${lista.length}${f ? ` de ${r.alertas.length}` : ''}`;
  const limite = 500; // tabela da tela; o Excel leva todos
  $('oTabela').innerHTML = `
    <thead><tr><th>Data</th><th>Veículo</th><th>Motorista</th><th>Início</th><th>Fim</th><th class="num">Parado c/ motor</th><th class="num">Motor ligado</th><th class="num">Litros est.</th><th class="num">R$ est.</th><th>Local</th></tr></thead>
    <tbody>${lista.slice(0, limite).map((a) => `
      <tr>
        <td class="nw">${fmtData(a.inicio)}<div class="muted">${diaSemana(a.inicio)}</div></td>
        <td class="nw"><b>${escH(a.veiculo)}</b></td>
        <td>${a.motorista ? escH(a.motorista) : '<span class="ni">Não identificado</span>'}</td>
        <td class="nw">${fmtHora(a.inicio)}</td>
        <td class="nw">${fmtData(a.fim) !== fmtData(a.inicio) ? `${fmtData(a.fim)} ` : ''}${fmtHora(a.fim)}</td>
        <td class="num"><b>${fmtDuracao(a.ociosoSeg)}</b></td><td class="num">${fmtDuracao(a.motorSeg)}</td>
        <td class="num">${a.litros.toLocaleString('pt-BR', { maximumFractionDigits: 1 })} L</td><td class="num">${fmtBRL(a.custo)}</td>
        <td class="addr">${escH(a.origem || '—')}${a.destino && a.destino !== a.origem ? `<br><span class="muted">→ ${escH(a.destino)}</span>` : ''}</td>
      </tr>`).join('')}
      ${lista.length > limite ? `<tr><td colspan="10" class="muted">Mostrando ${limite} de ${lista.length} alertas na tela. O Excel traz todos.</td></tr>` : ''}
    </tbody>`;
}

function ligarParams() {
  $('oSalvar')?.addEventListener('click', async () => {
    const limite = Number($('oLimite').value), lh = Number(String($('oLh').value).replace(',', '.'));
    if (!(limite >= 1 && limite <= 120) || !(lh >= 0.1 && lh <= 20)) { toast('Valores fora do permitido'); return; }
    try {
      await api('/config', { method: 'PUT', body: { ociosidade_minutos: limite, litros_hora_ocioso: lh } });
      await carregarConfig();
      toast('Parâmetros salvos');
      consultar();
    } catch (err) { toast(err.message); }
  });
}

function excelOcioso(r) {
  const t = r.totais;
  const { limiteMin, litrosHora } = r.parametros;
  const L = []; const alt = {};
  const criterio = `Alerta: trecho do rastreador com mais de ${limiteMin} min de motor ligado com o veículo parado (o rastreador soma o tempo parado dentro de cada trecho). Litros estimados = horas paradas com motor ligado × ${String(litrosHora).replace('.', ',')} L/h. Custo = litros × preço médio pago no período (sistema de abastecimento).`;
  L.push([{ v: 'Veículos parados com motor ligado', s: E.titulo }]); alt[0] = 24;
  L.push([{ v: `Rezende Energia · gerado em ${fmtDataHora(new Date())} por ${usuario?.nome || usuario?.email} a partir do histórico do rastreamento veicular`, s: E.subtitulo }]);
  L.push([]);
  L.push([{ v: 'Período consultado', s: E.rotulo }, textoPer()]);
  L.push([{ v: 'Critério', s: E.rotulo }, { v: criterio, s: E.quebra }]); alt[4] = 42;
  L.push([{ v: 'Preços usados', s: E.rotulo }, { v: textoPrecos({ precos: r.precos }), s: E.quebra }]); alt[5] = 28;
  L.push([]);
  const k = (rot, val, est = E.destaque) => L.push([{ v: rot, s: E.rotulo }, { v: val, s: est }]);
  k('Alertas', `${t.alertas} (de ${t.trechos} trechos no período)`);
  k('Parado c/ motor (alertas)', fmtDuracao(t.ociosoAlertaSeg));
  k('% do tempo de motor parado', fmtPct(t.motorSeg ? t.ociosoTotalSeg / t.motorSeg : null));
  k('Litros estimados', fmtL(t.litros));
  k('Custo estimado', fmtBRL(t.custo));
  k('Sem motorista identificado', t.alertasSemMotorista ? `${fmtDuracao(t.ociosoSemMotoristaSeg)} (${t.alertasSemMotorista} alertas)` : '0', t.alertasSemMotorista ? E.alerta : E.destaque);
  L.push([]);
  const cab = (a, b) => [a, b, 'Alertas', 'Dias', 'Parado c/ motor', '% motor parado', 'Maior parada', 'Litros est.', 'R$ est.'].map((v) => ({ v, s: E.cabecalho }));
  const lin = (nome, outros, g) => [{ v: nome, s: E.texto }, { v: outros, s: E.texto }, { v: g.alertas, s: E.inteiro }, { v: g.dias, s: E.inteiro }, { v: durExcel(g.ociosoAlertaSeg), s: E.duracao }, { v: g.pctOcioso ?? '', s: E.pct }, { v: durExcel(g.maiorAlertaSeg), s: E.duracao }, { v: g.litros, s: E.decimal }, { v: g.custo, s: E.moeda }];
  const tot = (gs) => [{ v: 'Total', s: E.totalTexto }, { v: '', s: E.totalTexto }, { v: gs.reduce((s, g) => s + g.alertas, 0), s: E.totalInteiro }, { v: '', s: E.totalTexto }, { v: durExcel(gs.reduce((s, g) => s + g.ociosoAlertaSeg, 0)), s: E.totalDuracao }, { v: '', s: E.totalTexto }, { v: '', s: E.totalTexto }, { v: gs.reduce((s, g) => s + g.litros, 0), s: E.totalDecimal }, { v: gs.reduce((s, g) => s + g.custo, 0), s: E.totalMoeda }];
  L.push([{ v: 'Por veículo', s: E.rotulo }]); L.push(cab('Veículo', 'Motorista(s)')); alt[L.length - 1] = 30;
  r.porVeiculo.forEach((g) => L.push(lin(g.chave, g.motoristas.join(', '), g)));
  L.push(tot(r.porVeiculo)); L.push([]);
  L.push([{ v: 'Por motorista', s: E.rotulo }]); L.push(cab('Motorista', 'Veículo(s)')); alt[L.length - 1] = 30;
  r.porMotorista.forEach((g) => L.push(lin(nomeExib(g.chave), g.veiculos.join(', '), g)));
  L.push(tot(r.porMotorista));
  const resumo = { nome: 'Resumo', larguras: [34, 34, 9, 7, 12, 11, 11, 10, 13], linhas: L, alturas: alt, mesclar: ['A1:I1', 'A2:I2', 'B4:I4', 'B5:I5', 'B6:I6'] };

  const cabA = ['Data', 'Dia da semana', 'Veículo', 'Motorista', 'Início', 'Fim', 'Parado c/ motor', 'Motor ligado', 'Em movimento', 'Litros est.', 'R$ est.', 'Local inicial', 'Local final', 'Hodômetro inicial', 'Hodômetro final'];
  const A = [[{ v: 'Alertas de motor ligado parado', s: E.titulo }], [{ v: `Período: ${textoPer()} · ${t.alertas} alertas · ${fmtDuracao(t.ociosoAlertaSeg)} · ${fmtBRL(t.custo)} estimados`, s: E.subtitulo }], cabA.map((v) => ({ v, s: E.cabecalho }))];
  for (const a of r.alertas) {
    A.push([
      { v: fmtData(a.inicio), s: E.texto }, { v: diaSemana(a.inicio), s: E.texto }, { v: a.veiculo, s: E.texto }, { v: a.motorista || NAO_IDENTIFICADO, s: E.texto },
      { v: a.inicio, s: E.dataHora }, { v: a.fim, s: E.dataHora }, { v: durExcel(a.ociosoSeg), s: E.duracao }, { v: durExcel(a.motorSeg), s: E.duracao }, { v: durExcel(a.movimentoSeg), s: E.duracao },
      { v: a.litros, s: E.decimal }, { v: a.custo ?? '', s: E.moeda }, { v: a.origem, s: E.texto }, { v: a.destino, s: E.texto },
      { v: a.odometroIni ?? '', s: E.decimal }, { v: a.odometroFim ?? '', s: E.decimal },
    ]);
  }
  const alertas = { nome: 'Alertas', larguras: [11, 13, 11, 34, 16, 16, 11, 11, 11, 9, 11, 44, 44, 12, 12], linhas: A, alturas: { 0: 22, 2: 30 }, mesclar: ['A1:H1', 'A2:H2'], congelar: { linha: 3, coluna: 0 }, filtro: `A3:O${A.length}`, paisagem: true };
  return gerarXlsx([resumo, alertas], { titulo: 'Veículos parados com motor ligado', autor: 'Rezende Energia' });
}

function emailOcioso(r) {
  const t = r.totais;
  const { limiteMin, litrosHora } = r.parametros;
  const L = [`Assunto: Veículos parados com motor ligado — ${textoPer()}`, '', 'Prezado,', '',
    `Segue o levantamento de veículos parados com motor ligado por mais de ${limiteMin} minutos no período de ${textoPer()}, com base no rastreamento veicular.`, ''];
  if (!t.alertas) L.push('Não foram identificados alertas no período.');
  else {
    L.push(`• ${t.alertas} ocorrências, somando ${fmtDuracao(t.ociosoAlertaSeg)} parados com motor ligado (${fmtPct(t.motorSeg ? t.ociosoTotalSeg / t.motorSeg : null)} de todo o tempo de motor ligado);`);
    L.push(`• Estimativa de ${fmtL(t.litros)} de combustível, cerca de ${fmtBRL(t.custo)} (${String(litrosHora).replace('.', ',')} L/h × preço médio pago no período);`);
    if (t.alertasSemMotorista) L.push(`• ${fmtDuracao(t.ociosoSemMotoristaSeg)} sem motorista identificado no rastreador.`);
    L.push('', 'Veículos com mais tempo parado com motor ligado:');
    r.porVeiculo.slice(0, 10).forEach((g, i) => L.push(`${i + 1}. ${g.chave} (${g.motoristas.map((m) => (m === NAO_IDENTIFICADO ? 'não identificado' : m)).join(', ')}) — ${fmtDuracao(g.ociosoAlertaSeg)}, ~${fmtBRL(g.custo)}`));
  }
  L.push('', 'O detalhamento de cada ocorrência (horário, local e tempo) está na planilha em anexo.', '', 'Atenciosamente,');
  return L.join('\n');
}

// ======================= ações (Excel / PDF / e-mail) =======================
const nomeSaida = (base) => `${base}_${estado.de}${estado.ate !== estado.de ? `_a_${estado.ate}` : ''}.xlsx`;
document.addEventListener('click', (ev) => {
  const b = ev.target.closest('[data-acao]');
  if (!b) return;
  const [acao, aba] = b.dataset.acao.split('-');
  const r = aba === 'horario' ? estado.horario : estado.ocioso;
  if (!r) return;
  if (acao === 'excel') baixar(aba === 'horario' ? excelHorario(r) : excelOcioso(r), nomeSaida(aba === 'horario' ? 'Fora_de_horario' : 'Motor_ligado_parado'));
  else if (acao === 'email') copiarOuEmail(aba === 'horario' ? emailHorario(r) : emailOcioso(r));
  else if (acao === 'pdf') {
    const filtro = $(aba === 'horario' ? 'hFiltro' : 'oFiltro');
    const antes = filtro?.value;
    if (antes) { filtro.value = ''; aba === 'horario' ? renderTabelaHorario() : renderTabelaOcioso(); }
    window.print();
    if (antes) { filtro.value = antes; aba === 'horario' ? renderTabelaHorario() : renderTabelaOcioso(); }
  }
});

// ======================= IMPORTAÇÕES =======================
function renderImportacoes(lista) {
  const pane = $('pane-importacoes');
  if (!lista.length) { pane.innerHTML = vazio('Nenhuma importação ainda', 'Use o campo acima para importar a primeira planilha.'); return; }
  const fmtTs = (v) => (v ? fmtDataHora(parseDataHora(v)) : '—');
  pane.innerHTML = `
    <section class="card">
      <h2 class="sec">Planilhas importadas <span class="n">${lista.length}</span></h2>
      <div class="hint" style="margin-bottom:10px">Cada arquivo original fica guardado como evidência. "Já existiam" são linhas que outra planilha já tinha trazido; elas não foram duplicadas.</div>
      <div class="tbl-wrap"><table>
        <thead><tr><th>Importado em</th><th>Tipo</th><th>Arquivo</th><th>Período do arquivo</th><th class="num">Linhas</th><th class="num">Novas</th><th class="num">Já existiam</th><th>Por</th><th></th></tr></thead>
        <tbody>${lista.map((i) => `
          <tr>
            <td class="nw">${fmtDataHora(new Date(i.importado_em))}</td>
            <td><span class="tag ${i.tipo === 'viagens' ? '' : 'fds'}">${i.tipo === 'viagens' ? 'Horário' : 'Motor parado'}</span></td>
            <td>${escH(i.arquivo_nome)}<div class="muted">${i.arquivo_bytes ? `${Math.max(1, Math.round(i.arquivo_bytes / 1024))} KB` : ''}</div></td>
            <td class="nw">${fmtTs(i.periodo_de)}<br><span class="muted">até ${fmtTs(i.periodo_ate)}</span></td>
            <td class="num">${fmtInt(i.registros)}</td><td class="num">${fmtInt(i.novos)}</td><td class="num">${fmtInt(i.duplicados)}</td>
            <td style="word-break:break-all">${escH(i.importado_por)}</td>
            <td><div style="display:flex;flex-direction:column;gap:6px;align-items:stretch">
              <a class="btn sm" style="justify-content:center;text-decoration:none" href="/api/rast/evidencia/${i.id}">Arquivo original</a>
              ${i.periodo_de ? `<button class="btn sm" style="justify-content:center" type="button" data-ver="${i.id}">Ver análise</button>` : ''}
            </div></td>
          </tr>`).join('')}</tbody>
      </table></div>
    </section>`;
  pane.querySelectorAll('[data-ver]').forEach((b) => b.addEventListener('click', () => {
    const i = lista.find((x) => String(x.id) === b.dataset.ver);
    definirPeriodo(parseDataHora(i.periodo_de), parseDataHora(i.periodo_ate));
    trocarAba(i.tipo === 'viagens' ? 'horario' : 'ocioso');
  }));
}

// ======================= USUÁRIOS (admin) =======================
function senhaAleatoria() {
  const c = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789';
  const a = crypto.getRandomValues(new Uint32Array(10));
  return Array.from(a, (x) => c[x % c.length]).join('');
}

function renderUsuarios(lista) {
  const pane = $('pane-usuarios');
  pane.innerHTML = `
    <section class="card">
      <h2 class="sec">Novo acesso</h2>
      <form class="form-row" id="formUsuario">
        <label class="f">Nome<input class="in" id="uNome" required placeholder="Ex.: Gestão de Frota"></label>
        <label class="f">E-mail<input class="in" id="uEmail" type="email" required></label>
        <label class="f" style="flex:0 0 150px">Perfil<select class="in" id="uPapel"><option value="usuario">Usuário</option><option value="admin">Administrador</option></select></label>
        <label class="f">Senha temporária<input class="in" id="uSenha" required minlength="8"></label>
        <button class="btn primary" type="submit">Criar acesso</button>
      </form>
      <div class="hint" style="margin-top:8px">Passe a senha temporária para a pessoa por um canal seguro; no primeiro acesso ela é obrigada a trocar. Usuário vê e importa; administrador também gerencia acessos.</div>
    </section>
    <section class="card">
      <h2 class="sec">Acessos <span class="n">${lista.length}</span></h2>
      <div class="tbl-wrap"><table>
        <thead><tr><th>Nome</th><th>E-mail</th><th>Perfil</th><th>Situação</th><th>Último acesso</th><th></th></tr></thead>
        <tbody>${lista.map((u) => `
          <tr>
            <td>${escH(u.nome || '—')}</td><td>${escH(u.email)}</td>
            <td>${u.papel === 'admin' ? 'Administrador' : 'Usuário'}</td>
            <td>${u.ativo ? (u.trocar_senha ? '<span class="tag">Aguardando 1º acesso</span>' : '<span class="tag ok">Ativo</span>') : '<span class="tag off">Desativado</span>'}</td>
            <td class="nw">${u.ultimo_acesso ? fmtDataHora(new Date(u.ultimo_acesso)) : '—'}</td>
            <td class="nw">${u.email === usuario.email ? '<span class="muted">você</span>' : `
              <button class="btn sm" type="button" data-reset="${escH(u.email)}">Nova senha temporária</button>
              <button class="btn sm" type="button" data-ativo="${escH(u.email)}" data-v="${u.ativo ? '0' : '1'}">${u.ativo ? 'Desativar' : 'Reativar'}</button>`}
            </td>
          </tr>`).join('')}</tbody>
      </table></div>
    </section>`;
  $('uSenha').value = senhaAleatoria();
  $('formUsuario').addEventListener('submit', async (ev) => {
    ev.preventDefault();
    try {
      const email = $('uEmail').value.trim(), senha = $('uSenha').value;
      await api('/usuarios', { method: 'POST', body: { nome: $('uNome').value, email, papel: $('uPapel').value, senha } });
      alertaSenha(email, senha);
      consultar();
    } catch (err) { toast(err.message); }
  });
  pane.querySelectorAll('[data-reset]').forEach((b) => b.addEventListener('click', async () => {
    const senha = senhaAleatoria();
    try { await api(`/usuarios/${encodeURIComponent(b.dataset.reset)}`, { method: 'PATCH', body: { novaSenha: senha } }); alertaSenha(b.dataset.reset, senha); consultar(); } catch (err) { toast(err.message); }
  }));
  pane.querySelectorAll('[data-ativo]').forEach((b) => b.addEventListener('click', async () => {
    try { await api(`/usuarios/${encodeURIComponent(b.dataset.ativo)}`, { method: 'PATCH', body: { ativo: b.dataset.v === '1' } }); consultar(); } catch (err) { toast(err.message); }
  }));
}
function alertaSenha(email, senha) {
  msgImport('ok', `Acesso de <b>${escH(email)}</b> pronto. Senha temporária: <b style="font-family:monospace;font-size:15px">${escH(senha)}</b> — envie à pessoa; ela troca no primeiro acesso. Esta senha não aparece de novo.`);
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

// ======================= início =======================
(async () => {
  try {
    const res = await fetch('/api/rast/eu', { credentials: 'same-origin' });
    const data = await res.json().catch(() => ({}));
    if (res.status === 503) {
      mostrarTela('telaLogin');
      $('loginErro').textContent = data.erro || 'Serviço ainda não configurado.';
      $('loginErro').hidden = false;
      return;
    }
    if (!res.ok) { mostrarLogin(); return; }
    entrou(data);
  } catch { mostrarLogin('Sem conexão com o servidor.'); }
})();
