// API do histórico de rastreamento (/rastreamento): login Microsoft, importação
// das planilhas do rastreador, consulta por período, evidências e usuários.
//
// Todo acesso ao Supabase (projeto Abast) é feito AQUI, com a chave de serviço
// guardada no Render. O navegador nunca recebe chave do Supabase — as tabelas
// rast_* ficam com RLS ligado e sem políticas, fechadas para anon/authenticated.
//
// Variáveis de ambiente:
//   RAST_SUPABASE_URL          (padrão: projeto Abast)
//   RAST_SUPABASE_SERVICE_KEY  chave service_role / sb_secret_… do projeto Abast  [obrigatória]
//   RAST_SESSION_SECRET        texto aleatório longo para assinar a sessão        [obrigatória]
//   RAST_REDIRECT_URI          URL de retorno do Azure (padrão: montado pelo host)
//   SHAREPOINT_CLIENT_ID / SHAREPOINT_CLIENT_SECRET / SHAREPOINT_TENANT_ID  (já usadas pelo painel)

import express from 'express';
import crypto from 'node:crypto';
import { ConfidentialClientApplication } from '@azure/msal-node';

const SB_URL = (process.env.RAST_SUPABASE_URL || 'https://horvznvaytzhwrmwjwxv.supabase.co').replace(/\/$/, '');
const SB_KEY = process.env.RAST_SUPABASE_SERVICE_KEY || '';
const SESSION_SECRET = process.env.RAST_SESSION_SECRET || '';
const BUCKET = 'rast-evidencias';
const COOKIE = 'rast_sess';
const COOKIE_LOGIN = 'rast_login'; // estado temporário da ida à Microsoft
const SESSAO_HORAS = 12;
const DOMINIO = '@rezendeenergia.com.br';

export const configurado = () => Boolean(SB_KEY && SESSION_SECRET);

// ---------------- login Microsoft ----------------
function env(...nomes) {
  for (const n of nomes) if (process.env[n]) return process.env[n];
  return '';
}
let _msal = null;
function msal() {
  if (_msal) return _msal;
  const clientId     = env('SHAREPOINT_CLIENT_ID');
  const clientSecret = env('SHAREPOINT_CLIENT_SECRET');
  const tenant       = env('SHAREPOINT_TENANT_ID');
  if (!clientId || !clientSecret || !tenant) throw new Error('Login Microsoft: defina SHAREPOINT_CLIENT_ID, SHAREPOINT_CLIENT_SECRET e SHAREPOINT_TENANT_ID.');
  _msal = new ConfidentialClientApplication({
    auth: { clientId, clientSecret, authority: `https://login.microsoftonline.com/${tenant}` },
  });
  return _msal;
}
const ESCOPOS_MS = ['openid', 'profile', 'email'];
function enderecoRetorno(req) {
  if (process.env.RAST_REDIRECT_URI) return process.env.RAST_REDIRECT_URI;
  return `${req.protocol}://${req.get('host')}/api/rast/auth/callback`;
}
async function urlDeLogin(opts) {
  return msal().getAuthCodeUrl({ scopes: ESCOPOS_MS, ...opts, prompt: 'select_account' });
}
async function trocarCodigo(opts) {
  const r = await msal().acquireTokenByCode({ scopes: ESCOPOS_MS, ...opts });
  const c = r?.idTokenClaims || {};
  const email = String(c.preferred_username || c.email || c.upn || '').trim().toLowerCase();
  return { email, nome: c.name || email };
}

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
function setCookie(req, res, nome, valor, maxAgeSeg) {
  const seguro = req.secure || req.headers['x-forwarded-proto'] === 'https';
  res.setHeader('Set-Cookie', `${nome}=${encodeURIComponent(valor)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAgeSeg}${seguro ? '; Secure' : ''}`);
}
const gravarSessao = (req, res, dados) => setCookie(req, res, COOKIE, assinar({ ...dados, exp: Date.now() + SESSAO_HORAS * 3600 * 1000 }), SESSAO_HORAS * 3600);
const gravarLogin  = (req, res, dados) => setCookie(req, res, COOKIE_LOGIN, assinar({ ...dados, exp: Date.now() + 10 * 60 * 1000 }), 600);
const apagarSessao = (req, res) => setCookie(req, res, COOKIE, '', 0);
const apagarLogin  = (req, res) => setCookie(req, res, COOKIE_LOGIN, '', 0);

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

// ---------------- middlewares compartilhados ----------------
// erros assíncronos -> JSON (usado em criarRouter e rotasCustos)
const asyncWrap = (fn) => (req, res) => fn(req, res).catch((err) => {
  console.error('[frota]', err?.message || err);
  res.status(err.status && err.status < 500 ? 400 : 500).json({ erro: 'Erro ao falar com o banco de dados. Tente de novo; se persistir, avise a TI.' });
});

async function autenticar(req, res, next) {
  const s = verificar(lerCookie(req, COOKIE));
  if (!s) return res.status(401).json({ erro: 'Sessão expirada. Entre novamente.' });
  try {
    let u = await buscarUsuario(s.e);
    if (!u) {
      // 1º acesso — cria o usuário automaticamente como operador
      [u] = await sb('/rest/v1/rast_usuarios', {
        method: 'POST',
        body: { email: s.e, nome: s.n || s.e, papel: 'operador', ativo: true, criado_por: 'microsoft' },
        headers: { Prefer: 'return=representation' },
      });
    }
    if (!u || !u.ativo) return res.status(401).json({ erro: 'Acesso desativado.' });
    req.usuario = u;
    next();
  } catch (err) {
    console.error('[frota] sessão:', err?.message || err);
    res.status(500).json({ erro: 'Falha ao verificar a sessão.' });
  }
}
const soAdmin = (req, res, next) => (req.usuario?.papel === 'admin' ? next() : res.status(403).json({ erro: 'Apenas administradores.' }));

// ---------------- router ----------------
export function criarRouter() {
  const r = express.Router();
  r.use(express.json({ limit: '40mb' }));

  // alias internos para manter compatibilidade com o código abaixo
  const h = asyncWrap;

  r.use((req, res, next) => {
    if (!configurado()) return res.status(503).json({ erro: 'Histórico ainda não configurado no servidor (variáveis RAST_* no Render).' });
    next();
  });

  const exigirLogin = autenticar;
  const exigirAdmin = soAdmin;

  // ---- login Microsoft ----
  r.get('/microsoft', (req, res) => {
    try {
      const state = crypto.randomBytes(16).toString('hex');
      const redirectUri = enderecoRetorno(req);
      gravarLogin(req, res, { state });
      urlDeLogin({ state, redirectUri }).then((url) => res.redirect(url)).catch((err) => {
        console.error('[frota] login Microsoft:', err?.message || err);
        res.redirect('/login?erro=microsoft');
      });
    } catch (err) {
      console.error('[frota] login Microsoft:', err?.message || err);
      res.redirect('/login?erro=microsoft');
    }
  });

  r.get('/auth/callback', async (req, res) => {
    const pendente = verificar(lerCookie(req, COOKIE_LOGIN));
    apagarLogin(req, res);

    if (req.query.error) return res.redirect('/login?erro=microsoft_negado');
    if (!pendente?.state) return res.redirect('/login?erro=sessao_expirada');
    if (!req.query.code || req.query.state !== pendente.state) return res.redirect('/login?erro=microsoft_callback');

    let ms;
    try {
      ms = await trocarCodigo({ code: String(req.query.code), redirectUri: enderecoRetorno(req) });
    } catch (err) {
      console.error('[frota] callback Microsoft:', err?.message || err);
      return res.redirect('/login?erro=microsoft_callback');
    }

    if (!ms.email.endsWith(DOMINIO)) return res.redirect('/login?erro=dominio');

    // garante que o usuário existe no banco (cria se for 1º acesso)
    try {
      let u = await buscarUsuario(ms.email);
      if (!u) {
        [u] = await sb('/rest/v1/rast_usuarios', {
          method: 'POST',
          body: { email: ms.email, nome: ms.nome, papel: 'operador', ativo: true, criado_por: 'microsoft' },
          headers: { Prefer: 'return=representation' },
        });
      }
      if (!u?.ativo) return res.redirect('/login?erro=desativado');
      await sb(`/rest/v1/rast_usuarios?email=eq.${q(ms.email)}`, { method: 'PATCH', body: { nome: ms.nome, ultimo_acesso: new Date().toISOString() } });
    } catch (err) {
      console.error('[frota] salvar usuário:', err?.message || err);
      return res.redirect('/login?erro=banco');
    }

    gravarSessao(req, res, { e: ms.email, n: ms.nome });
    console.log(`[frota] entrou: ${ms.email}`);
    res.redirect('/rastreamento');
  });

  r.post('/logout', (req, res) => {
    apagarSessao(req, res);
    const tenant = env('SHAREPOINT_TENANT_ID');
    const volta = encodeURIComponent(`${req.protocol}://${req.get('host')}/rastreamento`);
    if (tenant) return res.json({ redirect: `https://login.microsoftonline.com/${tenant}/oauth2/v2.0/logout?post_logout_redirect_uri=${volta}` });
    res.json({ ok: true });
  });

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
    const nome  = txt(req.body?.nome, 120).trim();
    const papel = req.body?.papel === 'admin' ? 'admin' : 'operador';
    if (!email.endsWith(DOMINIO)) return res.status(400).json({ erro: `Apenas e-mails ${DOMINIO}.` });
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return res.status(400).json({ erro: 'E-mail inválido.' });
    if (await buscarUsuario(email)) return res.status(400).json({ erro: 'Esse e-mail já tem acesso.' });
    await sb('/rest/v1/rast_usuarios', { method: 'POST', body: { email, nome, papel, ativo: true, criado_por: req.usuario.email } });
    res.json({ ok: true });
  }));
  r.patch('/usuarios/:email', exigirLogin, exigirAdmin, h(async (req, res) => {
    const email = String(req.params.email || '').toLowerCase();
    const alvo  = await buscarUsuario(email);
    if (!alvo) return res.status(404).json({ erro: 'Usuário não encontrado.' });
    const mud = {};
    if (typeof req.body?.ativo === 'boolean') {
      if (email === req.usuario.email && !req.body.ativo) return res.status(400).json({ erro: 'Você não pode desativar o próprio acesso.' });
      mud.ativo = req.body.ativo;
    }
    if (req.body?.papel && email !== req.usuario.email) mud.papel = req.body.papel === 'admin' ? 'admin' : 'operador';
    if (!Object.keys(mud).length) return res.status(400).json({ erro: 'Nada para alterar.' });
    await sb(`/rest/v1/rast_usuarios?email=eq.${q(email)}`, { method: 'PATCH', body: mud });
    res.json({ ok: true });
  }));

  return r;
}

// ==================== CONTROLE DE CUSTOS ====================
// Rotas sob /api/cust/* — mesma autenticação do rastreamento (cookie rast_sess).

export function rotasCustos(app) {
  const r = express.Router();
  r.use(express.json({ limit: '5mb' }));

  // GET /api/cust/veiculos — lista todos os veículos
  r.get('/veiculos', autenticar, asyncWrap(async (req, res) => {
    const data = await sb('/rest/v1/cust_veiculos?select=*&order=placa.asc');
    res.json(data || []);
  }));

  // POST /api/cust/veiculos — adiciona veículo
  r.post('/veiculos', autenticar, asyncWrap(async (req, res) => {
    const { placa, modelo } = req.body || {};
    if (!placa) return res.status(400).json({ erro: 'Placa obrigatória.' });
    const data = await sb('/rest/v1/cust_veiculos', {
      method: 'POST',
      body: { placa: String(placa).trim().toUpperCase(), modelo: String(modelo || '').trim() },
      headers: { Prefer: 'return=representation' },
    });
    res.json((data || [])[0] || {});
  }));

  // PATCH /api/cust/veiculos/:placa — atualiza veículo
  r.patch('/veiculos/:placa', autenticar, asyncWrap(async (req, res) => {
    const placa = req.params.placa.toUpperCase();
    const campos = {};
    if (req.body?.modelo !== undefined) campos.modelo = String(req.body.modelo).trim();
    if (req.body?.ativo !== undefined)  campos.ativo  = Boolean(req.body.ativo);
    if (!Object.keys(campos).length) return res.status(400).json({ erro: 'Nada para alterar.' });
    await sb(`/rest/v1/cust_veiculos?placa=eq.${q(placa)}`, { method: 'PATCH', body: campos });
    res.json({ ok: true });
  }));

  // GET /api/cust/lancamentos?placa=&de=&ate=&page=&pageSize= — consulta
  r.get('/lancamentos', autenticar, asyncWrap(async (req, res) => {
    const { placa, de, ate } = req.query;
    const page     = Math.max(1, parseInt(req.query.page || '1'));
    const pageSize = Math.min(500, Math.max(1, parseInt(req.query.pageSize || '100')));
    const offset   = (page - 1) * pageSize;

    let filtro = '';
    if (placa) filtro += `&placa=eq.${q(placa.toUpperCase())}`;
    if (de)    filtro += `&data=gte.${q(de)}`;
    if (ate)   filtro += `&data=lte.${q(ate)}`;

    const data = await sb(
      `/rest/v1/cust_lancamentos?select=*&order=data.desc,id.desc&limit=${pageSize}&offset=${offset}${filtro}`
    );
    res.json({ lancamentos: data || [] });
  }));

  // GET /api/cust/resumo?de=&ate= — totais por placa e indicadores mensais
  r.get('/resumo', autenticar, asyncWrap(async (req, res) => {
    const { de, ate } = req.query;
    let filtro = '';
    if (de)  filtro += `&data=gte.${q(de)}`;
    if (ate) filtro += `&data=lte.${q(ate)}`;

    const [lanc, veic] = await Promise.all([
      sb(`/rest/v1/cust_lancamentos?select=placa,data,tipo,valor_total,tipo_manutencao${filtro}&order=data.asc`),
      sb('/rest/v1/cust_veiculos?select=placa,modelo'),
    ]);

    const modeloPor = {};
    for (const v of (veic || [])) modeloPor[v.placa] = v.modelo;

    const porVeiculo = new Map();
    const porMes     = new Map();

    for (const l of (lanc || [])) {
      const vt  = Number(l.valor_total) || 0;
      const mes = String(l.data).slice(0, 7);

      if (!porVeiculo.has(l.placa)) porVeiculo.set(l.placa, { placa: l.placa, modelo: modeloPor[l.placa] || '', total: 0, peca: 0, servico: 0, preventiva: 0, corretiva: 0 });
      const pv = porVeiculo.get(l.placa);
      pv.total += vt;
      if (l.tipo === 'Peça')                    pv.peca       += vt;
      if (l.tipo === 'Serviço')                  pv.servico    += vt;
      if (l.tipo_manutencao === 'PREVENTIVA')    pv.preventiva += vt;
      if (l.tipo_manutencao === 'CORRETIVA')     pv.corretiva  += vt;

      if (!porMes.has(mes)) porMes.set(mes, { mes, total: 0, peca: 0, servico: 0, preventiva: 0, corretiva: 0 });
      const pm = porMes.get(mes);
      pm.total += vt;
      if (l.tipo === 'Peça')                     pm.peca       += vt;
      if (l.tipo === 'Serviço')                   pm.servico    += vt;
      if (l.tipo_manutencao === 'PREVENTIVA')     pm.preventiva += vt;
      if (l.tipo_manutencao === 'CORRETIVA')      pm.corretiva  += vt;
    }

    res.json({
      porVeiculo: [...porVeiculo.values()].sort((a, b) => b.total - a.total),
      porMes:     [...porMes.values()].sort((a, b) => a.mes.localeCompare(b.mes)),
    });
  }));

  // POST /api/cust/lancamentos — insere lançamento
  r.post('/lancamentos', autenticar, asyncWrap(async (req, res) => {
    const { placa, data, tipo, descricao, qtd, valor_unitario, oficina, tipo_manutencao, status, observacao, inserida_gpm } = req.body || {};
    if (!placa || !data || !tipo || !descricao)
      return res.status(400).json({ erro: 'Campos obrigatórios: placa, data, tipo, descricao.' });
    const payload = {
      placa:          String(placa).toUpperCase(),
      data:           String(data),
      tipo:           String(tipo),
      descricao:      String(descricao).trim(),
      qtd:            Number(qtd) || 1,
      valor_unitario: Number(valor_unitario) || 0,
      oficina:        String(oficina || '').trim(),
      tipo_manutencao: String(tipo_manutencao || '').trim().toUpperCase(),
      status:         String(status || '').trim(),
      observacao:     String(observacao || '').trim(),
      inserida_gpm:   Boolean(inserida_gpm),
      criado_por:     req.usuario?.email || '',
    };
    const ret = await sb('/rest/v1/cust_lancamentos', {
      method: 'POST', body: payload, headers: { Prefer: 'return=representation' },
    });
    res.json((ret || [])[0] || {});
  }));

  // PATCH /api/cust/lancamentos/:id — edita lançamento
  r.patch('/lancamentos/:id', autenticar, asyncWrap(async (req, res) => {
    const id = parseInt(req.params.id);
    if (!id) return res.status(400).json({ erro: 'ID inválido.' });
    const campos = {};
    const allow = ['data','tipo','descricao','qtd','valor_unitario','oficina','tipo_manutencao','status','observacao','inserida_gpm'];
    for (const k of allow) if (req.body?.[k] !== undefined) campos[k] = req.body[k];
    if (!Object.keys(campos).length) return res.status(400).json({ erro: 'Nada para alterar.' });
    await sb(`/rest/v1/cust_lancamentos?id=eq.${id}`, { method: 'PATCH', body: campos });
    res.json({ ok: true });
  }));

  // DELETE /api/cust/lancamentos/:id — remove lançamento
  r.delete('/lancamentos/:id', autenticar, asyncWrap(async (req, res) => {
    const id = parseInt(req.params.id);
    if (!id) return res.status(400).json({ erro: 'ID inválido.' });
    await sb(`/rest/v1/cust_lancamentos?id=eq.${id}`, { method: 'DELETE' });
    res.json({ ok: true });
  }));

  app.use('/api/cust', r);
}
