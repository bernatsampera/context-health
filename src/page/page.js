// The page script. It only formats the embedded data (DATA) and handles clicks. src/routes.mjs owns the numbers.
(function () {
  var DATA = JSON.parse(document.getElementById('page-data').textContent);
  var MAP = DATA.map;
  var byId = {};
  MAP.nodes.forEach(function (n) { byId[n.id] = n; });
  var groupById = {};
  DATA.groups.forEach(function (g) { groupById[g.id] = g; });
  var sessionById = {};
  DATA.sessions.forEach(function (s) { sessionById[s.id] = s; });

  var esc = function (s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); };
  var plural = function (n, w, ws) { return n.toLocaleString('en-US') + ' ' + (n === 1 ? w : (ws || w + 's')); };
  var clip = function (t, n) { t = String(t || ''); return t.length > n ? t.slice(0, n - 3).trimEnd() + '...' : t; };
  var labelOf = function (id) { var n = byId[id]; return n ? n.label : String(id); };

  // ---------- state ----------
  var state = { view: 'intents', sel: null, ssel: null, filter: 'all', file: null, zoom: 1 };
  // A file picked on the map: the list shows only the intents and sessions that used it.
  // read: the item read the file. through: one of its routes went through the file to another file.
  var fileUse = function (item) {
    var read = false, through = false;
    (item.files || []).forEach(function (f) {
      if (f.path === state.file) read = true;
      else (f.routes || []).forEach(function (r) { (r.route || []).forEach(function (step) { if (step.path === state.file) through = true; }); });
    });
    return read ? 'read' : through ? 'through' : null;
  };
  var usesFile = function (item) { return !state.file || !!fileUse(item); };
  function active() {
    if (state.view === 'intents' && state.sel && groupById[state.sel]) { var g = groupById[state.sel]; return { kind: 'group', view: g, scale: g.count }; }
    if (state.view === 'sessions' && state.ssel && sessionById[state.ssel]) return { kind: 'session', view: sessionById[state.ssel], scale: 0 };
    return null;
  }

  // ---------- map ----------
  // The map shows every context file, zoomed out to fit the panel. A step column with many files wraps into
  // sub-columns, so the map keeps the shape of the panel (about ASPECT wide for 1 high) and is never a long strip.
  var W = 164, H = 22, RH = 27, TOP = 36, GAP = 46, SUB = 10, ASPECT = 1.6;
  var cols = Math.max(MAP.columns, 2);
  var colX = [];
  var colx = function (c) { return colX[c]; };
  var rows, laneNodes, laneY, laneRows, laneCols, width, height, pos;
  function layout() {
    var order = function (a, b) { return a.row - b.row; };
    var byCol = [];
    for (var c = 0; c < cols; c++) byCol[c] = MAP.nodes.filter(function (n) { return n.lane !== 'none' && n.column === c; }).sort(order);
    laneNodes = MAP.nodes.filter(function (n) { return n.lane === 'none'; }).sort(order);
    var maxN = Math.max.apply(null, byCol.map(function (l) { return l.length; }).concat([1]));
    // The fewest rows per sub-column that keep the map no wider than ASPECT.
    var R = maxN;
    for (var r = Math.min(10, maxN); r <= maxN; r++) {
      var subs = byCol.reduce(function (t, l) { return t + Math.max(1, Math.ceil(l.length / r)); }, 0);
      var w = subs * (W + SUB) + cols * (GAP - SUB);
      var lr = laneNodes.length ? Math.ceil(laneNodes.length / Math.max(subs - 1, 1)) + 1 : 0;
      if (w / ((Math.min(r, maxN) + lr) * RH + TOP) <= ASPECT) { R = r; break; }
    }
    pos = {}; rows = 0;
    var x = 8;
    for (var k = 0; k < cols; k++) {
      colX[k] = x;
      byCol[k].forEach(function (n, i) { pos[n.id] = { x: x + Math.floor(i / R) * (W + SUB), y: TOP + (i % R) * RH }; });
      rows = Math.max(rows, Math.min(byCol[k].length, R));
      x += Math.max(1, Math.ceil(byCol[k].length / R)) * (W + SUB) - SUB + GAP;
    }
    width = x - GAP + 8;
    laneCols = Math.max(1, Math.floor((width - colX[1]) / (W + SUB)));
    laneY = TOP + (rows + 0.3) * RH;
    laneNodes.forEach(function (n, i) { pos[n.id] = { x: colX[1] + (i % laneCols) * (W + SUB), y: laneY + 14 + Math.floor(i / laneCols) * RH }; });
    laneRows = Math.ceil(laneNodes.length / laneCols);
    height = laneNodes.length ? laneY + 14 + Math.max(laneRows, 2) * RH + 4 : TOP + Math.max(rows, 1) * RH + 8;
  }
  var maxU = 1, maxE = 1;
  MAP.nodes.forEach(function (n) { maxU = Math.max(maxU, n.intents); });
  MAP.edges.forEach(function (e) { maxE = Math.max(maxE, e.intents); });
  var LO = [246, 236, 226], HI = [238, 146, 86];
  var heatFill = function (v) { return 'rgb(' + LO.map(function (l, i) { return Math.round(l + (HI[i] - l) * v); }).join(',') + ')'; };
  var curve = function (a, b) {
    var x1 = a.x + W, y1 = a.y + H / 2, x2 = b.x, y2 = b.y + H / 2;
    // A parent in the same column (an import, a nested CLAUDE.md): a bow on the right side.
    if (Math.abs(a.x - b.x) < 1) { var bx = a.x + W + 28; return 'M' + x1 + ',' + y1 + ' C' + bx + ',' + y1 + ' ' + bx + ',' + y2 + ' ' + (b.x + W) + ',' + y2; }
    var mx = (x1 + x2) / 2;
    return 'M' + x1 + ',' + y1 + ' C' + mx + ',' + y1 + ' ' + mx + ',' + y2 + ' ' + x2 + ',' + y2;
  };

  function selection() {
    var a = active();
    if (!a && state.file && byId[state.file]) {
      var fn = byId[state.file], fnodes = {}, ft = {};
      fnodes[fn.id] = true; ft[fn.id] = { links: 1 };
      (fn.route || []).forEach(function (id) { fnodes[id] = true; });
      return { a: { kind: 'file' }, nodes: fnodes, targets: ft, edges: [], widthOf: function () { return 3; }, has: {} };
    }
    if (!a) return null;
    var v = a.view, nodes = {}, targets = {}, edges = {};
    v.files.forEach(function (f) {
      targets[f.path] = f.ways;
      nodes[f.path] = true;
      f.routes.forEach(function (r) { r.route.forEach(function (step) { nodes[step.path] = true; }); });
    });
    v.edges.forEach(function (e) {
      edges[e.from + '>' + e.to + '>' + e.kind] = e;
      if (e.kind === 'trigger' || e.kind === 'search') nodes[e.from] = true;
    });
    var widthOf = function (c) { return a.scale ? 1.5 + 4 * c / a.scale : 3; };
    return { a: a, nodes: nodes, targets: targets, edges: v.edges, widthOf: widthOf, has: edges };
  }

  function drawMap() {
    var sel = selection(), s = '';
    layout();
    for (var c = 0; c < cols; c++) {
      var t = c === 0 ? 'Start load' : c === 1 ? '1 step' : c + ' steps';
      s += '<text x="' + (colx(c) + 2) + '" y="18" font-size="10.5" font-weight="600" letter-spacing=".06em" fill="var(--faint)" font-family="var(--sans)">' + t.toUpperCase() + '</text>';
    }
    if (laneNodes.length) {
      s += '<line x1="' + colx(0) + '" x2="' + width + '" y1="' + laneY + '" y2="' + laneY + '" stroke="var(--line)"/>';
      s += '<text x="' + (colx(0) + 2) + '" y="' + (laneY + 30) + '" font-size="11.5" fill="var(--faint)" font-family="var(--sans)">No path from</text>';
      s += '<text x="' + (colx(0) + 2) + '" y="' + (laneY + 45) + '" font-size="11.5" fill="var(--faint)" font-family="var(--sans)">the start load</text>';
    }
    // The edges of the map: the route tree, plus links the agent took that are not on it.
    MAP.edges.forEach(function (e) {
      var A = pos[e.from], B = pos[e.to];
      if (!A || !B) return;
      var stroke = 'var(--edge)', sw = 1, op = .8, u = e.intents;
      if (u) { stroke = 'var(--edge-hot)'; sw = 1 + 3 * u / maxE; op = .35 + .5 * u / maxE; }
      if (!e.onMap && !u) return;
      if (sel) { stroke = 'var(--edge-dim)'; sw = 1; op = .5; }
      s += '<path d="' + curve(A, B) + '" fill="none" stroke="' + stroke + '" stroke-width="' + sw.toFixed(1) + '" stroke-opacity="' + op.toFixed(2) + '" stroke-linecap="round"' + (e.onMap ? '' : ' stroke-dasharray="1 3"') + '/>';
    });
    // The routes of the selection: blue links (thicker when more intents took them), dashed amber search jumps.
    if (sel) sel.edges.forEach(function (e) {
      var A = pos[e.from], B = pos[e.to];
      if (!A || !B) return;
      var w = sel.widthOf(e.count).toFixed(1);
      if (e.kind === 'search') {
        var x1 = A.x + W, y1 = A.y + H / 2, x2 = B.x, y2 = B.y + H / 2;
        var d = 'M' + x1 + ',' + y1 + ' C' + (x1 + 120) + ',' + (y1 - 70) + ' ' + (x2 - 120) + ',' + (y2 - 40) + ' ' + x2 + ',' + y2;
        s += '<path d="' + d + '" fill="none" stroke="var(--search)" stroke-width="' + w + '" stroke-dasharray="5 4" stroke-linecap="round"/>';
      } else {
        s += '<path d="' + curve(A, B) + '" fill="none" stroke="var(--hl)" stroke-width="' + w + '" stroke-opacity="' + (e.kind === 'map' ? '.45' : '1') + '"' + (e.kind === 'map' ? ' stroke-dasharray="6 3"' : '') + ' stroke-linecap="round"/>';
      }
    });
    MAP.nodes.forEach(function (n) {
      var p = pos[n.id], u = n.intents, isRoot = n.lane === 'start';
      if (!p) return;
      var fill = u ? heatFill(.12 + .88 * u / maxU) : 'var(--raise)', txt = u || isRoot ? 'var(--ink)' : 'var(--faint)', ring = '', op = 1;
      if (isRoot) { fill = u ? heatFill(.12 + .88 * u / maxU) : 'var(--panel)'; ring = 'stroke="var(--ink)" stroke-width="1.3"'; }
      else if (!u) ring = 'stroke="var(--line)" stroke-width="1"';
      if (sel) {
        op = sel.nodes[n.id] ? 1 : .28;
        var w = sel.targets[n.id];
        if (w) {
          if (w.no_path || w.unnamed || w.told_path) ring = 'stroke="var(--told)" stroke-width="2" stroke-dasharray="4 3"';
          else if ((w.search || w.weak_route) && !w.links) ring = 'stroke="var(--search)" stroke-width="2" stroke-dasharray="4 3"';
          else ring = 'stroke="var(--hl)" stroke-width="2"';
        }
      }
      s += '<g opacity="' + op + '" data-id="' + esc(n.id) + '"' + (n.abs ? ' data-abs="' + esc(n.abs) + '"' : '') + '>';
      s += '<rect x="' + p.x + '" y="' + p.y + '" width="' + W + '" height="' + H + '" rx="6" fill="' + fill + '" ' + ring + '/>';
      s += '<text x="' + (p.x + 9) + '" y="' + (p.y + 15) + '" font-size="11" font-family="' + (n.path ? 'var(--mono)' : 'var(--sans)') + '" fill="' + txt + '" font-weight="' + (isRoot ? 600 : 400) + '">' + esc(n.label) + '</text>';
      // A small copy mark on hover: a click on the box copies the full path.
      if (n.abs) s += '<g class="cp"><rect x="' + (p.x + W - 21) + '" y="' + (p.y + 4) + '" width="8" height="10" rx="2" fill="var(--panel)" stroke="var(--muted)"/><rect x="' + (p.x + W - 17) + '" y="' + (p.y + 7) + '" width="8" height="10" rx="2" fill="var(--panel)" stroke="var(--muted)"/></g>';
      s += '</g>';
    });
    var tg = document.getElementById('toggle-unused');
    if (tg) tg.hidden = true;
    var svg = document.getElementById('map');
    svg.setAttribute('viewBox', '0 0 ' + width + ' ' + height);
    // Keep the text readable: the map never shrinks below 85% of its size. A wider map scrolls sideways.
    svg.style.minWidth = '';
    applyZoom();
    svg.innerHTML = s;
  }

  // ---------- problems under the map ----------
  var times = function (c) { return c > 1 ? ' ' + c + 'x' : ''; };
  function problemLine(p) {
    var f = function (id) { return '<b title="' + esc(id) + '">' + esc(labelOf(id)) + '</b>'; };
    var w = '<span class="w">⚠</span> ';
    if (p.kind === 'search') return '<div class="p">' + w + f(p.path) + ': found by search' + times(p.count) + ' (' + (p.steps == null ? 'no path' : plural(p.steps, 'step')) + ')</div>';
    if (p.kind === 'no_path') return '<div class="p told">' + w + f(p.path) + ': no path' + times(p.count) + '</div>';
    if (p.kind === 'unnamed') return '<div class="p told">' + w + f(p.path) + ': read with nothing that named it' + times(p.count) + '</div>';
    if (p.kind === 'weak_route') return '<div class="p">' + w + f(p.path) + ': reached through ' + f(p.via) + ', ' + (p.viaHow === 'search' ? 'found by search' : 'with nothing that named it') + times(p.count) + '</div>';
    if (p.kind === 'told_path') return '<div class="p told">' + w + f(p.path) + ': path told by you' + times(p.count) + '</div>';
    return '<div class="p told">' + w + 'Told by you: "' + esc(clip(String(p.quote || p.text || '').replace(/\.$/, ''), 110)) + '"' + times(p.count) + '</div>';
  }
  function drawNote() {
    var el = document.getElementById('note'), a = active();
    if (!a && state.file && byId[state.file]) {
      var gs = DATA.groups.filter(usesFile), ss = DATA.sessions.filter(usesFile);
      var rd = gs.filter(function (g) { return fileUse(g) === 'read'; }).length;
      var fname = esc(byId[state.file].path || byId[state.file].label);
      el.innerHTML = '<div class="ok">' + (gs.length
        ? fname + ': ' + plural(rd, 'intent') + ' read it, ' + plural(gs.length - rd, 'intent') + ' went through it to another file, in ' + plural(ss.length, 'session') + '. Pick one in the list to see its route.'
        : fname + ': no analysed intent read this file or went through it.' + (byId[state.file].route && byId[state.file].route.length ? ' It is on the map because ' + esc(labelOf(byId[state.file].route[byId[state.file].route.length - 1])) + ' links it.' : '')) + '</div>';
      return;
    }
    if (!a) { el.innerHTML = DATA.groups.length ? 'Darker files are used by more intents. Pick an intent or a session to see its route.' : 'No analysed intents yet, so no routes to show.'; return; }
    if (a.kind === 'session' && !a.view.intentCount) { el.innerHTML = '<div class="ok">This session has no intents: ' + esc(a.view.reason || 'not analysed') + '.</div>'; return; }
    el.innerHTML = a.view.problems.length ? a.view.problems.map(problemLine).join('') : '<div class="ok">All files reached by links.</div>';
  }

  // ---------- tooltip ----------
  var tipEl = document.getElementById('tip');
  var mapBox = document.querySelector('.mapbox');
  var WAYT = { links: 'by links', search: 'by search', no_path: 'no path', unnamed: 'nothing named it', weak_route: 'through a search', told_path: 'path told by you' };
  mapBox.addEventListener('mousemove', function (e) {
    var gEl = e.target.closest('g[data-id]');
    if (!gEl) { tipEl.hidden = true; return; }
    var n = byId[gEl.getAttribute('data-id')], a = active();
    var h = '<b>' + esc(n.path || n.label) + '</b>';
    if (n.lane !== 'start') h += '<div>' + (n.route && n.route.length ? esc(n.route.map(labelOf).join(' > ')) + ' <span class="m">(' + plural(n.steps, 'step') + ')</span>' : 'No path from the start load') + '</div>';
    h += '<div class="m">Used by ' + plural(n.intents, 'intent') + '.' + (n.tokens != null ? ' ' + n.tokens.toLocaleString('en-US') + ' tokens.' : '') + '</div>';
    var f = a && a.view.files.filter(function (x) { return x.path === n.id; })[0];
    if (f) h += '<div>This ' + (a.kind === 'group' ? 'intent' : 'session') + ': ' + Object.keys(f.ways).filter(function (k) { return f.ways[k]; }).map(function (k) { return WAYT[k] + ' ' + f.ways[k] + 'x'; }).join(', ') + '</div>';
    if (n.abs) h += '<div class="a">' + esc(n.abs) + '</div><div class="m">Click to see the intents and sessions that used it. Click the copy mark to copy the full path.</div>';
    tipEl.innerHTML = h; tipEl.hidden = false;
    var x = Math.min(e.pageX + 14, document.documentElement.clientWidth + scrollX - tipEl.offsetWidth - 8);
    tipEl.style.left = Math.max(8, x) + 'px'; tipEl.style.top = (e.pageY + 16) + 'px';
  });
  mapBox.addEventListener('mouseleave', function () { tipEl.hidden = true; });

  // ---------- copy ----------
  var copied = document.getElementById('copied');
  function say(t) { copied.textContent = t; clearTimeout(say.t); say.t = setTimeout(function () { copied.textContent = ''; }, 2600); }
  function showToCopy(text) {
    clearTimeout(say.t);
    copied.innerHTML = 'Copy blocked. Press Cmd+C or Ctrl+C: <input type="text" readonly>';
    var input = copied.querySelector('input');
    input.value = text; input.focus(); input.select();
  }
  mapBox.addEventListener('click', function (e) {
    var gEl = e.target.closest('g[data-id]');
    if (!gEl) return;
    var abs = gEl.getAttribute('data-abs');
    if (!e.target.closest('.cp') || !abs) {
      // A click on the box picks the file (a second click clears it).
      var id = gEl.getAttribute('data-id');
      state.file = state.file === id ? null : id;
      state.sel = null; state.ssel = null;
      redraw(); return;
    }
    try {
      navigator.clipboard.writeText(abs).then(function () { say('Path copied: ' + abs); }, function () { showToCopy(abs); });
    } catch (err) { showToCopy(abs); }
  });

  // ---------- the list: intents or sessions ----------
  var FILTERS = [['all', 'All'], ['2', '2+ times'], ['weak', 'Weak links'], ['told', 'Told by user']];
  function drawChips() {
    var el = document.getElementById('chips');
    el.hidden = state.view !== 'intents';
    el.innerHTML = FILTERS.map(function (f) { return '<button type="button" data-k="' + f[0] + '" aria-pressed="' + (state.filter === f[0]) + '">' + f[1] + '</button>'; }).join('');
  }
  var sumKind = function (g, kinds) { return g.problems.filter(function (p) { return kinds.indexOf(p.kind) >= 0; }).reduce(function (a, p) { return a + p.count; }, 0); };
  function drawList() {
    document.querySelectorAll('#switch button').forEach(function (b) { b.setAttribute('aria-pressed', String(b.getAttribute('data-v') === state.view)); });
    var el = document.getElementById('list');
    var bar = selBar();
    if (state.view === 'sessions') {
      var slist = DATA.sessions.filter(function (s) { return usesFile(s) || state.ssel === s.id; });
      el.innerHTML = bar + (!DATA.sessions.length ? '<div class="empty">No sessions for this project.</div>' : !slist.length ? '<div class="empty">No analysed session read this file or went through it.</div>' : slist.map(function (s) {
        var on = state.ssel === s.id;
        var n = s.intentCount ? '<span class="n">' + plural(s.intentCount, 'intent') + '</span>' : '<span class="n off">' + esc(s.reasonShort) + '</span>';
        return '<button type="button" class="sess" data-s="' + esc(s.id) + '" aria-pressed="' + on + '" title="' + esc(s.when + ': ' + s.first) + '"><span class="d">' + esc(s.date) + '</span><span class="m">' + esc(s.first) + '</span>' + n + '</button>' +
          (on && s.groups.length ? '<div class="sub">' + s.groups.map(function (g) { return '<button type="button" data-g="' + esc(g) + '">' + esc(groupById[g] ? groupById[g].label : g) + '</button>'; }).join('') + '</div>' : '');
      }).join(''));
      if (DATA.skipped.length) {
        // The line of health.data: the total and the count for each reason, one time. Each file is in the tooltip.
        var SKIP = { headless: 'headless (every record came through the SDK)', 'no-user-message': 'no user message' };
        el.innerHTML += '<div class="empty" title="' + esc(DATA.skipped.map(function (k) { return k.folder + '/' + k.file + ': ' + (SKIP[k.reason] || k.reason); }).join('\n')) + '">' +
          esc(DATA.health.data.skippedNote) + '</div>';
      }
      return;
    }
    var list = DATA.groups.filter(function (g) { return usesFile(g) || state.sel === g.id; }).filter(function (g) { return state.filter === 'all' || (state.filter === '2' && g.count >= 2) || (state.filter === 'weak' && g.weak) || (state.filter === 'told' && g.told); });
    if (!DATA.groups.length) { el.innerHTML = bar + '<div class="empty">No analysed intents yet.</div>'; return; }
    el.innerHTML = bar + (list.length ? list.map(function (g) {
      var sc = sumKind(g, ['search', 'weak_route']), nn = sumKind(g, ['no_path', 'unnamed']);
      var tags = (sc ? '<span class="tag search">' + sc + 'x search</span>' : '') + (nn ? '<span class="tag told">' + nn + 'x no path</span>' : '') + (g.told ? '<span class="tag told">told by user</span>' : '');
      var on = state.sel === g.id;
      if (state.file && fileUse(g) === 'through') tags = '<span class="tag via">went through it</span>' + tags;
      return '<button type="button" class="intent" data-g="' + esc(g.id) + '" aria-pressed="' + on + '"><span>' + esc(g.label) + '</span><span class="n">' + g.count + 'x</span>' + (tags ? '<span class="tags">' + tags + '</span>' : '') + '</button>' +
        (on ? '<div class="sub">' + g.sessions.map(function (id) { var s = sessionById[id]; return '<button type="button" data-s="' + esc(id) + '" title="' + esc(s ? clip(s.first, 80) : id) + '">' + esc(s ? s.date : id) + '</button>'; }).join('') + '</div>' : '');
    }).join('') : '<div class="empty">' + (state.file ? 'No analysed intent read this file or went through it.' : 'No intent matches.') + '</div>');
  }
  // The bar on top of the list: what is selected, and a button that shows all again.
  function selBar() {
    if (!state.file && !state.sel && !state.ssel) return '';
    var parts = [];
    if (state.file) parts.push('File <b>' + esc(labelOf(state.file)) + '</b>');
    if (state.sel && groupById[state.sel]) parts.push('Intent <b>' + esc(clip(groupById[state.sel].label, 40)) + '</b>');
    if (state.ssel && sessionById[state.ssel]) parts.push('Session <b>' + esc(sessionById[state.ssel].date) + '</b>');
    return '<div class="selbar"><span>' + parts.join(' · ') + '</span><button type="button" class="showall">Show all</button></div>';
  }
  function redraw() { drawChips(); drawList(); drawMap(); drawNote(); }
  document.getElementById('switch').addEventListener('click', function (e) {
    var b = e.target.closest('button'); if (!b) return;
    state.view = b.getAttribute('data-v'); redraw();
  });
  document.getElementById('chips').addEventListener('click', function (e) {
    var b = e.target.closest('button'); if (!b) return;
    state.filter = b.getAttribute('data-k'); drawChips(); drawList();
  });
  document.getElementById('list').addEventListener('click', function (e) {
    if (e.target.closest('.showall')) { state.file = null; state.sel = null; state.ssel = null; redraw(); return; }
    var sub = e.target.closest('.sub button');
    if (sub) {
      // One click across: a session chip opens the session, a group chip opens the group.
      if (sub.getAttribute('data-s')) { state.view = 'sessions'; state.ssel = sub.getAttribute('data-s'); }
      else { state.view = 'intents'; state.sel = sub.getAttribute('data-g'); state.filter = 'all'; }
      redraw(); return;
    }
    var it = e.target.closest('.intent'), ss = e.target.closest('.sess');
    if (it) state.sel = state.sel === it.getAttribute('data-g') ? null : it.getAttribute('data-g');
    if (ss) state.ssel = state.ssel === ss.getAttribute('data-s') ? null : ss.getAttribute('data-s');
    if (it || ss) redraw();
  });

  // Zoom: Fit shows the whole map in the panel. + and - zoom in and out; the panel then scrolls.
  function applyZoom() {
    var svg = document.getElementById('map'), box = document.querySelector('.mapbox');
    if (state.zoom === 1) { svg.style.width = '100%'; svg.style.maxHeight = 'calc(100vh - 140px)'; box.classList.remove('zoomed'); }
    else { svg.style.maxHeight = 'none'; svg.style.width = Math.round(state.zoom * 100) + '%'; box.classList.add('zoomed'); }
    var label = document.getElementById('zoom-level'); if (label) label.textContent = state.zoom === 1 ? 'Fit' : Math.round(state.zoom * 100) + '%';
  }
  var zoomBox = document.getElementById('zoom');
  if (zoomBox) zoomBox.addEventListener('click', function (e) {
    var b = e.target.closest('button'); if (!b) return;
    var k = b.getAttribute('data-z');
    state.zoom = k === 'fit' ? 1 : k === 'in' ? Math.min(state.zoom * 1.5, 6) : Math.max(state.zoom / 1.5, 1);
    if (state.zoom < 1.05) state.zoom = 1;
    applyZoom();
  });

  // ---------- the command to add the new sessions ----------
  var rerunBtn = document.getElementById('copy-rerun');
  if (rerunBtn) rerunBtn.addEventListener('click', function () {
    var cmd = document.getElementById('rerun').textContent;
    try {
      navigator.clipboard.writeText(cmd).then(function () { say('Command copied. Paste it in a terminal.'); }, function () { showToCopy(cmd); });
    } catch (err) { showToCopy(cmd); }
  });

  // ---------- the improvement prompt ----------
  var panel = document.getElementById('prompt');
  var showBtn = document.getElementById('show-prompt');
  function setPanel(open) {
    panel.hidden = !open;
    showBtn.setAttribute('aria-expanded', String(open));
    showBtn.textContent = open ? 'Hide prompt' : 'Show prompt';
  }
  showBtn.addEventListener('click', function () { setPanel(panel.hidden); });
  function selectPanel() {
    setPanel(true);
    var r = document.createRange(); r.selectNodeContents(panel);
    var sel = window.getSelection(); sel.removeAllRanges(); sel.addRange(r);
    say('Copy blocked. The prompt is selected: press Cmd+C or Ctrl+C.');
  }
  document.getElementById('copy-prompt').addEventListener('click', function () {
    try {
      navigator.clipboard.writeText(DATA.prompt).then(function () { say('Prompt copied'); }, selectPanel);
    } catch (err) { selectPanel(); }
  });

  // ---------- the 4 questions of the score: one detail open at a time, a second click closes it ----------
  var health = document.getElementById('health');
  if (health) health.addEventListener('click', function (e) {
    var q = e.target.closest('.hq'); if (!q) return;
    var open = q.getAttribute('aria-expanded') === 'true';
    health.querySelectorAll('.hq').forEach(function (b) {
      b.setAttribute('aria-expanded', 'false');
      document.getElementById(b.getAttribute('aria-controls')).hidden = true;
    });
    if (!open) { q.setAttribute('aria-expanded', 'true'); document.getElementById(q.getAttribute('aria-controls')).hidden = false; }
  });

  redraw();
})();
