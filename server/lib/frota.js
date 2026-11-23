// Router da página /frota: login Microsoft + API de dados de frota.
// Reutiliza o mesmo app Azure (SHAREPOINT_CLIENT_*) dos outros sistemas.
//
// Variáveis de ambiente:
//   SHAREPOINT_CLIENT_ID / SHAREPOINT_CLIENT_SECRET / SHAREPOINT_TENANT_ID
//   FROTA_SESSION_SECRET   — assina o cookie de sessão   [obrigatória]
//   FROTA_REDIRECT_URI     — URL de callback (padrão: montado pelo host)
//   VEICULOS_SHARE_URL     — link de compartilhamento da planilha de veículos
//   RAST_SUPABASE_URL / RAST_SUPABASE_SERVICE_KEY — banco Supabase Abast

import express from 'express';
import crypto from 'node:crypto';
import { ConfidentialClientApplication } from '@azure/msal-node';
import { fetchFrota } from './frotaService.js';
import { fetchAbastecimento } from './abastecimentoService.js';

// ---------------- Supabase (banco Abast) ----------------
const SB_URL = (process.env.RAST_SUPABASE_URL || 'https://horvznvaytzhwrmwjwxv.supabase.co').replace(/\/$/, '');
const SB_KEY = process.env.RAST_SUPABASE_SERVICE_KEY || '';

async function sbFetch(path, opts = {}) {
  if (!SB_KEY) throw new Error('RAST_SUPABASE_SERVICE_KEY não configurada.');
  const res = await fetch(`${SB_URL}/rest/v1${path}`, {
    ...opts,
    headers: {
      'apikey': SB_KEY,
      'Authorization': `Bearer ${SB_KEY}`,
      'Content-Type': 'application/json',
      'Prefer': 'return=representation',
      ...(opts.headers || {}),
    },
  });
  if (!res.ok) {
    const txt = await res.text().catch(() => '');
    throw new Error(`Supabase ${path}: ${res.status} — ${txt.slice(0, 200)}`);
  }
  if (res.status === 204) return [];
  return res.json();
}

// Gera chave de deduplicação para um registro de manutenção
function manutChave(r) {
  // OSM é o identificador principal; quando não existe usa placa+data+item
  if (r.osm) return `osm:${r.osm.trim()}`;
  return `pfdi:${(r.placa||'').trim()}|${(r.data||'').trim()}|${(r.item||'').trim()}`;
}

const SESSION_SECRET = process.env.FROTA_SESSION_SECRET || process.env.RAST_SESSION_SECRET || '';
const COOKIE        = 'frota_sess';
const COOKIE_LOGIN  = 'frota_login';
const SESSAO_HORAS  = 12;
const DOMINIO       = '@rezendeenergia.com.br';

// ---------------- MSAL ----------------
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
  if (!clientId || !clientSecret || !tenant)
    throw new Error('Frota: defina SHAREPOINT_CLIENT_ID, SHAREPOINT_CLIENT_SECRET e SHAREPOINT_TENANT_ID.');
  _msal = new ConfidentialClientApplication({
    auth: { clientId, clientSecret, authority: `https://login.microsoftonline.com/${tenant}` },
  });
  return _msal;
}
const ESCOPOS_MS = ['openid', 'profile', 'email'];

function enderecoRetorno(req) {
  if (process.env.FROTA_REDIRECT_URI) return process.env.FROTA_REDIRECT_URI;
  return `${req.protocol}://${req.get('host')}/api/frota/auth/callback`;
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

// ---------------- Sessão (cookie HMAC-signed) ----------------
function assinar(obj) {
  const payload = Buffer.from(JSON.stringify(obj)).toString('base64url');
  const sig = crypto.createHmac('sha256', SESSION_SECRET || 'dev').update(payload).digest('base64url');
  return `${payload}.${sig}`;
}
function verificar(token) {
  if (!token) return null;
  const [payload, sig] = String(token).split('.');
  if (!payload || !sig) return null;
  const esperado = crypto.createHmac('sha256', SESSION_SECRET || 'dev').update(payload).digest('base64url');
  if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(esperado))) return null;
  try {
    const obj = JSON.parse(Buffer.from(payload, 'base64url').toString());
    if (obj.exp && Date.now() > obj.exp) return null;
    return obj;
  } catch { return null; }
}

function lerCookie(req, nome) {
  const h = req.headers.cookie || '';
  for (const p of h.split(';')) {
    const [k, ...v] = p.trim().split('=');
    if (k === nome) return decodeURIComponent(v.join('='));
  }
  return null;
}
function setCookie(req, res, nome, valor, maxAgeSeg) {
  const seguro = req.secure || req.headers['x-forwarded-proto'] === 'https';
  res.setHeader('Set-Cookie',
    `${nome}=${encodeURIComponent(valor)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAgeSeg}${seguro ? '; Secure' : ''}`
  );
}
const gravarSessao = (req, res, dados) =>
  setCookie(req, res, COOKIE, assinar({ ...dados, exp: Date.now() + SESSAO_HORAS * 3600 * 1000 }), SESSAO_HORAS * 3600);
const gravarLogin  = (req, res, dados) =>
  setCookie(req, res, COOKIE_LOGIN, assinar({ ...dados, exp: Date.now() + 10 * 60 * 1000 }), 600);
const apagarSessao = (req, res) => setCookie(req, res, COOKIE, '', 0);
const apagarLogin  = (req, res) => setCookie(req, res, COOKIE_LOGIN, '', 0);

// ---------------- Middleware de autenticação ----------------
function autenticar(req, res, next) {
  const s = verificar(lerCookie(req, COOKIE));
  if (!s) return res.status(401).json({ erro: 'Sessão expirada. Entre novamente.' });
  req.usuario = { email: s.e, nome: s.n };
  next();
}

// ---------------- Cache dos dados de frota ----------------
const CACHE_TTL_MS = 30 * 60 * 1000;
let _cache = null;
let _cacheAt = 0;
let _inflight = null;

async function getDadosFrota(periodo, force = false) {
  const agora = Date.now();
  if (!force && _cache && agora - _cacheAt < CACHE_TTL_MS) return _cache;
  if (_inflight) return _inflight;
  _inflight = fetchFrota(periodo).then((d) => {
    _cache = d; _cacheAt = Date.now(); _inflight = null; return d;
  }).catch((err) => {
    _inflight = null; throw err;
  });
  return _inflight;
}

// ---------------- Router ----------------
export function criarRouterFrota() {
  const r = express.Router();
  r.use(express.json());

  // Verificar sessão atual
  r.get('/eu', (req, res) => {
    const s = verificar(lerCookie(req, COOKIE));
    if (!s) return res.status(401).json({ erro: 'Sem sessão.' });
    res.json({ email: s.e, nome: s.n });
  });

  // Iniciar login Microsoft
  r.get('/microsoft', (req, res) => {
    try {
      const state = crypto.randomBytes(16).toString('hex');
      const redirectUri = enderecoRetorno(req);
      gravarLogin(req, res, { state });
      urlDeLogin({ state, redirectUri })
        .then((url) => res.redirect(url))
        .catch((err) => {
          console.error('[frota] login Microsoft:', err?.message || err);
          res.redirect('/frota/login?erro=microsoft');
        });
    } catch (err) {
      console.error('[frota] login Microsoft:', err?.message || err);
      res.redirect('/frota/login?erro=microsoft');
    }
  });

  // Callback do Azure
  r.get('/auth/callback', async (req, res) => {
    const pendente = verificar(lerCookie(req, COOKIE_LOGIN));
    apagarLogin(req, res);

    if (req.query.error)                                       return res.redirect('/frota/login?erro=microsoft_negado');
    if (!pendente?.state)                                      return res.redirect('/frota/login?erro=sessao_expirada');
    if (!req.query.code || req.query.state !== pendente.state) return res.redirect('/frota/login?erro=microsoft_callback');

    let ms;
    try {
      ms = await trocarCodigo({ code: String(req.query.code), redirectUri: enderecoRetorno(req) });
    } catch (err) {
      console.error('[frota] callback Microsoft:', err?.message || err);
      return res.redirect('/frota/login?erro=microsoft_callback');
    }

    if (!ms.email.endsWith(DOMINIO)) return res.redirect('/frota/login?erro=dominio');

    gravarSessao(req, res, { e: ms.email, n: ms.nome });
    console.log(`[frota] entrou: ${ms.email}`);
    res.redirect('/frota');
  });

  // Logout
  r.post('/logout', (req, res) => {
    apagarSessao(req, res);
    const tenant = env('SHAREPOINT_TENANT_ID');
    const host = `${req.protocol}://${req.get('host')}`;
    const redirect = tenant
      ? `https://login.microsoftonline.com/${tenant}/oauth2/v2.0/logout?post_logout_redirect_uri=${encodeURIComponent(host + '/frota/login')}`
      : '/frota/login';
    res.json({ redirect });
  });

  // Dados consolidados da frota (indicadores + locação + abastecimento)
  r.get('/dados', autenticar, async (req, res) => {
    try {
      const periodo = ['hoje', '7dias', '30dias', 'mes'].includes(req.query.periodo)
        ? req.query.periodo : '30dias';
      const force = req.query.force === '1';
      const dados = await getDadosFrota(periodo, force);
      res.json(dados);
    } catch (err) {
      console.error('[frota] dados:', err?.message || err);
      res.status(502).json({ erro: 'Falha ao carregar dados da frota.' });
    }
  });

  // Abastecimento isolado (para trocar período sem recarregar tudo)
  r.get('/abastecimento', autenticar, async (req, res) => {
    try {
      const periodo = ['hoje', '7dias', '30dias', 'mes'].includes(req.query.periodo)
        ? req.query.periodo : '30dias';
      const dados = await fetchAbastecimento(periodo);
      res.json(dados);
    } catch (err) {
      console.error('[frota] abastecimento:', err?.message || err);
      res.status(502).json({ erro: 'Falha ao carregar dados de abastecimento.' });
    }
  });

  // ------------------------------------------------------------------ //
  // Manutenção — histórico persistente no Supabase
  // ------------------------------------------------------------------ //

  // GET /api/frota/manut — carrega todos os registros salvos
  r.get('/manut', autenticar, async (req, res) => {
    try {
      const rows = await sbFetch('/frota_manut_registros?select=osm,placa,modelo,data,tipo,cat,item,vt,status,obs&order=data.desc&limit=10000');
      res.json({ registros: rows });
    } catch (err) {
      console.error('[frota/manut] carregar:', err?.message || err);
      res.status(502).json({ erro: 'Falha ao carregar dados de manutenção.' });
    }
  });

  // POST /api/frota/manut — salva lote de registros (ignora duplicados pela chave)
  r.post('/manut', autenticar, express.json({ limit: '5mb' }), async (req, res) => {
    try {
      const { registros } = req.body || {};
      if (!Array.isArray(registros) || registros.length === 0) {
        return res.status(400).json({ erro: 'Campo "registros" ausente ou vazio.' });
      }

      // Monta os objetos com a chave de deduplicação
      const payload = registros.map((r) => ({
        chave:   manutChave(r),
        osm:     r.osm     || null,
        placa:   r.placa   || null,
        modelo:  r.modelo  || null,
        data:    r.data    || null,
        tipo:    r.tipo    || null,
        cat:     r.cat     || null,
        item:    r.item    || null,
        vt:      Number(r.vt) || 0,
        status:  r.status  || null,
        obs:     r.obs     || null,
      }));

      // Upsert: ignora conflito na chave única (não sobrescreve o que já existe)
      await sbFetch('/frota_manut_registros?on_conflict=chave', {
        method: 'POST',
        headers: { 'Prefer': 'resolution=ignore-duplicates,return=minimal' },
        body: JSON.stringify(payload),
      });

      // Conta total de registros após o upsert
      const countRes = await fetch(`${SB_URL}/rest/v1/frota_manut_registros?select=id`, {
        headers: {
          'apikey': SB_KEY,
          'Authorization': `Bearer ${SB_KEY}`,
          'Prefer': 'count=exact',
          'Range': '0-0',
        },
      });
      const totalStr = countRes.headers.get('content-range') || '*/0';
      const total = Number(totalStr.split('/')[1]) || 0;
      res.json({ total, mensagem: 'Registros salvos com sucesso.' });
    } catch (err) {
      console.error('[frota/manut] salvar:', err?.message || err);
      res.status(502).json({ erro: 'Falha ao salvar dados de manutenção.' });
    }
  });

  // DELETE /api/frota/manut — apaga todos os registros (limpar histórico)
  r.delete('/manut', autenticar, async (req, res) => {
    try {
      await sbFetch('/frota_manut_registros?id=gte.0', { method: 'DELETE' });
      res.json({ mensagem: 'Histórico de manutenção apagado.' });
    } catch (err) {
      console.error('[frota/manut] apagar:', err?.message || err);
      res.status(502).json({ erro: 'Falha ao apagar histórico.' });
    }
  });

  return r;
}
