const textEncoder = new TextEncoder();

function utf8(value) { return textEncoder.encode(String(value ?? '')); }
function u16(value) { return [value & 255, (value >>> 8) & 255]; }
function u32(value) { return [value & 255, (value >>> 8) & 255, (value >>> 16) & 255, (value >>> 24) & 255]; }
function concat(parts) {
  const length = parts.reduce((sum, part) => sum + part.length, 0);
  const output = new Uint8Array(length);
  let offset = 0;
  for (const part of parts) { output.set(part, offset); offset += part.length; }
  return output;
}
function crc32(bytes) {
  let crc = -1;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xEDB88320 : 0);
  }
  return (crc ^ -1) >>> 0;
}
function xmlEscape(value) {
  return String(value ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}

/** Creates a ZIP archive using the ZIP "stored" method, compatible with OOXML. */
export function createStoredZip(entries) {
  const localParts = [];
  const centralParts = [];
  let offset = 0;
  for (const entry of entries) {
    const name = utf8(entry.name);
    const data = typeof entry.data === 'string' ? utf8(entry.data) : entry.data;
    const crc = crc32(data);
    const local = new Uint8Array([
      ...u32(0x04034b50), ...u16(20), ...u16(0), ...u16(0), ...u16(0), ...u16(0),
      ...u32(crc), ...u32(data.length), ...u32(data.length), ...u16(name.length), ...u16(0),
    ]);
    localParts.push(local, name, data);
    const central = new Uint8Array([
      ...u32(0x02014b50), ...u16(20), ...u16(20), ...u16(0), ...u16(0), ...u16(0), ...u16(0),
      ...u32(crc), ...u32(data.length), ...u32(data.length), ...u16(name.length), ...u16(0),
      ...u16(0), ...u16(0), ...u16(0), ...u32(0), ...u32(offset),
    ]);
    centralParts.push(central, name);
    offset += local.length + name.length + data.length;
  }
  const localDirectory = concat(localParts);
  const centralDirectory = concat(centralParts);
  const end = new Uint8Array([
    ...u32(0x06054b50), ...u16(0), ...u16(0), ...u16(entries.length), ...u16(entries.length),
    ...u32(centralDirectory.length), ...u32(localDirectory.length), ...u16(0),
  ]);
  return concat([localDirectory, centralDirectory, end]);
}

function paragraphXml(paragraph, defaultRtl = true) {
  const item = typeof paragraph === 'string' ? { text: paragraph } : paragraph;
  const alignment = item.align || (defaultRtl ? 'right' : 'left');
  const heading = item.heading ? '<w:pStyle w:val="Heading1"/>' : '';
  const rtl = item.rtl === undefined ? defaultRtl : item.rtl;
  const bold = item.bold ? '<w:b/><w:bCs/>' : '';
  const pPr = '<w:pPr>' + heading + '<w:jc w:val="' + alignment + '"/>' + (rtl ? '<w:bidi/>' : '') + '</w:pPr>';
  const rPr = '<w:rPr>' + bold + (rtl ? '<w:rtl/>' : '') + '<w:lang w:val="' + (rtl ? 'ar-JO' : 'en-US') + '"/></w:rPr>';
  return '<w:p>' + pPr + '<w:r>' + rPr + '<w:t xml:space="preserve">' + xmlEscape(item.text) + '</w:t></w:r></w:p>';
}

function tableXml(table, defaultRtl = true) {
  const columns = Array.isArray(table) ? table : [];
  if (!columns.length) return '';
  const rows = columns.map((row, rowIndex) => {
    const cells = (Array.isArray(row) ? row : [row]).map(cell => {
      const text = typeof cell === 'object' && cell !== null ? cell.text : cell;
      const isHeader = (typeof cell === 'object' && cell !== null && cell.header) || rowIndex === 0;
      const fill = isHeader ? '<w:shd w:fill="E7EDF4"/>' : '';
      const p = paragraphXml({ text: String(text ?? ''), bold: Boolean(isHeader), rtl: defaultRtl, align: defaultRtl ? 'right' : 'left' }, defaultRtl);
      return '<w:tc><w:tcPr>' + fill + '<w:tcMar><w:top w:w="80" w:type="dxa"/><w:bottom w:w="80" w:type="dxa"/><w:start w:w="100" w:type="dxa"/><w:end w:w="100" w:type="dxa"/></w:tcMar></w:tcPr>' + p + '</w:tc>';
    }).join('');
    return '<w:tr>' + cells + '</w:tr>';
  }).join('');
  const width = Math.max(...columns.map(row => Array.isArray(row) ? row.length : 1));
  const grid = Array.from({ length: width }, () => '<w:gridCol w:w="2300"/>').join('');
  return '<w:tbl><w:tblPr><w:tblStyle w:val="TableGrid"/><w:bidiVisual/><w:tblW w:w="0" w:type="auto"/><w:tblBorders>' +
    ['top','left','bottom','right','insideH','insideV'].map(edge => '<w:' + edge + ' w:val="single" w:sz="4" w:space="0" w:color="CBD5E1"/>').join('') +
    '</w:tblBorders></w:tblPr><w:tblGrid>' + grid + '</w:tblGrid>' + rows + '</w:tbl>';
}

/**
 * Builds a valid Word Open XML .docx file without a server dependency.
 * This creates a draft document only; it does not assert legal or ISA compliance.
 */
export function buildDocxBytes({ title = 'Ledgerly Report', paragraphs = [], tables = [], language = 'ar-JO', rtl = true } = {}) {
  const body = [];
  if (title) body.push(paragraphXml({ text: title, heading: true, bold: true, rtl, align: rtl ? 'right' : 'left' }, rtl));
  for (const paragraph of paragraphs) {
    if (paragraph && typeof paragraph === 'object' && paragraph.table) body.push(tableXml(paragraph.table, rtl));
    else body.push(paragraphXml(paragraph, rtl));
  }
  for (const table of tables) body.push(tableXml(table, rtl));
  body.push('<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="900" w:right="900" w:bottom="900" w:left="900" w:header="450" w:footer="450" w:gutter="0"/></w:sectPr>');
  const documentXml = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><w:body>' +
    body.join('') + '</w:body></w:document>';
  const stylesXml = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">' +
    '<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:rPr><w:rFonts w:ascii="Aptos" w:hAnsi="Aptos" w:eastAsia="Aptos" w:cs="Arial"/><w:sz w:val="22"/><w:lang w:val="' + xmlEscape(language) + '"/></w:rPr><w:pPr><w:spacing w:after="120"/></w:pPr></w:style>' +
    '<w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/><w:rPr><w:b/><w:sz w:val="30"/><w:color w:val="17324D"/></w:rPr></w:style>' +
    '<w:style w:type="table" w:styleId="TableGrid"><w:name w:val="Table Grid"/><w:tblPr><w:tblBorders><w:top w:val="single" w:sz="4" w:color="CBD5E1"/><w:left w:val="single" w:sz="4" w:color="CBD5E1"/><w:bottom w:val="single" w:sz="4" w:color="CBD5E1"/><w:right w:val="single" w:sz="4" w:color="CBD5E1"/><w:insideH w:val="single" w:sz="4" w:color="CBD5E1"/><w:insideV w:val="single" w:sz="4" w:color="CBD5E1"/></w:tblBorders></w:tblPr></w:style></w:styles>';
  const contentTypes = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
    '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
    '<Default Extension="xml" ContentType="application/xml"/>' +
    '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
    '<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>' +
    '</Types>';
  const rootRels = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>';
  const documentRels = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>';
  return createStoredZip([
    { name: '[Content_Types].xml', data: contentTypes },
    { name: '_rels/.rels', data: rootRels },
    { name: 'word/document.xml', data: documentXml },
    { name: 'word/styles.xml', data: stylesXml },
    { name: 'word/_rels/document.xml.rels', data: documentRels },
  ]);
}
