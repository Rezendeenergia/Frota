import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { fetchManutencao } from './lib/manutencaoService.js';
import { fetchAbastecimento } from './lib/abastecimentoService.js';
import { fetchEstoque } from './lib/estoqueService.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.join(__dirname, '..', 'public');

const PORT = process.env.PORT || 3000;

// A TV pede a cada poucos minutos (ver public/app.js), e os dados em si
// agora ficam "frescos" por 5 min antes de buscar de novo no SharePoint/
// sistema de abastecimento (antes era 30 min).
const CACHE_TTL_MS = 5 * 60 * 1000;
const REFRESH_INTERVAL_MS = 5 * 60 * 1000;

// Filtro de período clicável na tela (ver public/app.js): 'hoje' | '7dias' |
// '30dias' | 'mes'. Cada opção tem seu próprio cache — senão, trocar de
// filtro na tela ia às vezes devolver dados de outro período (o antigo
// `cache` era um objeto único, sem noção de período).
const VALID_PERIODOS = new Set(['hoje', '7dias', '30dias', 'mes']);
const DEFAULT_PERIODO = '7dias';

const cache = new Map(); // periodo -> { payload, generatedAt }

async function buildPayload(periodo) {
  // Busca as 3 fontes em paralelo. Cada uma trata seu próprio erro e
  // devolve um objeto "vazio, mas válido" em vez de derrubar as outras —
  // uma fonte fora do ar nunca deve apagar o resto da TV.
  const [manutencao, abastecimento, estoque] = await Promise.allSettled([
    fetchManutencao(periodo),
    fetchAbastecimento(periodo),
    fetchEstoque(),
  ]);

  const pickOrError = (settled, label) => {
    if (settled.status === 'fulfilled') return { ok: true, data: settled.value };
    console.error(`[painel] falha em ${label}:`, settled.reason?.message || settled.reason);
    return { ok: false, error: String(settled.reason?.message || settled.reason) };
  };

  const m = pickOrError(manutencao, 'manutencao');
  const a = pickOrError(abastecimento, 'abastecimento');
  const e = pickOrError(estoque, 'estoque');

  return {
    generatedAt: new Date().toISOString(),
    manutencao: m.ok ? m.data : { disponivel: false, motivo: m.error },
    abastecimento: a.ok ? a.data : { disponivel: false, motivo: a.error },
    estoque: e.ok ? e.data : { disponivel: false, motivo: e.error },
  };
}

async function refreshCache(periodo = DEFAULT_PERIODO) {
  try {
    const payload = await buildPayload(periodo);
    cache.set(periodo, { payload, generatedAt: payload.generatedAt });
    console.log(`[cache] atualizado (${periodo}) às ${payload.generatedAt}`);
  } catch (err) {
    console.error(`[cache] falha ao atualizar (${periodo}):`, err?.message || err);
  }
}

const app = express();

app.get('/api/painel', async (req, res) => {
  const force = ['1', 'true'].includes(String(req.query.force));
  const periodoBruto = String(req.query.periodo || DEFAULT_PERIODO);
  const periodo = VALID_PERIODOS.has(periodoBruto) ? periodoBruto : DEFAULT_PERIODO;

  const cached = cache.get(periodo);
  if (!force && cached && Date.now() - new Date(cached.generatedAt).getTime() < CACHE_TTL_MS) {
    return res.json({ ...cached.payload, fromCache: true });
  }

  try {
    const payload = await buildPayload(periodo);
    cache.set(periodo, { payload, generatedAt: payload.generatedAt });
    return res.json({ ...payload, fromCache: false });
  } catch (err) {
    // Nunca deveria cair aqui (buildPayload não rejeita), mas por garantia:
    // se tiver cache velho desse mesmo período, devolve ele em vez de
    // deixar a TV sem nada.
    if (cached) {
      return res.json({ ...cached.payload, fromCache: true, stale: true, error: String(err?.message || err) });
    }
    return res.status(502).json({ error: String(err?.message || err) });
  }
});

app.use(express.static(PUBLIC_DIR));

app.get(/^(?!\/api\/).*/, (req, res) => {
  res.sendFile(path.join(PUBLIC_DIR, 'index.html'));
});

app.listen(PORT, () => {
  console.log(`Painel TV rodando na porta ${PORT}`);
  // O refresh automático em segundo plano só mantém o período padrão
  // (7 dias) sempre fresco — é o que a TV mostra ao carregar. Os outros 3
  // períodos são calculados na hora quando alguém clica no filtro, e a
  // partir daí ficam no cache normalmente (mesmo CACHE_TTL_MS).
  refreshCache(DEFAULT_PERIODO);
  setInterval(() => refreshCache(DEFAULT_PERIODO), REFRESH_INTERVAL_MS);
});
