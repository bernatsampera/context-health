// A script-free reader for the exact documents available to a benchmark run.
const esc = value => String(value).replace(/[&<>"']/g, ch => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
})[ch]);
const count = (n, word) => n + ' ' + (n === 1 ? word : word + 's');
const docIcon = '<svg aria-hidden="true" width="16" height="18" viewBox="0 0 16 18" fill="none" stroke="currentColor" stroke-linejoin="round"><path d="M3 1.5h6l4 4v11H3zM9 1.5v4h4M5.5 9h5M5.5 12h5"/></svg>';

const styles = `
  *{box-sizing:border-box}
  :root{color-scheme:light;--bg:#f6f7f3;--ink:#192820;--pine:#205747;--muted:#526058;--line:#dce2da;--paper:white;--mono:"IBM Plex Mono",ui-monospace,monospace}
  body{margin:0;background:var(--bg);color:var(--ink);font:15px/1.55 Inter,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}
  a{color:var(--pine);text-underline-offset:.2em;overflow-wrap:anywhere}
  a:focus-visible,input:focus-visible,button:focus-visible,summary:focus-visible{outline:2px solid var(--pine);outline-offset:3px}
  .frame{width:min(1080px,100%);margin:auto;padding:0 clamp(16px,4vw,48px)}
  header{background:var(--paper);border-bottom:1px solid var(--line)}
  nav{display:flex;min-height:56px;align-items:center;gap:10px;flex-wrap:wrap;padding:10px 0;font-size:13px}
  nav a{text-decoration:none}nav a:hover{text-decoration:underline}nav span{color:var(--muted)}
  main{padding-block:clamp(24px,4vw,48px) 60px}
  h1,h2,p{margin:0}h1{font-size:clamp(27px,4.8vw,42px);letter-spacing:-.045em;line-height:1.15;overflow-wrap:anywhere}
  h2{font-size:17px;letter-spacing:-.02em}.meta{margin-top:7px;color:var(--muted)}
  .columns{display:grid;grid-template-columns:minmax(210px,.8fr) minmax(0,1.5fr);gap:18px;align-items:start;margin-top:24px}
  .box,article{background:var(--paper);border:1px solid var(--line);border-radius:12px;min-width:0}
  .box{padding:18px}.box>h2,.box>form{margin-bottom:12px}
  .box p,details summary,.notice{color:var(--muted)}
  ul{list-style:none;padding:0;margin:0}li{min-width:0}
  .files li+li,.starts>li+li,.folder+.folder{border-top:1px solid var(--line)}
  .file-link{display:flex;gap:9px;align-items:baseline;text-decoration:none;padding:8px 3px;font:13px/1.5 var(--mono);overflow-wrap:anywhere}
  .file-link svg{flex:none;align-self:flex-start;margin-top:2px;color:#66776b}
  .file-link:hover span{text-decoration:underline}.file-link:hover{background:#f3f7f2}
  summary{cursor:pointer;font-size:13px;overflow-wrap:anywhere}
  .starts details{margin:0 0 10px 28px}.starts details ul,.linked ul{margin:6px 0 0 8px}
  .folder summary{padding:10px 2px;color:var(--ink);font-family:var(--mono)}
  .folder summary span{font:12px/1.5 Inter,system-ui,sans-serif;color:var(--muted);margin-left:6px}
  .folder .files{margin:0 0 8px 18px}
  label{display:block;font-size:17px;font-weight:650;letter-spacing:-.02em;margin-bottom:10px}
  .controls{display:flex;gap:8px}input,button{font:inherit;border-radius:7px;min-height:40px}
  input{min-width:0;flex:1;border:1px solid #aebeb1;padding:7px 10px;background:white;color:var(--ink)}
  button{border:1px solid var(--pine);color:white;background:var(--pine);padding:6px 15px;cursor:pointer}
  button:hover{background:#173f33}.results{display:flex;align-items:baseline;justify-content:space-between;gap:8px;font-size:13px;padding-bottom:10px;color:var(--muted)}
  article{margin-top:24px;overflow:hidden}pre{margin:0;padding:clamp(16px,3vw,32px);font:13px/1.7 var(--mono);white-space:pre-wrap;overflow-wrap:anywhere;tab-size:4}
  .linked{border-top:1px solid var(--line);padding:12px clamp(16px,3vw,32px)}
  .linked summary{color:var(--pine);font-weight:600}.notice{margin-top:10px}.back{display:inline-block;margin-bottom:14px}
  @media(max-width:650px){.columns{grid-template-columns:minmax(0,1fr);gap:12px}.box{padding:14px}input{font-size:16px}}
`;

export function savedMapPage({ item, version, snapshot, searchParams }) {
  const byPath = new Map(snapshot.files.map(file => [file.path, file]));
  const selected = searchParams.get('file');
  const file = byPath.get(selected);
  const query = (searchParams.get('q') || '').trim();
  const base = `/p/${encodeURIComponent(item.key)}/maps/${encodeURIComponent(version.id)}`;
  const dashboard = `/#/p/${encodeURIComponent(item.key)}/versions`;
  const index = base + (query ? '?' + new URLSearchParams({ q: query }) : '');
  const href = path => '?' + new URLSearchParams(query ? { file: path, q: query } : { file: path });
  const fileLink = (path, label = path) => `<a class="file-link" href="${esc(href(path))}">${docIcon}<span>${esc(label)}</span></a>`;
  const linkList = paths => '<ul class="files">' + paths.map(path => '<li>' + fileLink(path) + '</li>').join('') + '</ul>';
  const links = new Map();
  for (const { from, to } of snapshot.links) {
    if (!byPath.has(to)) continue;
    if (!links.has(from)) links.set(from, new Set());
    links.get(from).add(to);
  }
  const linked = path => {
    const targets = links.get(path);
    return targets?.size ? `<details class="linked"><summary>${count(targets.size, 'linked file')}</summary>${linkList([...targets])}</details>` : '';
  };
  let body;
  if (file) {
    body = `<a class="back" href="${esc(index)}">${query ? 'Back to search results' : 'Back to saved files'}</a>
      <h1>${esc(file.path)}</h1><article aria-label="Saved file contents"><pre>${esc(file.text)}</pre>${linked(file.path)}</article>`;
  } else {
    const paths = [...byPath.keys()].sort();
    const entries = snapshot.entries.filter(entry => byPath.has(entry));
    const matches = paths.filter(path => path.toLowerCase().includes(query.toLowerCase()));
    const folders = new Map();
    if (!query) for (const path of paths) {
      const folder = path.slice(0, path.lastIndexOf('/') + 1);
      if (!folders.has(folder)) folders.set(folder, []);
      folders.get(folder).push(path);
    }
    const groups = [...folders].map(([folder, files]) =>
      `<details class="folder"${paths.length <= 12 ? ' open' : ''}><summary>${esc(folder || 'Project root')} <span>${count(files.length, 'file')}</span></summary>
       <ul class="files">${files.map(path => '<li>' + fileLink(path, path.slice(folder.length)) + '</li>').join('')}</ul></details>`).join('');
    body = `<h1>${esc(version.name)}</h1><p class="meta">${count(paths.length, 'saved file')}</p>
      ${selected ? '<p class="notice" role="status">This version has no file at that path.</p>' : ''}
      <div class="columns"><section class="box"><h2>Starting files</h2>
      ${entries.length ? '<ul class="starts">' + entries.map(entry => '<li>' + fileLink(entry) + linked(entry) + '</li>').join('') + '</ul>' : '<p>The agent starts by searching the saved files.</p>'}</section>
      <section class="box"><form role="search" action="${esc(base)}"><label for="q">Find a saved file</label>
      <div class="controls"><input id="q" name="q" type="search" placeholder="File name or path" value="${esc(query)}"><button>Search</button></div></form>
      ${query ? `<div class="results"><span role="status">${matches.length ? count(matches.length, 'matching file') : 'No matching files'}</span><a href="${esc(base)}">Clear search</a></div>${linkList(matches)}` : groups}</section></div>`;
  }
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
    <title>${esc(file ? file.path + ' | ' : '')}${esc(version.name)} | ${esc(item.name)}</title><style>${styles}</style></head><body>
    <header><div class="frame"><nav aria-label="Breadcrumb"><a href="/#/">Projects</a><span aria-hidden="true">/</span>
    <a href="${esc(dashboard)}">${esc(item.name)}</a><span aria-hidden="true">/</span>
    ${file ? '<a href="' + esc(base) + '">' + esc(version.name) + '</a>' : '<span>Saved files</span>'}</nav></div></header>
    <div class="frame"><main>${body}</main></div></body></html>`;
}
