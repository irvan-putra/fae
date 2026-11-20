"use strict";
const $ = id => document.getElementById(id), cfg = Object.assign({}, window.UNGGAH_CONFIG), G = window.UnggahGit;
let files = null, snap = null, pl = null, token = null, gh;
const qs = new URLSearchParams(location.search);
/* Test hook: only a loopback API address may be substituted, and only it may receive a test token. */
if (qs.get("api") && G.isLoopback(qs.get("api"))) { cfg.API = qs.get("api"); token = qs.get("token") || null; }
gh = new G.GH(cfg.API, token);
const loop = G.isLoopback(cfg.API);
$("state").textContent = loop ? "Test mode: talking to a local mock server, not GitHub." : (cfg.REAL_WRITES && cfg.CLIENT_ID ? "Ready to sign in with GitHub." : "Compare works on public repos. Committing is switched off until the GitHub sign-in is set up, so this page cannot change any repo yet.");
function upd() { $("cmp").disabled = !(files && /^[\w.-]+\/[\w.-]+$/.test($("repo").value.trim())); }
$("repo").oninput = upd;
$("zip").onchange = async e => {
  const f = e.target.files[0]; files = null; $("res").hidden = true; if (!f) return; $("zn").textContent = " " + f.name;
  try { files = await UnggahZip.readZip(await f.arrayBuffer()); $("zn").textContent = ` ${f.name}: ${files.length} files${files.stripped ? " (top folder \"" + files.stripped + "\" removed)" : ""}`; }
  catch (err) { $("zn").textContent = " " + err.message; }
  upd();
};
function line(cls, sign, t) { const li = document.createElement("li"); li.className = cls; li.textContent = sign + " " + t; return li; }
$("cmp").onclick = async () => {
  $("cmp").disabled = true; $("res").hidden = true; $("cst").textContent = "";
  try {
    const [owner, repo] = $("repo").value.trim().split("/"), branch = $("br").value.trim() || "main";
    gh.token = token; snap = await gh.snapshot(owner, repo, branch); pl = await G.plan(snap, files, $("del").checked);
    $("sum").textContent = `${pl.add.length} added, ${pl.modify.length} changed, ${pl.remove.length} removed, ${pl.same.length} unchanged`;
    const ul = $("list"); ul.replaceChildren();
    pl.add.forEach(f => ul.append(line("a", "+", f.path))); pl.modify.forEach(f => ul.append(line("m", "~", f.path))); pl.remove.forEach(f => ul.append(line("r", "-", f.path)));
    $("rmc").hidden = !pl.remove.length; $("rmok").checked = false; $("res").hidden = false; $("commit").disabled = !(pl.add.length + pl.modify.length + pl.remove.length) || !(loop || cfg.REAL_WRITES);
    if (!$("commit").disabled || (loop || cfg.REAL_WRITES)) $("cst").textContent = ""; else $("cst").textContent = "Committing is switched off in this build.";
  } catch (err) { $("res").hidden = false; $("sum").textContent = "Could not compare: " + err.message; $("list").replaceChildren(); $("commit").disabled = true; }
  upd();
};
$("commit").onclick = async () => {
  if (pl.remove.length && !$("rmok").checked) { $("cst").textContent = "Tick the removal confirmation first, or untick the removal option and compare again."; return; }
  $("commit").disabled = true;
  try {
    const [owner, repo] = $("repo").value.trim().split("/"), branch = $("br").value.trim() || "main";
    gh.token = token; const sha = await G.commitPlan(gh, cfg, owner, repo, branch, snap, pl, $("msg").value || "Update from Unggah web", (d, t) => { $("cst").textContent = `Uploading ${d} of ${t}...`; });
    $("cst").textContent = "Committed " + sha.slice(0, 7) + ".";
  } catch (err) { $("cst").textContent = "Not committed: " + err.message; }
};
