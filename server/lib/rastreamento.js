// API do histórico de rastreamento (/rastreamento): login pela conta Microsoft
// corporativa, importação das planilhas do rastreador, consulta por período,
// evidências e usuários.
//
// ACESSO: só pela conta Microsoft @rezendeenergia.com.br. A lista de quem pode
// entrar continua sendo a tabela rast_usuarios (administrador libera o e-mail na
// aba Usuários). Não existe mais senha neste sistema.
//
// Todo acesso ao Supabase (projeto Abast) é feito AQUI, com a chave de serviço
// guardada no Render. O navegador nunca recebe chave do Supabase — as tabelas
// rast_* ficam com RLS ligado e sem políticas, fechadas para anon/authenticated.
//
// Variáveis de ambiente:
//   RAST_SUPABASE_URL          (padrão: projeto Abast)
//   RAST_SUPABASE_SERVICE_KEY  chave service_role / sb_secret_… do projeto Abast  [obrigatória]
//   RAST_SESSION_SECRET        texto aleatório longo para assinar a sessão        [obrigatória]
//   RAST_ADMIN_EMAIL           e-mail do 1º administrador (padrão ti@rezendeenergia.com.br);
//                              se a tabela não tiver esse e-mail, ele entra como admin no 1º login
//   SHAREPOINT_CLIENT_ID / SHAREPOINT_CLIENT_SECRET / SHAREPOINT_TENANT_ID
//                              mesmo App Registration do Azure já usado pelo painel (e pelo CromFolgas);
//                              AZURE_CLIENT_ID / AZURE_CLIENT_SECRET / AZURE_TENANT_ID têm preferência se existirem
//   RAST_REDIRECT_URI          (opcional) endereço de retorno; padrão https://<host>/api/rast/auth/callback.
//                              Precisa estar cadastrado no App Registration (Authentication → Redirect URIs).

import express from 'express';
import crypto from 'node:crypto';
import { ConfidentialClientApplication } from '@azure/msal-node';

const SB_URL = (process.env.RAST_SUPABASE_URL || 'https://horvznvaytzhwrmwjwxv.supabase.co').replace(/\/$/, '');
const SB_KEY = process.env.RAST_SUPABASE_SERVICE_KEY || '';
const SESSION_SECRET = process.env.RAST_SESSION_SECRET || '';
const ADMIN_EMAIL = (process.env.RAST_ADMIN_EMAIL || 'ti@rezendeenergia.com.br').trim().toLowerCase();
const DOMINIO = 'rezendeenergia.com.br';
const BUCKET = 'rast-evidencias';
const COOKIE = 'rast_sess';
const COOKIE_LOGIN = 'rast_login'; // guarda o "state" durante a ida e volta da Microsoft
const SESSAO_HORAS = 12;

export const configurado = () => Boolean(SB_KEY && SESSION_SECRET);

// ---------------- Supabase (REST) ----------------
// Permite trocar o fetch nos testes.
let _fetch = (...a) => fetch(...a);
export function _setFetch(f) { _fetch = f; }

function sbHeaders(extra = {}) {
  const h = { apikey: SB_KEY, ...extra };
  // Chave legada (JWT) vai também no Authorization; chave nova sb_secret_ só no apikey.
  if (SB_KEY.startsWith('eyJ')) h.Authorization = `Bearer ${SB_KEY}`;
  return h;
}

async function sb(path, { method = 'GET', body, headers = {}, raw = false } = {}) {
  const res = await _fetch(`${SB_URL}${path}`, {
    method,
    headers: sbHeaders({ ...(body !== undefined && !(body instanceof Uint8Array) ? { 'Content-Type': 'application/json' } : {}), ...headers }),
    body: body === undefined ? undefined : (body instanceof Uint8Array ? body : JSON.stringify(body)),
  });
  if (raw) return res;
  const txt = await res.text();
  let data = null;
  try { data = txt ? JSON.parse(txt) : null; } catch { data = txt; }
  if (!res.ok) {
    const msg = (data && (data.message || data.error || data.msg)) || `HTTP ${res.status}`;
    const err = new Error(`Supabase: ${msg}`);
    err.status = res.status;
    throw err;
  }
  return data;
}

const q = (v) => encodeURIComponent(v);

// Busca paginada (PostgREST devolve no máx. 1000 por vez).
async function sbTodos(pathBase) {
  const todos = [];
  const passo = 1000;
  for (let ini = 0; ; ini += passo) {
    const lote = await sb(pathBase, { headers: { Range: `${ini}-${ini + passo - 1}`, 'Range-Unit': 'items' } });
    todos.push(...lote);
    if (lote.length < passo) break;
    if (todos.length > 200000) break; // trava de segurança
  }
  return todos;
}

// ---------------- sessão ----------------
const b64u = (buf) => Buffer.from(buf).toString('base64url');
function assinar(payload) {
  const corpo = b64u(JSON.stringify(payload));
  const sig = crypto.createHmac('sha256', SESSION_SECRET).update(corpo).digest('base64url');
  return `${corpo}.${sig}`;
}
function verificar(token) {
  if (!token || !SESSION_SECRET) return null;
  const [corpo, sig] = String(token).split('.');
  if (!corpo || !sig) return null;
  const esperado = crypto.createHmac('sha256', SESSION_SECRET).update(corpo).digest('base64url');
  const a = Buffer.from(sig), b = Buffer.from(esperado);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  try {
    const p = JSON.parse(Buffer.from(corpo, 'base64url').toString());
    return p.exp > Date.now() ? p : null;
  } catch { return null; }
}
function lerCookie(req, nome) {
  const m = (req.headers.cookie || '').split(';').map((s) => s.trim()).find((s) => s.startsWith(`${nome}=`));
  return m ? decodeURIComponent(m.slice(nome.length + 1)) : null;
}
function gravarCookie(req, res, valor, maxAgeSeg) {
  const seguro = req.secure || req.headers['x-forwarded-proto'] === 'https';
  res.append('Set-Cookie', `${COOKIE}=${encodeURIComponent(valor)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAgeSeg}${seguro ? '; Secure' : ''}`);
}

// ---------------- login Microsoft ----------------
const env = (...nomes) => nomes.map((n) => process.env[n]).find(Boolean) || '';
let _msal = null;
function msal() {
  if (_msal) return _msal;
  const clientId = env('AZURE_CLIENT_ID', 'SHAREPOINT_CLIENT_ID');
  const clientSecret = env('AZURE_CLIENT_SECRET', 'SHAREPOINT_CLIENT_SECRET');
  const tenant = env('AZURE_TENANT_ID', 'SHAREPOINT_TENANT_ID');
  if (!clientId || !clientSecret || !tenant) throw new Error('Login Microsoft sem configuração (SHAREPOINT_CLIENT_ID/SECRET/TENANT_ID).');
  _msal = new ConfidentialClientApplication({ auth: { clientId, clientSecret, authority: `https://login.microsoftonline.com/${tenant}` } });
  return _msal;
}
const ESCOPOS = ['openid', 'profile', 'email'];
function enderecoRetorno(req) {
  if (process.env.RAST_REDIRECT_URI) return process.env.RAST_REDIRECT_URI;
  const proto = req.headers['x-forwarded-proto'] || req.protocol;
  return `${proto}://${req.get('host')}/api/rast/auth/callback`;
}
function gravarCookieLogin(req, res, valor, maxAgeSeg) {
  const seguro = req.secure || req.headers['x-forwarded-proto'] === 'https';
  res.append('Set-Cookie', `${COOKIE_LOGIN}=${encodeURIComponent(valor)}; Path=/api/rast; HttpOnly; SameSite=Lax; Max-Age=${maxAgeSeg}${seguro ? '; Secure' : ''}`);
}

// ---------------- usuários ----------------
async function buscarUsuario(email) {
  const r = await sb(`/rest/v1/rast_usuarios?email=eq.${q(email)}&select=*`);
  return r[0] || null;
}
const publico = (u) => ({ email: u.email, nome: u.nome, papel: u.papel });

// ---------------- validação dos registros importados ----------------
const RE_TS = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/;
const num = (v) => (v === null || v === undefined || v === '' || !Number.isFinite(Number(v)) ? null : Number(v));
const int = (v) => (num(v) === null ? null : Math.round(Number(v)));
const txt = (v, max = 500) => (v === null || v === undefined ? '' : String(v).slice(0, max));

function limparRegistro(tipo, r) {
  if (!r || typeof r !== 'object') return null;
  const veiculo = txt(r.veiculo, 60).trim();
  if (!veiculo || !RE_TS.test(r.inicio) || !RE_TS.test(r.fim)) return null;
  const base = { veiculo, motorista: txt(r.motorista, 120).trim(), inicio: r.inicio, fim: r.fim, origem: txt(r.origem), destino: txt(r.destino) };
  if (tipo === 'viagens') {
    return { ...base, duracao_seg: int(r.duracao_seg), km: num(r.km), vel_media: num(r.vel_media), vel_max: num(r.vel_max), coord_ini: txt(r.coord_ini, 60), coord_fim: txt(r.coord_fim, 60) };
  }
  return { ...base, movimento_seg: int(r.movimento_seg), motor_seg: int(r.motor_seg), ocioso_seg: int(r.ocioso_seg) ?? 0, odometro_ini: num(r.odometro_ini), odometro_fim: num(r.odometro_fim), deslocamento_km: num(r.deslocamento_km) };
}

const COLUNAS = {
  viagens: 'veiculo,motorista,inicio,fim,duracao_seg,km,vel_media,vel_max,origem,destino,coord_ini,coord_fim,importacao_id',
  ociosidade: 'veiculo,motorista,inicio,fim,movimento_seg,motor_seg,ocioso_seg,origem,destino,odometro_ini,odometro_fim,deslocamento_km,importacao_id',
};
const RE_DIA = /^\d{4}-\d{2}-\d{2}$/;
function diaSeguinte(d) {
  const [y, m, dd] = d.split('-').map(Number);
  const x = new Date(Date.UTC(y, m - 1, dd + 1));
  return x.toISOString().slice(0, 10);
}

// ---------------- router ----------------
export function criarRouter() {
  const r = express.Router();
  r.use(express.json({ limit: '40mb' }));

  // erros assíncronos -> JSON
  const h = (fn) => (req, res) => fn(req, res).catch((err) => {
    console.error('[rastreamento]', err?.message || err);
    res.status(err.status && err.status < 500 ? 400 : 500).json({ erro: 'Erro ao falar com o banco de dados. Tente de novo; se persistir, avise a TI.' });
  });

  r.use((req, res, next) => {
    if (!configurado()) return res.status(503).json({ erro: 'Histórico ainda não configurado no servidor (variáveis RAST_* no Render).' });
    next();
  });

  // sessão
  async function exigirLogin(req, res, next) {
    const s = verificar(lerCookie(req, COOKIE));
    if (!s) return res.status(401).json({ erro: 'Sessão expirada. Entre novamente.' });
    try {
      const u = await buscarUsuario(s.e);
      if (!u || !u.ativo) return res.status(401).json({ erro: 'Acesso desativado.' });
      req.usuario = u;
      next();
    } catch (err) {
      console.error('[rastreamento] sessão:', err?.message || err);
      res.status(500).json({ erro: 'Falha ao verificar a sessão.' });
    }
  }
  const exigirAdmin = (req, res, next) => (req.usuario?.papel === 'admin' ? next() : res.status(403).json({ erro: 'Apenas administradores.' }));

  // Login por e-mail e senha foi desligado: o acesso é só pela conta Microsoft.
  const SO_MICROSOFT = { erro: `O acesso é feito somente com a conta Microsoft corporativa (@${DOMINIO}).` };
  r.post('/login', (req, res) => res.status(410).json(SO_MICROSOFT));
  r.post('/senha', (req, res) => res.status(410).json(SO_MICROSOFT));

  // Ida para a Microsoft
  r.get('/microsoft', h(async (req, res) => {
    const state = crypto.randomBytes(16).toString('hex');
    gravarCookieLogin(req, res, assinar({ state, exp: Date.now() + 10 * 60 * 1000 }), 600);
    res.redirect(await msal().getAuthCodeUrl({ scopes: ESCOPOS, redirectUri: enderecoRetorno(req), state, prompt: 'select_account' }));
  }));

  // Volta da Microsoft
  r.get('/auth/callback', async (req, res) => {
    const volta = (erro) => res.redirect(erro ? `/rastreamento?erro=${erro}` : '/rastreamento');
    const pendente = verificar(lerCookie(req, COOKIE_LOGIN));
    gravarCookieLogin(req, res, '', 0);
    if (req.query.error) return volta('microsoft_negado');
    if (!pendente?.state || !req.query.code || req.query.state !== pendente.state) return volta('sessao_expirada');
    try {
      const r2 = await msal().acquireTokenByCode({ code: String(req.query.code), scopes: ESCOPOS, redirectUri: enderecoRetorno(req) });
      const c = r2?.idTokenClaims || {};
      const email = String(c.preferred_username || c.email || c.upn || '').trim().toLowerCase();
      if (!email.endsWith(`@${DOMINIO}`)) return volta('dominio');

      let u = await buscarUsuario(email);
      // 1º acesso do administrador principal (tabela ainda sem ele)
      if (!u && email === ADMIN_EMAIL) {
        [u] = await sb('/rest/v1/rast_usuarios', {
          method: 'POST', headers: { Prefer: 'return=representation' },
          body: { email, nome: c.name || 'TI', papel: 'admin', senha_hash: null, trocar_senha: false, ativo: true, criado_por: 'bootstrap' },
        });
      }
      if (!u) return volta('sem_acesso');
      if (!u.ativo) return volta('desativado');

      const mud = { ultimo_acesso: new Date().toISOString() };
      if (!u.nome && c.name) mud.nome = c.name;
      await sb(`/rest/v1/rast_usuarios?email=eq.${q(u.email)}`, { method: 'PATCH', body: mud });
      gravarCookie(req, res, assinar({ e: u.email, exp: Date.now() + SESSAO_HORAS * 3600 * 1000 }), SESSAO_HORAS * 3600);
      console.log(`[rastreamento] entrou: ${u.email}`);
      volta();
    } catch (err) {
      console.error('[rastreamento] login Microsoft:', err?.message || err);
      volta('microsoft_callback');
    }
  });

  r.post('/logout', (req, res) => { gravarCookie(req, res, '', 0); res.json({ ok: true }); });

  r.get('/eu', exigirLogin, (req, res) => res.json(publico(req.usuario)));

  // ---- importação ----
  r.post('/importar', exigirLogin, h(async (req, res) => {
    const { tipo, arquivoNome, arquivoBase64, periodoDe, periodoAte, registros } = req.body || {};
    if (!['viagens', 'ociosidade'].includes(tipo)) return res.status(400).json({ erro: 'Tipo de planilha inválido.' });
    if (!arquivoBase64 || !Array.isArray(registros) || !registros.length) return res.status(400).json({ erro: 'Planilha vazia.' });
    if (registros.length > 100000) return res.status(400).json({ erro: 'Planilha grande demais (máx. 100 mil linhas por vez).' });

    const bytes = new Uint8Array(Buffer.from(String(arquivoBase64), 'base64'));
    if (bytes.length > 20 * 1024 * 1024) return res.status(400).json({ erro: 'Arquivo maior que 20 MB.' });
    const hash = crypto.createHash('sha256').update(bytes).digest('hex');

    const limpos = registros.map((x) => limparRegistro(tipo, x)).filter(Boolean);
    if (!limpos.length) return res.status(400).json({ erro: 'Nenhuma linha válida na planilha.' });

    // mesmo arquivo já importado? (checa antes de subir a evidência)
    const ja = await sb(`/rest/v1/rast_importacoes?tipo=eq.${q(tipo)}&arquivo_hash=eq.${q(hash)}&select=id,arquivo_nome,importado_em,importado_por`);
    if (ja.length) return res.json({ jaImportado: true, ...ja[0] });

    // guarda a planilha original (evidência)
    const nomeSeguro = txt(arquivoNome, 120).replace(/[^\w.\-]+/g, '_') || 'planilha.xlsx';
    const caminho = `${tipo}/${new Date().toISOString().slice(0, 7)}/${hash.slice(0, 16)}_${nomeSeguro}`;
    await sb(`/storage/v1/object/${BUCKET}/${caminho.split('/').map(q).join('/')}`, {
      method: 'POST', body: bytes,
      headers: { 'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'x-upsert': 'true' },
    });

    const resultado = await sb('/rest/v1/rpc/rast_importar', {
      method: 'POST',
      body: {
        p_tipo: tipo,
        p_imp: {
          arquivo_nome: txt(arquivoNome, 200) || nomeSeguro, arquivo_hash: hash, arquivo_path: caminho,
          arquivo_bytes: bytes.length, importado_por: req.usuario.email,
          periodo_de: RE_TS.test(periodoDe) ? periodoDe : '', periodo_ate: RE_TS.test(periodoAte) ? periodoAte : '',
        },
        p_registros: limpos,
      },
    });
    if (resultado?.ja_importado) return res.json({ jaImportado: true, id: resultado.importacao_id, arquivo_nome: resultado.arquivo_nome, importado_em: resultado.importado_em, importado_por: resultado.importado_por });
    res.json({ jaImportado: false, id: resultado.importacao_id, registros: resultado.registros, novos: resultado.novos, duplicados: resultado.duplicados, ignoradas: registros.length - limpos.length });
  }));

  // ---- consulta por período ----
  r.get('/dados', exigirLogin, h(async (req, res) => {
    const tipo = String(req.query.tipo || '');
    const de = String(req.query.de || '');
    const ate = String(req.query.ate || '');
    if (!COLUNAS[tipo] || !RE_DIA.test(de) || !RE_DIA.test(ate) || de > ate) return res.status(400).json({ erro: 'Período inválido.' });
    const tabela = tipo === 'viagens' ? 'rast_viagens' : 'rast_ociosidade';
    const linhas = await sbTodos(`/rest/v1/${tabela}?select=${COLUNAS[tipo]}&inicio=gte.${q(`${de} 00:00:00`)}&inicio=lt.${q(`${diaSeguinte(ate)} 00:00:00`)}&order=inicio.asc,veiculo.asc`);
    res.json({ tipo, de, ate, linhas });
  }));

  // primeira e última data com dados (para sugerir o período na tela)
  r.get('/resumo', exigirLogin, h(async (req, res) => {
    const out = {};
    for (const [tipo, tabela] of [['viagens', 'rast_viagens'], ['ociosidade', 'rast_ociosidade']]) {
      const [min] = await sb(`/rest/v1/${tabela}?select=inicio&order=inicio.asc&limit=1`);
      const [max] = await sb(`/rest/v1/${tabela}?select=inicio&order=inicio.desc&limit=1`);
      out[tipo] = { primeira: min?.inicio || null, ultima: max?.inicio || null };
    }
    res.json(out);
  }));

  r.get('/precos', exigirLogin, h(async (req, res) => {
    const de = String(req.query.de || ''), ate = String(req.query.ate || '');
    if (!RE_DIA.test(de) || !RE_DIA.test(ate)) return res.status(400).json({ erro: 'Período inválido.' });
    res.json(await sb('/rest/v1/rpc/rast_precos', { method: 'POST', body: { p_de: `${de} 00:00:00`, p_ate: `${ate} 00:00:00` } }));
  }));

  r.get('/importacoes', exigirLogin, h(async (req, res) => {
    const tipo = String(req.query.tipo || '');
    const filtro = ['viagens', 'ociosidade'].includes(tipo) ? `&tipo=eq.${tipo}` : '';
    res.json(await sb(`/rest/v1/rast_importacoes?select=id,tipo,arquivo_nome,arquivo_bytes,periodo_de,periodo_ate,registros,novos,duplicados,importado_por,importado_em&order=importado_em.desc&limit=500${filtro}`));
  }));

  r.get('/evidencia/:id', exigirLogin, h(async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) return res.status(400).json({ erro: 'Importação inválida.' });
    const [imp] = await sb(`/rest/v1/rast_importacoes?id=eq.${id}&select=arquivo_nome,arquivo_path`);
    if (!imp?.arquivo_path) return res.status(404).json({ erro: 'Arquivo não encontrado.' });
    const arq = await sb(`/storage/v1/object/${BUCKET}/${imp.arquivo_path.split('/').map(q).join('/')}`, { raw: true });
    if (!arq.ok) return res.status(404).json({ erro: 'Arquivo não encontrado no armazenamento.' });
    const nome = (imp.arquivo_nome || 'planilha.xlsx').replace(/["\r\n]/g, '');
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${nome.replace(/[^\x20-\x7e]/g, '_')}"; filename*=UTF-8''${encodeURIComponent(nome)}`);
    res.send(Buffer.from(await arq.arrayBuffer()));
  }));

  // ---- parâmetros ----
  r.get('/config', exigirLogin, h(async (req, res) => {
    const linhas = await sb('/rest/v1/rast_config?select=chave,valor,atualizado_por,atualizado_em');
    res.json(Object.fromEntries(linhas.map((l) => [l.chave, l])));
  }));
  r.put('/config', exigirLogin, h(async (req, res) => {
    const permitidos = { litros_hora_ocioso: [0.1, 20], ociosidade_minutos: [1, 120] };
    const corpo = req.body || {};
    const linhas = [];
    for (const [chave, [min, max]] of Object.entries(permitidos)) {
      if (corpo[chave] === undefined) continue;
      const v = Number(String(corpo[chave]).replace(',', '.'));
      if (!Number.isFinite(v) || v < min || v > max) return res.status(400).json({ erro: `Valor inválido para ${chave}.` });
      linhas.push({ chave, valor: String(v), atualizado_por: req.usuario.email, atualizado_em: new Date().toISOString() });
    }
    if (corpo.feriados_extras !== undefined) {
      const lista = Array.isArray(corpo.feriados_extras) ? corpo.feriados_extras : null;
      if (!lista || lista.length > 200) return res.status(400).json({ erro: 'Lista de feriados inválida.' });
      const limpa = lista
        .filter((f) => f && RE_DIA.test(f.data))
        .map((f) => ({ data: f.data, nome: txt(f.nome, 80).trim() || 'Feriado' }));
      linhas.push({ chave: 'feriados_extras', valor: JSON.stringify(limpa), atualizado_por: req.usuario.email, atualizado_em: new Date().toISOString() });
    }
    if (linhas.length) await sb('/rest/v1/rast_config',{ method: 'POST', body: linhas, headers: { Prefer: 'resolution=merge-duplicates' } });
    res.json({ ok: true });
  }));

  // ---- usuários (admin) ----
  r.get('/usuarios', exigirLogin, exigirAdmin, h(async (req, res) => {
    res.json(await sb('/rest/v1/rast_usuarios?select=email,nome,papel,ativo,criado_em,criado_por,ultimo_acesso&order=nome.asc'));
  }));
  r.post('/usuarios', exigirLogin, exigirAdmin, h(async (req, res) => {
    const email = String(req.body?.email || '').trim().toLowerCase();
    const nome = txt(req.body?.nome, 120).trim();
    const papel = req.body?.papel === 'admin' ? 'admin' : 'usuario';
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return res.status(400).json({ erro: 'E-mail inválido.' });
    if (!email.endsWith(`@${DOMINIO}`)) return res.status(400).json({ erro: `Use o e-mail corporativo (@${DOMINIO}). O acesso é pela conta Microsoft.` });
    if (await buscarUsuario(email)) return res.status(400).json({ erro: 'Esse e-mail já tem acesso.' });
    await sb('/rest/v1/rast_usuarios', { method: 'POST', body: { email, nome, papel, senha_hash: null, trocar_senha: false, ativo: true, criado_por: req.usuario.email } });
    res.json({ ok: true });
  }));
  r.patch('/usuarios/:email', exigirLogin, exigirAdmin, h(async (req, res) => {
    const email = String(req.params.email || '').toLowerCase();
    const alvo = await buscarUsuario(email);
    if (!alvo) return res.status(404).json({ erro: 'Usuário não encontrado.' });
    const mud = {};
    if (typeof req.body?.ativo === 'boolean') {
      if (email === req.usuario.email && !req.body.ativo) return res.status(400).json({ erro: 'Você não pode desativar o próprio acesso.' });
      mud.ativo = req.body.ativo;
    }
    if (req.body?.papel && email !== req.usuario.email) mud.papel = req.body.papel === 'admin' ? 'admin' : 'usuario';
    if (!Object.keys(mud).length) return res.status(400).json({ erro: 'Nada para alterar.' });
    await sb(`/rest/v1/rast_usuarios?email=eq.${q(email)}`, { method: 'PATCH', body: mud });
    res.json({ ok: true });
  }));

  return r;
}
