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
import { lerBorderoPdf, compararMedicao, validarEntrada, gerarXlsx, PdfSemTextoError } from './medicao.js';

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

// O Supabase devolve no máximo 1000 linhas por consulta, mesmo com limit=10000.
// Esta função busca em páginas de 1000 até acabar, para não cortar os dados
// (foi o que fez a tela mostrar só até julho). A consulta precisa ter `order`
// com desempate (ex.: date.asc,id.asc) para as páginas não repetirem linhas.
async function sbFetchTodos(path, opts = {}) {
  const TAM = 1000;
  const todas = [];
  const sep = path.includes('?') ? '&' : '?';
  for (let offset = 0; offset < 200000; offset += TAM) {
    const pagina = await sbFetch(`${path}${sep}limit=${TAM}&offset=${offset}`, opts);
    todas.push(...pagina);
    if (pagina.length < TAM) break;
  }
  return todas;
}

// Gera chave de deduplicação para um registro de manutenção
function manutChave(r) {
  // OSM + item: uma OSM pode ter múltiplas linhas (peças/serviços diferentes)
  if (r.osm) return `osm:${r.osm.trim()}|item:${(r.item||'').trim()}`;
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
      const rows = await sbFetchTodos('/frota_manut_registros?select=osm,placa,modelo,data,tipo,cat,item,fornecedor,vu,qtd,vt,status,obs&order=data.desc,id.asc');
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
        fornecedor: r.fornecedor || null,
        vu:      Number(r.vu)  || 0,
        qtd:     Number(r.qtd) || 0,
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

  // ------------------------------------------------------------------ //
  // Abastecimento detalhado — indicadores com base nos dados do Supabase Abast
  // Cache em memória: cada chave de filtro fica cacheada 5 min.
  // ------------------------------------------------------------------ //
  const ABAST_CACHE     = new Map(); // chave → { ts, dados }
  const ABAST_CACHE_TTL = 5 * 60 * 1000; // 5 min

  r.get('/abastecimento-detalhado', autenticar, async (req, res) => {
    if (!SB_KEY) return res.status(503).json({ erro: 'Banco de abastecimento não configurado.' });

    // Filtros adicionais
    const filtroPlaca = (req.query.placa || '').trim().toUpperCase() || null;
    const filtroPosto = (req.query.posto || '').trim() || null;
    const filtroMes   = (req.query.mes   || '').trim() || null; // "YYYY-MM"
    // Data livre (padrão novo): "YYYY-MM-DD". Se vier, manda mais que período/mês.
    const filtroDataInicio = (req.query.dataInicio || '').trim() || null;
    const filtroDataFim    = (req.query.dataFim    || '').trim() || null;

    // Chave de cache baseada nos parâmetros de filtro (não no usuário: dados são os mesmos)
    const cacheKey = `${req.query.periodo||'30dias'}|${filtroPlaca||''}|${filtroPosto||''}|${filtroMes||''}|${filtroDataInicio||''}|${filtroDataFim||''}`;
    const cached = ABAST_CACHE.get(cacheKey);
    if (cached && (Date.now() - cached.ts) < ABAST_CACHE_TTL) {
      res.set('X-Cache', 'HIT');
      return res.json(cached.dados);
    }

    // Período: hoje / 7dias / 30dias / mes — mantido só como padrão de fallback
    // (a tela não mostra mais esses botões; ela manda dataInicio/dataFim ou mes).
    const periodo = ['hoje', '7dias', '30dias', 'mes'].includes(req.query.periodo)
      ? req.query.periodo : '30dias';

    // Fuso de Santarém-PA (UTC−3, sem horário de verão). O servidor do Render roda
    // em UTC, então "dia" e "mês" precisam ser calculados nesse fuso — senão um
    // abastecimento feito depois das 21h cai no dia/mês seguinte.
    const OFFSET_MS = 3 * 3600 * 1000;
    // Meia-noite (horário de Santarém) do dia/mês pedido, em ms UTC.
    const meiaNoiteLocal = (ano, mesIdx, dia) => Date.UTC(ano, mesIdx, dia, 3, 0, 0, 0);
    const agora = new Date();
    const agoraLocal = new Date(agora.getTime() - OFFSET_MS); // getUTC* = horário de Santarém
    let dataInicioMs;
    let dtFimCustomMs = null;
    if (filtroMes) {
      // Filtro de mês específico: ignora data livre/período e usa o mês inteiro
      const [ano, mes] = filtroMes.split('-').map(Number);
      dataInicioMs = meiaNoiteLocal(ano, mes - 1, 1);
    } else if (filtroDataInicio) {
      // Intervalo de data livre escolhido na tela
      const [ano, mes, dia] = filtroDataInicio.split('-').map(Number);
      dataInicioMs = meiaNoiteLocal(ano, mes - 1, dia);
      if (filtroDataFim) {
        const [anoF, mesF, diaF] = filtroDataFim.split('-').map(Number);
        dtFimCustomMs = meiaNoiteLocal(anoF, mesF - 1, diaF + 1); // até o fim do dia final
      }
    } else if (periodo === 'hoje') {
      dataInicioMs = meiaNoiteLocal(agoraLocal.getUTCFullYear(), agoraLocal.getUTCMonth(), agoraLocal.getUTCDate());
    } else if (periodo === '7dias') {
      dataInicioMs = agora.getTime() - 7 * 86400000;
    } else if (periodo === '30dias') {
      dataInicioMs = agora.getTime() - 30 * 86400000;
    } else { // mes (preset antigo, sem mês escolhido: mês corrente)
      dataInicioMs = meiaNoiteLocal(agoraLocal.getUTCFullYear(), agoraLocal.getUTCMonth(), 1);
    }
    // Mês (YYYY-MM) de um carimbo ISO, no horário de Santarém
    const mesLocalDe = (iso) => {
      const t = Date.parse(iso);
      return Number.isNaN(t) ? '' : new Date(t - OFFSET_MS).toISOString().substring(0, 7);
    };

    // Para histórico mensal buscamos sempre 13 meses atrás (mês atual + 12 anteriores)
    const dtHistoricoInicio = new Date(
      meiaNoiteLocal(agoraLocal.getUTCFullYear(), agoraLocal.getUTCMonth() - 12, 1)
    ).toISOString();

    try {
      // Converte litros de "50.0 L" para número
      function parseLitros(v) {
        if (!v) return 0;
        return parseFloat(String(v).replace(/\s*L$/i,'').replace(',','.')) || 0;
      }
      function parseKm(v) { return Number(v) || 0; }
      function parsePreco(v) {
        if (!v) return 0;
        return parseFloat(String(v).replace(/[R$\s]/g,'').replace(',','.')) || 0;
      }

      // Busca todos os abastecimentos dos últimos 13 meses (para histórico + período filtrado)
      // Uma única chamada evita requests duplicados.
      // Traz TODOS os concluídos (inclusive bombona, carote e "sem placa": também são
      // combustível comprado e pago ao posto) e os assinados que têm placa.
      let url = `/requests?select=id,status,plate,vehicle,gas_station,fuel_type,liters,km,km_before,price_per_liter,real_value,date` +
        `&status=in.(completed,signed)&date=gte.${encodeURIComponent(dtHistoricoInicio)}` +
        `&order=date.asc,id.asc`;
      if (filtroPlaca) url += `&plate=eq.${encodeURIComponent(filtroPlaca)}`;
      if (filtroPosto) url += `&gas_station=eq.${encodeURIComponent(filtroPosto)}`;

      const linhas = await sbFetchTodos(url, { headers: { 'Prefer': 'count=none' } });
      // "Assinado" = motorista assinou, mas o posto ainda não deu baixa: não tem valor
      // real e não entra no financeiro. Só entra se tiver placa (tabela por veículo).
      const todosRows = linhas.filter((r) => r.status === 'completed' || (r.plate || '').trim() !== '');

      // Veículos controlados por horímetro (horas), não por hodômetro (km):
      // geradores, tratores, retroescavadeiras e embarcações. Pra esses, km/km_before
      // não representa distância percorrida — o cálculo de km rodados/km por litro
      // não se aplica e fica de fora (mostra "—" na tela).
      const TIPOS_HORIMETRO = new Set(['GERADOR', 'TRATOR', 'RETROESCAVADEIRA', 'EMBARCAÇÃO']);
      const placasHorimetro = new Set();
      try {
        const veiculos = await sbFetch('/vehicles?select=plate,type');
        for (const v of veiculos) {
          if (TIPOS_HORIMETRO.has((v.type || '').trim().toUpperCase())) {
            placasHorimetro.add((v.plate || '').trim().toUpperCase());
          }
        }
      } catch (e) {
        console.error('[frota/abast-det] falha ao buscar tipos de veículo:', e?.message || e);
        // segue sem a lista — pior caso, essas placas voltam a aparecer com km (como antes)
      }

      // Guarda contra erro de digitação (ex.: horímetro ou km errado digitado no
      // campo de km): nenhum veículo desta frota roda mais que isso entre dois
      // abastecimentos, então acima disso o dado é descartado do cálculo.
      const MAX_KM_ENTRE_ABASTECIMENTOS = 8000;

      // ---- Separa: linhas do período filtrado vs. todos os 13 meses ----
      const dtInicioMs = dataInicioMs;
      let dtFimMs = Infinity;
      if (filtroMes) {
        const [ano, mes] = filtroMes.split('-').map(Number);
        dtFimMs = meiaNoiteLocal(ano, mes, 1); // primeiro dia do mês seguinte
      } else if (dtFimCustomMs != null) {
        dtFimMs = dtFimCustomMs;
      }

      const rows = todosRows.filter((r) => {
        const t = new Date(r.date).getTime();
        return t >= dtInicioMs && t < dtFimMs;
      });

      // ---- Agrega período filtrado ----
      let totalLitros = 0;
      let totalKmRodados = 0;
      let totalValor = 0;
      let totalConcluidos = 0;
      let litrosVeiculos = 0; // litros das linhas com placa (base do km/L, como antes)
      const aguardandoBaixa = { contagem: 0, litros: 0 };

      const porPlaca  = {};
      const porPosto  = {};
      const porCombustivel = {};

      for (const row of rows) {
        const litros = parseLitros(row.liters);
        const km     = parseKm(row.km);
        const kmBef  = parseKm(row.km_before);
        const valor  = parsePreco(row.real_value) || (litros * parseFloat(row.price_per_liter || 0));
        const placa  = (row.plate || '').trim().toUpperCase();
        const posto  = (row.gas_station || 'Não informado').trim();
        const comb   = (row.fuel_type   || 'Não informado').trim();
        const concluido = row.status === 'completed';

        // Financeiro (totais, posto, combustível): só abastecimento concluído,
        // com ou sem placa — é o que bate com o que o posto cobra.
        if (concluido) {
          totalConcluidos += 1;
          totalLitros += litros;
          totalValor  += valor;
          if (!porPosto[posto]) porPosto[posto] = { litros:0, valor:0, contagem:0 };
          porPosto[posto].litros   += litros;
          porPosto[posto].valor    += valor;
          porPosto[posto].contagem += 1;
          if (!porCombustivel[comb]) porCombustivel[comb] = { litros:0, contagem:0 };
          porCombustivel[comb].litros   += litros;
          porCombustivel[comb].contagem += 1;
        } else {
          aguardandoBaixa.contagem += 1;
          aguardandoBaixa.litros   += litros;
        }

        // Por veículo / km por litro: só linhas com placa (concluídas ou assinadas).
        if (!placa) continue;
        litrosVeiculos += litros;

        const controlaPorHorimetro = placasHorimetro.has(placa);
        let kmRodados = (!controlaPorHorimetro && km > 0 && kmBef > 0 && km > kmBef) ? (km - kmBef) : 0;
        if (kmRodados > MAX_KM_ENTRE_ABASTECIMENTOS) kmRodados = 0; // dado implausível (digitação errada)
        if (kmRodados > 0) totalKmRodados += kmRodados;

        if (placa) {
          if (!porPlaca[placa]) porPlaca[placa] = { litros:0, kmRodados:0, contagem:0, controlaPorHorimetro };
          porPlaca[placa].litros    += litros;
          porPlaca[placa].kmRodados += kmRodados;
          porPlaca[placa].contagem  += 1;
        }
      }

      const kmLMedio = (totalKmRodados > 0 && litrosVeiculos > 0)
        ? (totalKmRodados / litrosVeiculos) : null;

      const placas = Object.entries(porPlaca)
        .map(([placa, d]) => ({
          placa,
          litros:    Math.round(d.litros * 10) / 10,
          kmRodados: d.kmRodados,
          kmL:       (d.kmRodados > 0 && d.litros > 0) ? Math.round(d.kmRodados / d.litros * 100) / 100 : null,
          contagem:  d.contagem,
          controlaPorHorimetro: d.controlaPorHorimetro,
        }))
        .sort((a, b) => b.litros - a.litros);

      const postos = Object.entries(porPosto)
        .map(([posto, d]) => ({
          posto,
          litros:   Math.round(d.litros * 10) / 10,
          valor:    Math.round(d.valor * 100) / 100,
          contagem: d.contagem,
        }))
        .sort((a, b) => b.litros - a.litros);

      const combustiveis = Object.entries(porCombustivel)
        .map(([tipo, d]) => ({
          tipo,
          litros:   Math.round(d.litros * 10) / 10,
          contagem: d.contagem,
          pct:      totalLitros > 0 ? Math.round(d.litros / totalLitros * 1000) / 10 : 0,
        }))
        .sort((a, b) => b.litros - a.litros);

      // ---- Histórico mensal (últimos 13 meses, sem filtro de período) ----
      // Coleta lista de meses únicos presentes nos dados
      const porMes = {}; // "YYYY-MM" => { litros, valor, contagem }
      for (const row of todosRows) {
        if (row.status !== 'completed') continue; // histórico financeiro: só concluídos
        const mesKey = mesLocalDe(row.date); // "YYYY-MM" no horário de Santarém
        if (!mesKey) continue;
        if (!porMes[mesKey]) porMes[mesKey] = { litros: 0, valor: 0, contagem: 0 };
        porMes[mesKey].litros   += parseLitros(row.liters);
        porMes[mesKey].valor    += parsePreco(row.real_value) || (parseLitros(row.liters) * parseFloat(row.price_per_liter || 0));
        porMes[mesKey].contagem += 1;
      }

      // Ordena cronologicamente e formata
      const historico = Object.entries(porMes)
        .sort((a, b) => a[0].localeCompare(b[0]))
        .map(([mes, d]) => ({
          mes,
          // Rótulo curto: "Nov/26"
          rotulo: (() => {
            const [a, m] = mes.split('-');
            const nomeMes = ['Jan','Fev','Mar','Abr','Mai','Jun','Jul','Ago','Set','Out','Nov','Dez'][parseInt(m,10)-1];
            return `${nomeMes}/${a.slice(2)}`;
          })(),
          litros:    Math.round(d.litros * 10) / 10,
          valor:     Math.round(d.valor * 100) / 100,
          contagem:  d.contagem,
        }));

      // ---- Listas de opções para os filtros (baseadas em TODOS os dados) ----
      const todasPlacas = [...new Set(todosRows.map((r) => (r.plate || '').trim().toUpperCase()).filter(Boolean))].sort();
      const todosPostos = [...new Set(todosRows.map((r) => (r.gas_station || '').trim()).filter(Boolean))].sort();
      const todosMeses  = historico.map((h) => ({ mes: h.mes, rotulo: h.rotulo }));

      const resposta = {
        periodo: filtroMes
          ? `mes:${filtroMes}`
          : (filtroDataInicio ? `data:${filtroDataInicio}_${filtroDataFim || 'hoje'}` : periodo),
        filtros: {
          placa: filtroPlaca, posto: filtroPosto, mes: filtroMes,
          dataInicio: filtroDataInicio, dataFim: filtroDataFim,
        },
        totalAbastecimentos: totalConcluidos,
        aguardandoBaixa: {
          contagem: aguardandoBaixa.contagem,
          litros:   Math.round(aguardandoBaixa.litros * 10) / 10,
        },
        totalLitros:  Math.round(totalLitros * 10) / 10,
        totalValor:   Math.round(totalValor * 100) / 100,
        kmLMedio:     kmLMedio !== null ? Math.round(kmLMedio * 100) / 100 : null,
        mediaLPorAbast: totalConcluidos > 0 ? Math.round(totalLitros / totalConcluidos * 10) / 10 : 0,
        placas,
        postos,
        combustiveis,
        historico,
        opcoes: { placas: todasPlacas, postos: todosPostos, meses: todosMeses },
      };

      // Salva no cache (limpa entradas expiradas periodicamente)
      ABAST_CACHE.set(cacheKey, { ts: Date.now(), dados: resposta });
      if (ABAST_CACHE.size > 50) {
        const agora = Date.now();
        for (const [k, v] of ABAST_CACHE) {
          if (agora - v.ts > ABAST_CACHE_TTL) ABAST_CACHE.delete(k);
        }
      }

      res.set('X-Cache', 'MISS');
      res.json(resposta);
    } catch (err) {
      console.error('[frota/abast-det]', err?.message || err);
      res.status(502).json({ erro: 'Falha ao buscar dados de abastecimento.' });
    }
  });

  // ------------------------------------------------------------------ //
  // Medição do posto: compara o que o posto cobra (borderô/cupons) com as
  // requisições do sistema. Só lê o banco — não altera nenhuma requisição.
  // ------------------------------------------------------------------ //
  let _postosCache = null;
  let _postosCacheAt = 0;

  // Lista de postos que têm requisição (para o seletor da tela). Cache de 10 min.
  r.get('/medicao/postos', autenticar, async (req, res) => {
    if (!SB_KEY) return res.status(503).json({ erro: 'Banco de abastecimento não configurado.' });
    try {
      if (!_postosCache || Date.now() - _postosCacheAt > 10 * 60 * 1000) {
        const linhas = await sbFetchTodos('/requests?select=id,gas_station&gas_station=not.is.null&order=id.asc');
        _postosCache = [...new Set(linhas.map((l) => (l.gas_station || '').trim()).filter(Boolean))]
          .sort((a, b) => a.localeCompare(b, 'pt-BR'));
        _postosCacheAt = Date.now();
      }
      res.json({ postos: _postosCache });
    } catch (err) {
      console.error('[frota/medicao] postos:', err?.message || err);
      res.status(502).json({ erro: 'Falha ao carregar a lista de postos.' });
    }
  });

  // Recebe o PDF do borderô (corpo binário, application/pdf) e devolve as notas lidas.
  r.post('/medicao/ler-pdf', autenticar, express.raw({ type: 'application/pdf', limit: '20mb' }), async (req, res) => {
    if (!Buffer.isBuffer(req.body) || req.body.length < 100) {
      return res.status(400).json({ erro: 'Envie um arquivo PDF.' });
    }
    try {
      res.json(await lerBorderoPdf(req.body));
    } catch (err) {
      if (err instanceof PdfSemTextoError) return res.status(422).json({ erro: err.message });
      console.error('[frota/medicao] ler-pdf:', err?.message || err);
      res.status(422).json({ erro: 'Não consegui abrir este PDF. Digite os cupons manualmente.' });
    }
  });

  // Compara as notas do posto com as requisições do período.
  r.post('/medicao/comparar', autenticar, async (req, res) => {
    if (!SB_KEY) return res.status(503).json({ erro: 'Banco de abastecimento não configurado.' });
    const entrada = req.body || {};
    const erro = validarEntrada(entrada);
    if (erro) return res.status(400).json({ erro });
    try {
      res.json(await compararMedicao({ buscar: sbFetchTodos, ...entrada }));
    } catch (err) {
      console.error('[frota/medicao] comparar:', err?.message || err);
      res.status(502).json({ erro: 'Falha ao comparar com o sistema de abastecimento.' });
    }
  });

  // Mesma comparação, devolvida como planilha do Excel.
  r.post('/medicao/exportar', autenticar, async (req, res) => {
    if (!SB_KEY) return res.status(503).json({ erro: 'Banco de abastecimento não configurado.' });
    const entrada = req.body || {};
    const erro = validarEntrada(entrada);
    if (erro) return res.status(400).json({ erro });
    try {
      const resultado = await compararMedicao({ buscar: sbFetchTodos, ...entrada });
      const arquivo = await gerarXlsx(resultado);
      const nome = `Medicao_${resultado.posto.replace(/[^A-Za-z0-9]+/g, '_')}_${resultado.de}_a_${resultado.ate}.xlsx`;
      res.set({
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': `attachment; filename="${nome}"`,
      });
      res.send(arquivo);
    } catch (err) {
      console.error('[frota/medicao] exportar:', err?.message || err);
      res.status(502).json({ erro: 'Falha ao gerar a planilha.' });
    }
  });

  return r;
}
