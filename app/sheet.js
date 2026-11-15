// Reads .xlsx and .csv files into plain rows of text. No network, no external code,
// and hard limits so a strange or hostile file cannot use up memory.
const zlib = require("zlib");

const MAX_ROWS = 20000, MAX_COLS = 60, MAX_CELL = 500, MAX_SHEETS = 8, MAX_INFLATED = 60 * 1024 * 1024;

function decodeEntities(s) {
  return s.replace(/&(#x[0-9a-fA-F]+|#\d+|amp|lt|gt|quot|apos);/g, (m, e) => {
    if (e === "amp") return "&"; if (e === "lt") return "<"; if (e === "gt") return ">"; if (e === "quot") return '"'; if (e === "apos") return "'";
    const code = e[1] === "x" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
    return code > 0 && code < 0x110000 ? String.fromCodePoint(code) : "";
  });
}
const clean = (s) => String(s).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, "").slice(0, MAX_CELL);

function decodeText(buf) {
  let t = buf.toString("utf8");
  if (t.indexOf("�") !== -1) t = buf.toString("latin1");
  return t.charCodeAt(0) === 0xFEFF ? t.slice(1) : t;
}

function parseCsv(text) {
  const first = text.split(/\r?\n/, 1)[0] || "";
  const counts = { ",": 0, ";": 0, "\t": 0 };
  let q = false;
  for (const ch of first) { if (ch === '"') q = !q; else if (!q && ch in counts) counts[ch]++; }
  const delim = Object.keys(counts).sort((a, b) => counts[b] - counts[a])[0];
  const rows = []; let row = [], cell = "", inQ = false;
  const endCell = () => { row.push(clean(cell.trim())); cell = ""; };
  const endRow = () => { endCell(); if (row.some((c) => c !== "")) { if (row.length > MAX_COLS) row.length = MAX_COLS; rows.push(row); } row = []; };
  for (let i = 0; i < text.length && rows.length < MAX_ROWS; i++) {
    const ch = text[i];
    if (inQ) {
      if (ch === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else inQ = false; } else cell += ch;
    } else if (ch === '"' && cell === "") inQ = true;
    else if (ch === delim) endCell();
    else if (ch === "\n") endRow();
    else if (ch !== "\r") cell += ch;
  }
  if (cell !== "" || row.length) endRow();
  return rows;
}

function readZip(buf) {
  if (buf.length < 22) throw new Error("zip");
  let e = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65557); i--) { if (buf.readUInt32LE(i) === 0x06054b50) { e = i; break; } }
  if (e < 0) throw new Error("zip");
  const count = buf.readUInt16LE(e + 10); let p = buf.readUInt32LE(e + 16);
  const files = {};
  if (count > 2000) throw new Error("zip");
  for (let n = 0; n < count; n++) {
    if (p + 46 > buf.length || buf.readUInt32LE(p) !== 0x02014b50) throw new Error("zip");
    const method = buf.readUInt16LE(p + 10), csize = buf.readUInt32LE(p + 20), usize = buf.readUInt32LE(p + 24);
    const nl = buf.readUInt16LE(p + 28), el = buf.readUInt16LE(p + 30), cl = buf.readUInt16LE(p + 32), off = buf.readUInt32LE(p + 42);
    const name = buf.toString("utf8", p + 46, p + 46 + nl);
    files[name] = { method, csize, usize, off };
    p += 46 + nl + el + cl;
  }
  return (name) => {
    const f = files[name]; if (!f) return null;
    if (f.usize > MAX_INFLATED) throw new Error("big");
    if (f.off + 30 > buf.length || buf.readUInt32LE(f.off) !== 0x04034b50) throw new Error("zip");
    const start = f.off + 30 + buf.readUInt16LE(f.off + 26) + buf.readUInt16LE(f.off + 28);
    const raw = buf.subarray(start, start + f.csize);
    if (f.method === 0) return raw;
    if (f.method === 8) return zlib.inflateRawSync(raw, { maxOutputLength: MAX_INFLATED });
    throw new Error("zip");
  };
}

function colIndex(ref) {
  const m = /^([A-Z]+)/.exec(ref || ""); if (!m) return -1;
  let n = 0; for (const ch of m[1]) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}
const textOf = (xml) => { let out = ""; const re = /<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g; let m; while ((m = re.exec(xml))) out += m[1]; return decodeEntities(out); };

function parseXlsx(buf) {
  const get = readZip(buf);
  const wb = get("xl/workbook.xml"); if (!wb) throw new Error("zip");
  const rels = get("xl/_rels/workbook.xml.rels"), relMap = {};
  if (rels) { const re = /<Relationship\b([^>]*)>/g; let m; while ((m = re.exec(rels.toString("utf8")))) { const id = /\bId="([^"]*)"/.exec(m[1]), t = /\bTarget="([^"]*)"/.exec(m[1]); if (id && t) relMap[id[1]] = t[1]; } }
  const ss = get("xl/sharedStrings.xml"), shared = [];
  if (ss) { const x = ss.toString("utf8").replace(/<rPh[\s\S]*?<\/rPh>/g, ""); const re = /<si\b[^>]*?(?:\/>|>([\s\S]*?)<\/si>)/g; let m; while ((m = re.exec(x)) && shared.length < 500000) shared.push(textOf(m[1] || "")); }
  const sheets = []; const sre = /<sheet\b([^>]*?)\/?>/g; let sm;
  while ((sm = sre.exec(wb.toString("utf8"))) && sheets.length < MAX_SHEETS) {
    const nm = /\bname="([^"]*)"/.exec(sm[1]), rid = /\br:id="([^"]*)"/.exec(sm[1]); if (!nm || !rid) continue;
    let target = relMap[rid[1]]; if (!target) continue;
    target = target.replace(/^\//, ""); if (!/^xl\//.test(target)) target = "xl/" + target;
    const xml = get(target); if (!xml) continue;
    const rows = [], sx = xml.toString("utf8"), rowRe = /<row\b[^>]*?(?:\/>|>([\s\S]*?)<\/row>)/g; let rm;
    while ((rm = rowRe.exec(sx)) && rows.length < MAX_ROWS) {
      const cells = [], cre = /<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g; let cm, auto = 0;
      while ((cm = cre.exec(rm[1] || ""))) {
        const attrs = cm[1], inner = cm[2] || "", ref = /\br="([^"]*)"/.exec(attrs), t = /\bt="([^"]*)"/.exec(attrs);
        let ci = ref ? colIndex(ref[1]) : auto; auto = ci + 1; if (ci < 0 || ci >= MAX_COLS) continue;
        let val = "";
        const v = /<v>([\s\S]*?)<\/v>/.exec(inner);
        if (t && t[1] === "s") val = v ? shared[parseInt(v[1], 10)] || "" : "";
        else if (t && t[1] === "inlineStr") val = textOf(inner);
        else if (t && t[1] === "b") val = v && v[1] === "1" ? "TRUE" : "FALSE";
        else if (t && t[1] === "e") val = "";
        else if (v) val = decodeEntities(v[1]);
        while (cells.length < ci) cells.push("");
        cells[ci] = clean(String(val).trim());
      }
      if (cells.some((c) => c !== "")) rows.push(cells);
    }
    sheets.push({ name: decodeEntities(nm[1]).slice(0, 60), rows });
  }
  return sheets;
}


// Word documents: every table becomes a "sheet"; if there are none, lines that use tabs or semicolons are read as rows.
function parseDocx(buf) {
  const get = readZip(buf), x = get("word/document.xml"); if (!x) throw new Error("zip");
  const xml = x.toString("utf8");
  const para = (p) => { let out = "", m; const re = /<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>|<w:tab\s*\/>|<w:br\s*\/>/g; while ((m = re.exec(p))) out += m[1] !== undefined ? decodeEntities(m[1]) : (m[0].indexOf("tab") > 0 ? "\t" : "\n"); return out; };
  const paras = (s) => (s.match(/<w:p[\s>][\s\S]*?<\/w:p>/g) || []).map(para);
  const sheets = [];
  const tbls = xml.match(/<w:tbl>[\s\S]*?<\/w:tbl>/g) || [];
  tbls.slice(0, MAX_SHEETS).forEach((t, n) => {
    const rows = [];
    (t.match(/<w:tr[\s>][\s\S]*?<\/w:tr>/g) || []).slice(0, MAX_ROWS).forEach((r) => {
      const cells = (r.match(/<w:tc>[\s\S]*?<\/w:tc>/g) || []).slice(0, MAX_COLS).map((c) => clean(paras(c).map((p) => p.trim()).filter(Boolean).join(", ")));
      if (cells.some((c) => c !== "")) rows.push(cells);
    });
    if (rows.length > 1) sheets.push({ name: "Table " + (n + 1), rows });
  });
  if (!sheets.length) {
    const rows = [];
    paras(xml.replace(/<w:tbl>[\s\S]*?<\/w:tbl>/g, "")).forEach((p) => {
      if (rows.length >= MAX_ROWS) return;
      const parts = p.indexOf("\t") >= 0 ? p.split("\t") : (p.indexOf(";") >= 0 ? p.split(";") : null);
      if (parts && parts.length > 1) rows.push(parts.slice(0, MAX_COLS).map((c) => clean(c.trim())));
    });
    if (rows.length > 1) sheets.push({ name: "Text", rows });
  }
  return sheets;
}

// Returns { sheets: [{ name, rows }] } or throws an Error whose message is friendly.
function parseSheet(buf, fileName) {
  const ext = String(fileName || "").toLowerCase().replace(/^.*\./, "");
  if (buf.length > 25 * 1024 * 1024) throw new Error("That file is too large to import (over 25 MB).");
  if (buf.length >= 4 && buf.readUInt32BE(0) === 0xD0CF11E0) throw new Error("That is an older Excel file (.xls). In Excel choose Save As, then Excel Workbook (.xlsx) or CSV, and pick that file.");
  const isZip = buf.length >= 4 && buf[0] === 0x50 && buf[1] === 0x4b;
  try {
    if (isZip) {
      const isDoc = !!readZip(buf)("word/document.xml");
      const sheets = (isDoc ? parseDocx(buf) : parseXlsx(buf)).filter((s) => s.rows.length);
      if (!sheets.length && isDoc) throw new Error("nodoc");
      if (!sheets.length) throw new Error("empty");
      return { sheets };
    }
    if (ext === "xlsx" || ext === "xlsm") throw new Error("not xlsx");
    const rows = parseCsv(decodeText(buf));
    if (!rows.length) throw new Error("empty");
    return { sheets: [{ name: "Sheet", rows }] };
  } catch (e) {
    if (e && e.message === "nodoc") throw new Error("I could not find a table in that Word file. In Word, the client list needs to be in a table with one client per row, or lines separated by tabs.");
    if (e && e.message === "empty") throw new Error("That file has no rows in it.");
    throw new Error("Could not read that file. Use an Excel (.xlsx), Word (.docx) or CSV file.");
  }
}

module.exports = { parseSheet, parseCsv };
