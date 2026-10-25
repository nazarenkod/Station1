import {violationText} from './a11y-ui.js';

const escapeHtml = (text) =>
  String(text ?? '').replace(
    /[&<>"']/g,
    (c) => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'})[c],
  );

const SEVERITY_COLOR = {error: '#F43F5E', warning: '#F59E0B', info: '#3B82F6'};

/**
 * A single HTML file with the screenshot, every issue outlined and numbered on
 * it, and the list of issues: something to attach or send without the app.
 */
export function buildHtmlReport({t, scan, reviewed, screen, device, screenshot, score}) {
  const issues = [...(reviewed?.open ?? []), ...(reviewed?.reported ?? [])];
  const width = scan?.imageWidth || 1;
  const height = scan?.imageHeight || 1;
  const pct = (value, total) => `${((value / total) * 100).toFixed(3)}%`;

  const boxes = issues
    .map((v, i) => {
      const {x, y, width: w, height: h} = v.bounds;
      return `<div class="box" style="left:${pct(x, width)};top:${pct(y, height)};width:${pct(w, width)};height:${pct(h, height)};--c:${SEVERITY_COLOR[v.severity]}"><span>${i + 1}</span></div>`;
    })
    .join('');

  const rows = issues
    .map((v, i) => {
      const {title, message, fix} = violationText(t, v);
      const filed = v.issue?.jiraKey ? `<span class="filed">${escapeHtml(v.issue.jiraKey)}</span>` : '';
      return `<li style="--c:${SEVERITY_COLOR[v.severity]}">
        <div class="num">${i + 1}</div>
        <div><div class="title">${escapeHtml(title)} ${filed}</div>
        <div class="msg">${escapeHtml(message)}</div>
        ${fix ? `<div class="fix">${escapeHtml(t('a11yHowToFix'))}: ${escapeHtml(fix)}</div>` : ''}
        <code>${escapeHtml(v.resourceId || v.className)}</code></div></li>`;
    })
    .join('');

  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(screen?.title ?? 'Accessibility report')} · Vision Inspector</title>
<style>
:root{color-scheme:light dark;--bg:#F5F5FA;--card:#fff;--text:#16161D;--muted:#6b6b80;--line:#E3E3EC}
@media (prefers-color-scheme:dark){:root{--bg:#0B0B10;--card:#13131A;--text:#ECECF3;--muted:#9a9ab0;--line:#272734}}
*{box-sizing:border-box}body{margin:0;font:14px/1.5 -apple-system,BlinkMacSystemFont,'Segoe UI',Inter,sans-serif;background:var(--bg);color:var(--text)}
header{padding:28px 32px;background:linear-gradient(135deg,#7C5CFF,#3B82F6 55%,#22D3EE);color:#fff;display:flex;gap:24px;align-items:center}
header h1{margin:0;font-size:24px;letter-spacing:-.02em}header p{margin:4px 0 0;opacity:.85}
.score{width:76px;height:76px;border-radius:50%;background:rgba(255,255,255,.18);display:grid;place-items:center;font-size:26px;font-weight:800}
main{display:grid;grid-template-columns:minmax(260px,380px) 1fr;gap:28px;padding:28px 32px;align-items:start}
@media (max-width:800px){main{grid-template-columns:1fr}}
.shot{position:relative;border-radius:18px;overflow:hidden;box-shadow:0 20px 50px rgba(0,0,0,.25);position:sticky;top:20px}
.shot img{display:block;width:100%}
.box{position:absolute;border:2px solid var(--c);border-radius:6px;background:color-mix(in srgb,var(--c) 14%,transparent)}
.box span{position:absolute;top:-10px;left:-10px;min-width:20px;height:20px;border-radius:10px;background:var(--c);color:#fff;font-size:11px;font-weight:700;display:grid;place-items:center;padding:0 4px}
ol{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:10px}
li{display:flex;gap:12px;padding:14px 16px;background:var(--card);border:1px solid var(--line);border-left:4px solid var(--c);border-radius:14px}
.num{min-width:26px;height:26px;border-radius:13px;background:var(--c);color:#fff;font-weight:700;display:grid;place-items:center;font-size:12px}
.title{font-weight:600}.msg{color:var(--muted)}.fix{margin-top:6px;font-size:13px}
code{font-size:12px;color:var(--muted)}.filed{font-size:11px;padding:1px 8px;border-radius:999px;background:#7C5CFF;color:#fff;margin-left:6px}
footer{padding:0 32px 28px;color:var(--muted);font-size:12px}
</style></head><body>
<header><div class="score">${score}</div><div><h1>${escapeHtml(screen?.title ?? t('a11yScreenUnknown'))}</h1>
<p>${escapeHtml(device?.appId ?? '')} · ${escapeHtml(t('a11yReportIssues', {count: issues.length}))} · ${new Date().toLocaleString()}</p></div></header>
<main><div class="shot">${screenshot ? `<img src="data:image/png;base64,${screenshot}" alt="">` : ''}${boxes}</div>
<ol>${rows || `<li style="--c:#22C55E"><div class="title">${escapeHtml(t('a11yAllClear'))}</div></li>`}</ol></main>
<footer>Vision Inspector</footer></body></html>`;
}
