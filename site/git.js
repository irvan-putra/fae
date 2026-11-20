"use strict";
/* Git object hashing, change planning and the Git Data API commit sequence. */
const hex = b => [...new Uint8Array(b)].map(x => x.toString(16).padStart(2, "0")).join("");
async function blobSha(data) {
  const head = new TextEncoder().encode("blob " + data.length + "\0"), all = new Uint8Array(head.length + data.length);
  all.set(head); all.set(data, head.length); return hex(await crypto.subtle.digest("SHA-1", all));
}
const isLoopback = base => { try { const h = new URL(base).hostname; return h === "127.0.0.1" || h === "localhost"; } catch { return false; } };
const b64 = data => { let s = ""; for (let i = 0; i < data.length; i += 0x8000) s += String.fromCharCode.apply(null, data.subarray(i, i + 0x8000)); return btoa(s); };
class GH {
  constructor(base, token) { this.base = base.replace(/\/$/, ""); this.token = token || null; }
  async req(method, path, body) {
    const r = await fetch(this.base + path, {method, headers: Object.assign({"Accept": "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28"}, this.token ? {Authorization: "Bearer " + this.token} : {}, body ? {"Content-Type": "application/json"} : {}), body: body ? JSON.stringify(body) : undefined});
    const text = await r.text(); let j = null; try { j = text ? JSON.parse(text) : null; } catch {}
    if (!r.ok) { const e = new Error((j && j.message) || ("GitHub returned " + r.status)); e.status = r.status; throw e; }
    return j;
  }
  async snapshot(owner, repo, branch) {
    const ref = await this.req("GET", `/repos/${owner}/${repo}/git/ref/heads/${encodeURIComponent(branch)}`);
    const commit = await this.req("GET", `/repos/${owner}/${repo}/git/commits/${ref.object.sha}`);
    const tree = await this.req("GET", `/repos/${owner}/${repo}/git/trees/${commit.tree.sha}?recursive=1`);
    if (tree.truncated) throw new Error("this repository tree is too large to compare in the browser");
    return {commitSha: ref.object.sha, treeSha: commit.tree.sha, entries: tree.tree.filter(t => t.type === "blob")};
  }
}
async function plan(snapshot, files, deleteMissing) {
  const remote = new Map(snapshot.entries.map(e => [e.path, e])), out = {add: [], modify: [], same: [], remove: []}, local = new Set();
  for (const f of files) {
    f.sha = await blobSha(f.data); local.add(f.path); const r = remote.get(f.path);
    if (!r) out.add.push(f); else if (r.sha === f.sha && (r.mode === "100755") === f.exec) out.same.push(f); else out.modify.push(f);
  }
  if (deleteMissing) for (const [p, e] of remote) if (!local.has(p)) out.remove.push(e);
  return out;
}
async function commitPlan(gh, cfg, owner, repo, branch, snapshot, p, message, onProgress) {
  if (!isLoopback(gh.base) && !cfg.REAL_WRITES) throw new Error("Real writes are switched off in this build. Nothing was sent.");
  if (!gh.token) throw new Error("Not signed in.");
  const changed = [...p.add, ...p.modify];
  if (!changed.length && !p.remove.length) throw new Error("Nothing to commit.");
  const entries = []; let n = 0;
  for (const f of changed) {
    const blob = await gh.req("POST", `/repos/${owner}/${repo}/git/blobs`, {content: b64(f.data), encoding: "base64"});
    if (blob.sha !== f.sha) throw new Error("hash mismatch for " + f.path);
    entries.push({path: f.path, mode: f.exec ? "100755" : "100644", type: "blob", sha: blob.sha}); if (onProgress) onProgress(++n, changed.length);
  }
  for (const e of p.remove) entries.push({path: e.path, mode: e.mode, type: "blob", sha: null});
  const tree = await gh.req("POST", `/repos/${owner}/${repo}/git/trees`, {base_tree: snapshot.treeSha, tree: entries});
  const commit = await gh.req("POST", `/repos/${owner}/${repo}/git/commits`, {message, tree: tree.sha, parents: [snapshot.commitSha]});
  await gh.req("PATCH", `/repos/${owner}/${repo}/git/refs/heads/${encodeURIComponent(branch)}`, {sha: commit.sha, force: false});
  return commit.sha;
}
/* Device flow through the owner's relay. Unvalidated against real GitHub until an app and relay exist. */
async function deviceStart(cfg) {
  if (!cfg.CLIENT_ID || !cfg.RELAY) throw new Error("Sign-in is not set up yet (needs a GitHub App client id and a relay).");
  const r = await fetch(cfg.RELAY.replace(/\/$/, "") + "/device/code", {method: "POST", headers: {"Content-Type": "application/json"}, body: JSON.stringify({client_id: cfg.CLIENT_ID})});
  const j = await r.json(); if (!r.ok || j.error) throw new Error(j.error_description || j.error || "device code request failed"); return j;
}
async function devicePoll(cfg, dev) {
  let wait = (dev.interval || 5) * 1000; const end = Date.now() + dev.expires_in * 1000;
  while (Date.now() < end) {
    await new Promise(r => setTimeout(r, wait));
    const r = await fetch(cfg.RELAY.replace(/\/$/, "") + "/access_token", {method: "POST", headers: {"Content-Type": "application/json"}, body: JSON.stringify({client_id: cfg.CLIENT_ID, device_code: dev.device_code, grant_type: "urn:ietf:params:oauth:grant-type:device_code"})});
    const j = await r.json();
    if (j.access_token) return j.access_token;
    if (j.error === "slow_down") wait += 5000; else if (j.error && j.error !== "authorization_pending") throw new Error(j.error_description || j.error);
  }
  throw new Error("The sign-in code expired.");
}
window.UnggahGit = {blobSha, GH, plan, commitPlan, deviceStart, devicePoll, isLoopback};
