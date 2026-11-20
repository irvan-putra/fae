"use strict";
/* Minimal ZIP reader: stored and deflate entries, no dependency (uses DecompressionStream). */
const ZIP_LIMITS = {maxFiles: 5000, maxTotal: 100 * 1024 * 1024, maxFile: 25 * 1024 * 1024};
const u16 = (d, o) => d.getUint16(o, true), u32 = (d, o) => d.getUint32(o, true);
async function inflateRaw(bytes, expected) {
  const out = await new Response(new Blob([bytes]).stream().pipeThrough(new DecompressionStream("deflate-raw"))).arrayBuffer();
  if (out.byteLength !== expected) throw new Error("size mismatch while unpacking");
  return new Uint8Array(out);
}
function cleanPath(name) {
  const p = name.replace(/\\/g, "/");
  if (p.startsWith("/") || /^[a-zA-Z]:/.test(p)) throw new Error("unsafe path in zip: " + name);
  const parts = p.split("/").filter(x => x !== "" && x !== ".");
  if (parts.some(x => x === "..")) throw new Error("unsafe path in zip: " + name);
  return parts.join("/");
}
async function readZip(buf, opts = {}) {
  const bytes = new Uint8Array(buf), d = new DataView(buf);
  let eocd = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 22 - 65535); i--) if (u32(d, i) === 0x06054b50) { eocd = i; break; }
  if (eocd < 0) throw new Error("not a zip file");
  const count = u16(d, eocd + 10); let off = u32(d, eocd + 16);
  if (count > ZIP_LIMITS.maxFiles) throw new Error("too many files (limit " + ZIP_LIMITS.maxFiles + ")");
  const entries = []; let total = 0;
  for (let k = 0; k < count; k++) {
    if (u32(d, off) !== 0x02014b50) throw new Error("corrupt zip directory");
    const flags = u16(d, off + 8), method = u16(d, off + 10), csize = u32(d, off + 20), usize = u32(d, off + 24);
    const nlen = u16(d, off + 28), xlen = u16(d, off + 30), clen = u16(d, off + 32), ext = u32(d, off + 38), lho = u32(d, off + 42);
    const name = new TextDecoder().decode(bytes.subarray(off + 46, off + 46 + nlen));
    off += 46 + nlen + xlen + clen;
    if (name.endsWith("/")) continue;
    if (flags & 1) throw new Error("encrypted zip entries are not supported: " + name);
    if (usize > ZIP_LIMITS.maxFile) throw new Error("file too large (25 MB limit): " + name);
    total += usize; if (total > ZIP_LIMITS.maxTotal) throw new Error("zip too large when unpacked (100 MB limit)");
    entries.push({name, method, csize, usize, lho, mode: (ext >>> 16) & 0xFFFF});
  }
  let files = [];
  for (const e of entries) {
    if (u32(d, e.lho) !== 0x04034b50) throw new Error("corrupt zip entry: " + e.name);
    const start = e.lho + 30 + u16(d, e.lho + 26) + u16(d, e.lho + 28), raw = bytes.subarray(start, start + e.csize);
    let data; if (e.method === 0) data = raw.slice(); else if (e.method === 8) data = await inflateRaw(raw, e.usize); else throw new Error("unsupported compression in " + e.name);
    if (data.length !== e.usize) throw new Error("size mismatch: " + e.name);
    files.push({path: cleanPath(e.name), data, exec: (e.mode & 0o111) !== 0 && (e.mode & 0o170000) === 0o100000});
  }
  files = files.filter(f => f.path && !(f.path === ".git" || f.path.startsWith(".git/")) && !f.path.startsWith("__MACOSX/") && !f.path.endsWith(".DS_Store"));
  if (opts.stripTop !== false && files.length) { const top = files[0].path.split("/")[0]; if (files.every(f => f.path.startsWith(top + "/"))) { files.forEach(f => f.path = f.path.slice(top.length + 1)); files.stripped = top; } }
  const seen = new Set(); for (const f of files) { if (seen.has(f.path)) throw new Error("duplicate path in zip: " + f.path); seen.add(f.path); }
  return files;
}
window.UnggahZip = {readZip, ZIP_LIMITS};
