// Leitura e escrita de .xlsx sem bibliotecas externas (roda no navegador).
//  • lerPlanilha(arrayBuffer) → linhas da 1ª aba como arrays de valores
//  • gerarXlsx(abas) → Blob .xlsx com estilos fixos (cabeçalho, bordas, datas…)
// Leitura usa DecompressionStream('deflate-raw') — Chrome/Edge 103+,
// Firefox 113+, Safari 16.4+.

// ======================= ZIP: leitura =======================
async function inflarRaw(bytes) {
  const ds = new DecompressionStream('deflate-raw');
  const stream = new Blob([bytes]).stream().pipeThrough(ds);
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

async function abrirZip(buf) {
  const u8 = new Uint8Array(buf);
  const dv = new DataView(buf);
  let eocd = -1;
  for (let i = u8.length - 22; i >= Math.max(0, u8.length - 65557); i--) {
    if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('Arquivo não é um .xlsx válido.');
  const total = dv.getUint16(eocd + 10, true);
  let p = dv.getUint32(eocd + 16, true);
  const dec = new TextDecoder();
  const entradas = new Map();
  for (let n = 0; n < total; n++) {
    if (dv.getUint32(p, true) !== 0x02014b50) break;
    const metodo = dv.getUint16(p + 10, true);
    const tamComp = dv.getUint32(p + 20, true);
    const lenNome = dv.getUint16(p + 28, true);
    const lenExtra = dv.getUint16(p + 30, true);
    const lenCom = dv.getUint16(p + 32, true);
    const offLocal = dv.getUint32(p + 42, true);
    const nome = dec.decode(u8.subarray(p + 46, p + 46 + lenNome));
    entradas.set(nome, { metodo, tamComp, offLocal });
    p += 46 + lenNome + lenExtra + lenCom;
  }
  return {
    tem: (nome) => entradas.has(nome),
    async texto(nome) {
      const e = entradas.get(nome);
      if (!e) return null;
      const lnome = dv.getUint16(e.offLocal + 26, true);
      const lextra = dv.getUint16(e.offLocal + 28, true);
      const ini = e.offLocal + 30 + lnome + lextra;
      const dados = u8.subarray(ini, ini + e.tamComp);
      const bytes = e.metodo === 0 ? dados : await inflarRaw(dados);
      return dec.decode(bytes);
    },
  };
}

// ======================= XLSX: leitura =======================
const xml = (s) => new DOMParser().parseFromString(s, 'application/xml');
const tags = (node, nome) => Array.from(node.getElementsByTagNameNS('*', nome));

function colunaParaIndice(ref) {
  const letras = (ref.match(/^[A-Z]+/) || ['A'])[0];
  let n = 0;
  for (const ch of letras) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

export async function lerPlanilha(buf) {
  const zip = await abrirZip(buf);

  // 1ª aba listada no workbook
  let caminhoAba = 'xl/worksheets/sheet1.xml';
  const wbXml = await zip.texto('xl/workbook.xml');
  const relsXml = await zip.texto('xl/_rels/workbook.xml.rels');
  if (wbXml && relsXml) {
    const primeira = tags(xml(wbXml), 'sheet')[0];
    const rid = primeira?.getAttributeNS('http://schemas.openxmlformats.org/officeDocument/2006/relationships', 'id') || primeira?.getAttribute('r:id');
    const rel = tags(xml(relsXml), 'Relationship').find((r) => r.getAttribute('Id') === rid);
    if (rel) {
      const alvo = rel.getAttribute('Target');
      caminhoAba = alvo.startsWith('/') ? alvo.slice(1) : `xl/${alvo.replace(/^\.\//, '')}`;
    }
  }

  const compartilhadas = [];
  const ssXml = await zip.texto('xl/sharedStrings.xml');
  if (ssXml) {
    for (const si of tags(xml(ssXml), 'si')) {
      compartilhadas.push(tags(si, 't').map((t) => t.textContent).join(''));
    }
  }

  const abaXml = await zip.texto(caminhoAba);
  if (!abaXml) throw new Error('Não consegui abrir a primeira aba da planilha.');
  const linhas = [];
  for (const row of tags(xml(abaXml), 'row')) {
    const r = Number(row.getAttribute('r')) - 1;
    const valores = [];
    for (const c of tags(row, 'c')) {
      const ref = c.getAttribute('r');
      const j = ref ? colunaParaIndice(ref) : valores.length;
      const t = c.getAttribute('t');
      const v = tags(c, 'v')[0]?.textContent;
      let val = null;
      if (t === 's') val = compartilhadas[Number(v)] ?? '';
      else if (t === 'inlineStr') val = tags(c, 't').map((x) => x.textContent).join('');
      else if (t === 'str') val = v ?? '';
      else if (t === 'b') val = v === '1';
      else if (v !== undefined) val = Number(v);
      valores[j] = val;
    }
    linhas[Number.isFinite(r) ? r : linhas.length] = valores;
  }
  return linhas;
}

// ======================= ZIP: escrita (sem compressão) =======================
const CRC_TABELA = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(u8) {
  let c = 0xffffffff;
  for (let i = 0; i < u8.length; i++) c = CRC_TABELA[(c ^ u8[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function montarZip(arquivos) {
  const enc = new TextEncoder();
  const partes = [];
  const central = [];
  let offset = 0;
  for (const { nome, conteudo } of arquivos) {
    const nomeB = enc.encode(nome);
    const dados = typeof conteudo === 'string' ? enc.encode(conteudo) : conteudo;
    const crc = crc32(dados);
    const lh = new DataView(new ArrayBuffer(30));
    lh.setUint32(0, 0x04034b50, true); lh.setUint16(4, 20, true); lh.setUint16(6, 0x0800, true);
    lh.setUint16(8, 0, true); lh.setUint16(10, 0, true); lh.setUint16(12, 0x21, true);
    lh.setUint32(14, crc, true); lh.setUint32(18, dados.length, true); lh.setUint32(22, dados.length, true);
    lh.setUint16(26, nomeB.length, true); lh.setUint16(28, 0, true);
    partes.push(new Uint8Array(lh.buffer), nomeB, dados);

    const ch = new DataView(new ArrayBuffer(46));
    ch.setUint32(0, 0x02014b50, true); ch.setUint16(4, 20, true); ch.setUint16(6, 20, true);
    ch.setUint16(8, 0x0800, true); ch.setUint16(10, 0, true); ch.setUint16(12, 0, true); ch.setUint16(14, 0x21, true);
    ch.setUint32(16, crc, true); ch.setUint32(20, dados.length, true); ch.setUint32(24, dados.length, true);
    ch.setUint16(28, nomeB.length, true); ch.setUint32(42, offset, true);
    central.push(new Uint8Array(ch.buffer), nomeB);
    offset += 30 + nomeB.length + dados.length;
  }
  const tamCentral = central.reduce((s, p) => s + p.length, 0);
  const fim = new DataView(new ArrayBuffer(22));
  fim.setUint32(0, 0x06054b50, true);
  fim.setUint16(8, arquivos.length, true); fim.setUint16(10, arquivos.length, true);
  fim.setUint32(12, tamCentral, true); fim.setUint32(16, offset, true);
  return new Blob([...partes, ...central, new Uint8Array(fim.buffer)], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
}

// ======================= XLSX: escrita =======================
// Índices de estilo (cellXfs) disponíveis para quem monta as abas:
export const E = {
  padrao: 0, titulo: 1, subtitulo: 2, cabecalho: 3, texto: 4, inteiro: 5, decimal: 6,
  dataHora: 7, duracao: 8, link: 9, totalTexto: 10, totalDecimal: 11, totalDuracao: 12,
  totalInteiro: 13, rotulo: 14, destaque: 15, alerta: 16, quebra: 17,
};

const STYLES_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<numFmts count="3"><numFmt numFmtId="164" formatCode="#,##0.0"/><numFmt numFmtId="165" formatCode="dd/mm/yyyy hh:mm"/><numFmt numFmtId="166" formatCode="[h]:mm"/></numFmts>
<fonts count="8">
<font><sz val="10"/><name val="Calibri"/><family val="2"/></font>
<font><b/><sz val="16"/><color rgb="FF1F1A12"/><name val="Calibri"/><family val="2"/></font>
<font><sz val="10"/><color rgb="FF6B6B6B"/><name val="Calibri"/><family val="2"/></font>
<font><b/><sz val="10"/><color rgb="FFFFFFFF"/><name val="Calibri"/><family val="2"/></font>
<font><u/><sz val="10"/><color rgb="FF0563C1"/><name val="Calibri"/><family val="2"/></font>
<font><b/><sz val="10"/><name val="Calibri"/><family val="2"/></font>
<font><b/><sz val="14"/><color rgb="FF1F1A12"/><name val="Calibri"/><family val="2"/></font>
<font><b/><sz val="10"/><color rgb="FFB45309"/><name val="Calibri"/><family val="2"/></font>
</fonts>
<fills count="4">
<fill><patternFill patternType="none"/></fill>
<fill><patternFill patternType="gray125"/></fill>
<fill><patternFill patternType="solid"><fgColor rgb="FFE5821A"/><bgColor indexed="64"/></patternFill></fill>
<fill><patternFill patternType="solid"><fgColor rgb="FFFFF3E2"/><bgColor indexed="64"/></patternFill></fill>
</fills>
<borders count="2">
<border><left/><right/><top/><bottom/><diagonal/></border>
<border><left style="thin"><color rgb="FFD9D9D9"/></left><right style="thin"><color rgb="FFD9D9D9"/></right><top style="thin"><color rgb="FFD9D9D9"/></top><bottom style="thin"><color rgb="FFD9D9D9"/></bottom><diagonal/></border>
</borders>
<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
<cellXfs count="18">
<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>
<xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/>
<xf numFmtId="0" fontId="2" fillId="0" borderId="0" xfId="0" applyFont="1"/>
<xf numFmtId="0" fontId="3" fillId="2" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment vertical="center" wrapText="1"/></xf>
<xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyBorder="1" applyAlignment="1"><alignment vertical="top"/></xf>
<xf numFmtId="3" fontId="0" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyBorder="1" applyAlignment="1"><alignment vertical="top"/></xf>
<xf numFmtId="164" fontId="0" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyBorder="1" applyAlignment="1"><alignment vertical="top"/></xf>
<xf numFmtId="165" fontId="0" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyBorder="1" applyAlignment="1"><alignment horizontal="left" vertical="top"/></xf>
<xf numFmtId="166" fontId="0" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyBorder="1" applyAlignment="1"><alignment horizontal="right" vertical="top"/></xf>
<xf numFmtId="0" fontId="4" fillId="0" borderId="1" xfId="0" applyFont="1" applyBorder="1" applyAlignment="1"><alignment vertical="top"/></xf>
<xf numFmtId="0" fontId="5" fillId="3" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1"/>
<xf numFmtId="164" fontId="5" fillId="3" borderId="1" xfId="0" applyNumberFormat="1" applyFont="1" applyFill="1" applyBorder="1"/>
<xf numFmtId="166" fontId="5" fillId="3" borderId="1" xfId="0" applyNumberFormat="1" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="right"/></xf>
<xf numFmtId="3" fontId="5" fillId="3" borderId="1" xfId="0" applyNumberFormat="1" applyFont="1" applyFill="1" applyBorder="1"/>
<xf numFmtId="0" fontId="5" fillId="0" borderId="0" xfId="0" applyFont="1" applyAlignment="1"><alignment vertical="top"/></xf>
<xf numFmtId="0" fontId="5" fillId="0" borderId="0" xfId="0" applyFont="1" applyAlignment="1"><alignment horizontal="left" vertical="top"/></xf>
<xf numFmtId="0" fontId="7" fillId="0" borderId="0" xfId="0" applyFont="1"/>
<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf>
</cellXfs>
<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>
</styleSheet>`;

const esc = (s) => String(s)
  // eslint-disable-next-line no-control-regex
  .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function letraColuna(i) {
  let s = ''; i += 1;
  while (i > 0) { const m = (i - 1) % 26; s = String.fromCharCode(65 + m) + s; i = Math.floor((i - 1) / 26); }
  return s;
}

// Date "de parede" → número serial do Excel
const serialExcel = (d) => Date.UTC(d.getFullYear(), d.getMonth(), d.getDate(), d.getHours(), d.getMinutes(), d.getSeconds()) / 86400000 + 25569;

// célula: valor simples, ou { v, s, link } — link vira =HYPERLINK(link; v)
function celulaXml(cel, ref) {
  if (cel === null || cel === undefined) return '';
  const obj = typeof cel === 'object' && !(cel instanceof Date) ? cel : { v: cel };
  const s = obj.s ?? 0;
  const v = obj.v;
  if (obj.link) {
    const f = `HYPERLINK("${String(obj.link).replace(/"/g, '""')}","${String(v ?? obj.link).replace(/"/g, '""')}")`;
    return `<c r="${ref}" s="${s}" t="str"><f>${esc(f)}</f><v>${esc(v ?? obj.link)}</v></c>`;
  }
  if (v === null || v === undefined || v === '') return s ? `<c r="${ref}" s="${s}"/>` : '';
  if (v instanceof Date) return `<c r="${ref}" s="${s}"><v>${serialExcel(v)}</v></c>`;
  if (typeof v === 'number' && Number.isFinite(v)) return `<c r="${ref}" s="${s}"><v>${v}</v></c>`;
  return `<c r="${ref}" s="${s}" t="inlineStr"><is><t xml:space="preserve">${esc(v)}</t></is></c>`;
}

// aba: { nome, larguras:[n], linhas:[[cel]], alturas:{idx:pt}, mesclar:['A1:F1'],
//        congelar:{ linha, coluna }, filtro:'A5:K40', paisagem:bool }
function abaXml(aba) {
  const cols = (aba.larguras || []).map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`).join('');
  let pane = '';
  if (aba.congelar) {
    const { linha = 0, coluna = 0 } = aba.congelar;
    const ref = `${letraColuna(coluna)}${linha + 1}`;
    pane = `<pane ${coluna ? `xSplit="${coluna}" ` : ''}${linha ? `ySplit="${linha}" ` : ''}topLeftCell="${ref}" activePane="${linha && coluna ? 'bottomRight' : linha ? 'bottomLeft' : 'topRight'}" state="frozen"/>`;
  }
  const rows = aba.linhas.map((linha, i) => {
    const alt = aba.alturas?.[i];
    const cels = (linha || []).map((c, j) => celulaXml(c, `${letraColuna(j)}${i + 1}`)).join('');
    return `<row r="${i + 1}"${alt ? ` ht="${alt}" customHeight="1"` : ''}>${cels}</row>`;
  }).join('');
  const merges = aba.mesclar?.length ? `<mergeCells count="${aba.mesclar.length}">${aba.mesclar.map((m) => `<mergeCell ref="${m}"/>`).join('')}</mergeCells>` : '';
  const filtro = aba.filtro ? `<autoFilter ref="${aba.filtro}"/>` : '';
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
<sheetPr><pageSetUpPr fitToPage="1"/></sheetPr>
<sheetViews><sheetView workbookViewId="0" showGridLines="0">${pane}</sheetView></sheetViews>
<sheetFormatPr defaultRowHeight="14"/>
${cols ? `<cols>${cols}</cols>` : ''}
<sheetData>${rows}</sheetData>
${filtro}${merges}
<pageMargins left="0.4" right="0.4" top="0.5" bottom="0.5" header="0.3" footer="0.3"/>
<pageSetup paperSize="9" orientation="${aba.paisagem ? 'landscape' : 'portrait'}" fitToWidth="1" fitToHeight="0"/>
</worksheet>`;
}

export function gerarXlsx(abas, { titulo = '', autor = '' } = {}) {
  const n = abas.length;
  const nomes = abas.map((a) => esc(a.nome.replace(/[\\/?*[\]:]/g, ' ').slice(0, 31)));
  const agora = new Date().toISOString().replace(/\.\d+Z$/, 'Z');
  const arquivos = [
    { nome: '[Content_Types].xml', conteudo: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>
${abas.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('\n')}
<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>
</Types>` },
    { nome: '_rels/.rels', conteudo: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>
</Relationships>` },
    { nome: 'docProps/core.xml', conteudo: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
<dc:title>${esc(titulo)}</dc:title><dc:creator>${esc(autor)}</dc:creator>
<dcterms:created xsi:type="dcterms:W3CDTF">${agora}</dcterms:created>
</cp:coreProperties>` },
    { nome: 'xl/workbook.xml', conteudo: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
<bookViews><workbookView activeTab="0"/></bookViews>
<sheets>${nomes.map((nm, i) => `<sheet name="${nm}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('')}</sheets>
${abas.some((a) => a.filtro) ? `<definedNames>${abas.map((a, i) => a.filtro ? `<definedName name="_xlnm._FilterDatabase" localSheetId="${i}" hidden="1">'${nomes[i]}'!${a.filtro.replace(/([A-Z]+)(\d+)/g, '$$$1$$$2')}</definedName>` : '').join('')}</definedNames>` : ''}
</workbook>` },
    { nome: 'xl/_rels/workbook.xml.rels', conteudo: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
${abas.map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join('\n')}
<Relationship Id="rId${n + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
</Relationships>` },
    { nome: 'xl/styles.xml', conteudo: STYLES_XML },
    ...abas.map((a, i) => ({ nome: `xl/worksheets/sheet${i + 1}.xml`, conteudo: abaXml(a) })),
  ];
  return montarZip(arquivos);
}
