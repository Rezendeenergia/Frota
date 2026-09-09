import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { fetchManutencao } from './lib/manutencaoService.js';
import { fetchAbastecimento } from './lib/abastecimentoService.js';
import { fetchEstoque } from './lib/estoqueService.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.join(__dirname, '..', 'public');

const PORT = process.env.PORT || 3000;

// A TV pede a cada poucos minutos (ver public/app.js), mas os dados em si
// só precisam ficar "frescos" a cada 30 min — mesma ideia de cache do
// CromFolgas, só que com TTL maior porque a fonte (SharePoint via Graph)
// não precisa ser batida com tanta frequência.
const CACHE_TTL_MS = 30 * 60 * 1000;
const REFRESH_INTERVAL_MS = 30 * 60 * 1000;

let cache = null; // { payload, generatedAt }

async function buildPayload() {
  // Busca as 3 fontes em paralelo. Cada uma trata seu próprio erro e
  // devolve um objeto "vazio, mas válido" em vez de derrubar as outras —
  // uma fonte fora do ar nunca deve apagar o resto da TV.
  const [manutencao, abastecimento, estoque] = await Promise.allSettled([
    fetchManutencao(),
    fetchAbastecimento(),
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

async function refreshCache() {
  try {
    const payload = await buildPayload();
    cache = { payload, generatedAt: payload.generatedAt };
    console.log(`[cache] atualizado às ${payload.generatedAt}`);
  } catch (err) {
    console.error('[cache] falha ao atualizar:', err?.message || err);
  }
}

const app = express();

app.get('/api/painel', async (req, res) => {
  const force = ['1', 'true'].includes(String(req.query.force));

  if (!force && cache && Date.now() - new Date(cache.generatedAt).getTime() < CACHE_TTL_MS) {
    return res.json({ ...cache.payload, fromCache: true });
  }

  try {
    const payload = await buildPayload();
    cache = { payload, generatedAt: payload.generatedAt };
    return res.json({ ...payload, fromCache: false });
  } catch (err) {
    // Nunca deveria cair aqui (buildPayload não rejeita), mas por garantia:
    // se tiver cache velho, devolve ele em vez de deixar a TV sem nada.
    if (cache) {
      return res.json({ ...cache.payload, fromCache: true, stale: true, error: String(err?.message || err) });
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
  refreshCache();
  setInterval(refreshCache, REFRESH_INTERVAL_MS);
});
