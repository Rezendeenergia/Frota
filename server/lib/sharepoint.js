import { ConfidentialClientApplication } from '@azure/msal-node';

// Mesmo padrão de autenticação do CromFolgas (server/lib/sharepoint.js):
// client-credentials flow via Microsoft Graph, sem login interativo. Usa
// o MESMO App Registration do Azure já configurado para o CromFolgas — só
// repita as 3 variáveis de ambiente neste serviço (ver render.yaml).

const GRAPH_BASE = 'https://graph.microsoft.com/v1.0';
const SITE_PATH = 'rezendeenergia.sharepoint.com:/sites/Intranet';

function requireEnv(name) {
  const value = process.env[name];
  if (!value) {
    throw new Error(
      `Variável de ambiente '${name}' não configurada. Defina-a nas Environment variables do serviço no Render (mesmos valores do serviço cromfolgas).`
    );
  }
  return value;
}

let cachedSiteId = null;

async function getAccessToken() {
  const app = new ConfidentialClientApplication({
    auth: {
      clientId: requireEnv('SHAREPOINT_CLIENT_ID'),
      authority: `https://login.microsoftonline.com/${requireEnv('SHAREPOINT_TENANT_ID')}`,
      clientSecret: requireEnv('SHAREPOINT_CLIENT_SECRET'),
    },
  });

  const result = await app.acquireTokenByClientCredential({
    scopes: ['https://graph.microsoft.com/.default'],
  });

  if (!result?.accessToken) {
    throw new Error('Não foi possível autenticar no Microsoft Graph (token vazio).');
  }
  return result.accessToken;
}

async function graphGetJson(path, token, timeoutMs = 15000) {
  const res = await fetch(`${GRAPH_BASE}${path}`, {
    headers: { Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Graph API falhou (${path}): ${res.status} ${body}`);
  }
  return res.json();
}

async function getSiteId(token) {
  if (cachedSiteId) return cachedSiteId;
  const site = await graphGetJson(`/sites/${SITE_PATH}`, token);
  cachedSiteId = site.id;
  return cachedSiteId;
}

// Baixa um arquivo do SharePoint (site Intranet) pelo nome exato e retorna
// o conteúdo binário (ArrayBuffer). Reaproveitável para qualquer planilha
// do mesmo site — hoje usamos para a de manutenção; a de abastecimento
// vem por API própria (ver abastecimentoService.js).
export async function downloadWorkbookByName(filename) {
  const token = await getAccessToken();
  const siteId = await getSiteId(token);

  const search = await graphGetJson(
    `/sites/${siteId}/drive/root/search(q='${encodeURIComponent(filename)}')`,
    token
  );
  // Se existir mais de um arquivo com o mesmo nome (ex.: a planilha antiga
  // esquecida em outra pasta), usa o modificado mais recentemente.
  const candidatos = (search.value || [])
    .filter((i) => i.name === filename)
    .sort((a, b) => new Date(b.lastModifiedDateTime || 0) - new Date(a.lastModifiedDateTime || 0));
  const item = candidatos[0];
  if (!item) {
    throw new Error(`Arquivo '${filename}' não encontrado no SharePoint (site Intranet).`);
  }

  const res = await fetch(`${GRAPH_BASE}/sites/${siteId}/drive/items/${item.id}/content`, {
    headers: { Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(30000),
  });
  if (!res.ok) {
    throw new Error(`Falha ao baixar '${filename}': ${res.status}`);
  }
  return res.arrayBuffer();
}

// Baixa um arquivo a partir de um LINK DE COMPARTILHAMENTO do SharePoint
// (o link "https://rezendeenergia.sharepoint.com/:x:/s/Intranet/...").
// É a forma mais segura de apontar para a planilha certa, porque o link
// identifica o arquivo exato — não depende do nome nem da pasta onde ele está.
// Usa o endpoint /shares do Graph: u! + base64url(link).
export async function downloadWorkbookByShareUrl(shareUrl) {
  const token = await getAccessToken();
  const encoded =
    'u!' +
    Buffer.from(shareUrl, 'utf8')
      .toString('base64')
      .replace(/=+$/, '')
      .replace(/\//g, '_')
      .replace(/\+/g, '-');

  const res = await fetch(`${GRAPH_BASE}/shares/${encoded}/driveItem/content`, {
    headers: { Authorization: `Bearer ${token}` },
    redirect: 'follow',
    signal: AbortSignal.timeout(30000),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Falha ao baixar a planilha pelo link de compartilhamento: ${res.status} ${body.slice(0, 200)}`);
  }
  return res.arrayBuffer();
}
