// The page script. It only formats the embedded data (DATA) and handles clicks. src/routes.mjs owns the numbers.
(function () {
  var DATA = JSON.parse(document.getElementById('page-data').textContent);
  var MAP = DATA.map;
  var byId = Object.create(null);
  MAP.nodes.forEach(function (n) { byId[n.id] = n; });
  var groupById = Object.create(null);
  DATA.groups.forEach(function (g) { groupById[g.id] = g; });
  var sessionById = Object.create(null);
  DATA.sessions.forEach(function (s) { sessionById[s.id] = s; });

  var esc = function (s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); };
  var plural = function (n, w, ws) { return n.toLocaleString('en-US') + ' ' + (n === 1 ? w : (ws || w + 's')); };
  var clip = function (t, n) { t = String(t || ''); return t.length > n ? t.slice(0, n - 3).trimEnd() + '...' : t; };

  // ---------- state ----------
  var state = { view: 'sessions', step: null, sel: null, ssel: null, filter: 'all', file: null, evidence: null, zoom: 1,
    openedFiles: false, exploredFolders: false };
  var SKILLS = ':skill-list';
  function active() {
    if (state.view === 'intents' && groupById[state.sel]) return { kind: 'group', view: groupById[state.sel] };
    if (state.view === 'sessions' && sessionById[state.ssel]) return { kind: 'session', view: sessionById[state.ssel] };
    return null;
  }

  // ---------- map ----------
  var mapSearch = document.getElementById('file-search');
  var evidenceSearch = document.getElementById('evidence-search');
  var mapStatus = document.getElementById('map-status');
  var activityFilters = document.getElementById('map-activity-filters');
  var openedFilesButton = document.getElementById('opened-files');
  var exploredFoldersButton = document.getElementById('explored-folders');
  var coverageStatus = document.getElementById('folder-map-coverage');
  var mapBox = document.querySelector('.mapbox');
  var tipEl = document.getElementById('tip');
  var mapArea = function () { return { w: mapBox.clientWidth }; };
  var folderPaths = new Set(['.']);
  var storedFiles = new Set(MAP.nodes.map(function (n) { return n.id; }));
  var isFolder = function (id) { return typeof id === 'string' && id.startsWith('folder:'); };
  var folderId = function (path) { return 'folder:' + path; };
  var parentPath = function (path) { var slash = path.lastIndexOf('/'); return slash > 0 ? path.slice(0, slash) : '.'; };
  var inFolder = function (path, folder) { return folder === '.' || path === folder || path.startsWith(folder + '/'); };
  function addFolders(path) {
    for (var folder = path; !folderPaths.has(folder); folder = parentPath(folder)) folderPaths.add(folder);
  }
  MAP.nodes.forEach(function (node) { addFolders(parentPath(node.path || node.id)); });

  var exploredBySession = new Map();
  DATA.sessions.forEach(function (session) {
    var exploration = session.exploration;
    var opened = new Set(exploration ? exploration.opened : []);
    var lookups = exploration ? exploration.lookups : [];
    var scopes = new Map();
    var exploredFolders = new Set();
    var targets = new Map();
    var results = new Map();
    var historical = new Set(opened);
    lookups.forEach(function (lookup) {
      var scope = lookup.folder || lookup.target;
      if (scope === lookup.target && lookup.outcome !== 'failed' && (lookup.operation === 'list' || lookup.operation === 'search')) {
        exploredFolders.add(scope);
      }
      if (!scopes.has(scope)) scopes.set(scope, []);
      scopes.get(scope).push(lookup);
      if (!targets.has(lookup.target)) targets.set(lookup.target, []);
      targets.get(lookup.target).push(lookup);
      lookup.resultPaths.forEach(function (path) {
        if (!results.has(path)) results.set(path, []);
        results.get(path).push(lookup);
        if (!folderPaths.has(path)) historical.add(path);
      });
    });
    for (var path of historical) {
      if (byId[path]) continue;
      byId[path] = { id: path, path: path, label: path, legacy: true };
    }
    exploredBySession.set(session.id, { opened: opened, exploredFolders: exploredFolders, lookups: lookups, scopes: scopes, targets: targets, results: results, historical: historical, coverage: exploration?.coverage });
  });

  function fileUse(item) {
    if (!state.file) return null;
    if (isFolder(state.file)) {
      var folder = state.file.slice(7);
      var recorded = exploredBySession.get(item.id);
      if (recorded && (Array.from(recorded.scopes.keys()).some(function (path) { return inFolder(path, folder); }) ||
        Array.from(recorded.results.keys()).some(function (path) { return inFolder(path, folder); }) ||
        Array.from(recorded.opened).some(function (path) { return inFolder(path, folder); }))) return 'observed';
      return item.files.some(function (file) { return inFolder(file.path, folder); }) ? 'read' : null;
    }
    var exploration = exploredBySession.get(item.id);
    var path = byId[state.file]?.path || state.file;
    if (exploration?.opened.has(path)) return 'read';
    if (exploration?.results.has(path) || exploration?.targets.has(path)) return 'observed';
    var by = byId[state.file]?.usedBy;
    if (!by || (!by.sessions.includes(item.id) && !by.groups.includes(item.id))) return null;
    return item.files.some(function (file) { return file.path === state.file; }) ? 'read' : 'through';
  }
  var usesFile = function (item) { return !state.file || !!fileUse(item); };
  function noUse(what) {
    return 'No ' + what + 's with activity here.';
  }

  function filterActivity(exploration) {
    if (state.view !== 'sessions' || (!state.openedFiles && !state.exploredFolders)) return null;
    var files = new Set(), folders = new Set();
    function collect(recorded) {
      if (state.openedFiles) recorded.opened.forEach(function (path) { files.add(path); });
      if (state.exploredFolders) recorded.exploredFolders.forEach(function (path) { folders.add(path); });
    }
    if (exploration) collect(exploration);
    else if (state.evidence) state.evidence.forEach(function (id) { collect(exploredBySession.get(id)); });
    else exploredBySession.forEach(collect);
    return { files: files, folders: folders };
  }

  function mapContext() {
    var a = active();
    var exploration = a?.kind === 'session' ? exploredBySession.get(a.view.id) : null;
    var used = new Set();
    if (a?.kind === 'group' || (a?.kind === 'session' && (!exploration?.coverage || exploration.coverage === 'unavailable'))) {
      a.view.files.forEach(function (file) { used.add(file.path); });
    }
    if (!a && state.evidence) state.evidence.forEach(function (id) {
      exploredBySession.get(id)?.opened.forEach(function (path) { used.add(path); });
    });
    var filtered = filterActivity(exploration);
    var folders = new Set(filtered ? filtered.folders : folderPaths);
    function include(path) {
      for (var folder = path; !folders.has(folder); folder = parentPath(folder)) folders.add(folder);
    }
    if (exploration && !filtered) {
      exploration.scopes.forEach(function (_, path) { include(storedFiles.has(path) || exploration.historical.has(path) ? parentPath(path) : path); });
    }
    var ids = filtered ? filtered.files : new Set(storedFiles);
    if (filtered) {
      // A containing folder still provides the path for its opened files.
      ids.forEach(function (path) { folders.add(parentPath(path)); });
    } else {
      exploration?.historical.forEach(function (path) { ids.add(path); });
      used.forEach(function (path) { if (byId[path]) ids.add(path); });
      if (state.file && !isFolder(state.file) && byId[state.file]) ids.add(state.file);
      ids.forEach(function (id) { include(parentPath(byId[id].path || id)); });
      if (isFolder(state.file)) include(state.file.slice(7));
    }
    var buckets = new Map();
    Array.from(folders).sort(function (a, b) { return a === '.' ? -1 : b === '.' ? 1 : a.localeCompare(b); }).forEach(function (path) {
      buckets.set(path, { id: folderId(path), path: path, label: path === '.' ? 'Project root' : path + '/', files: [], kind: 'folder' });
    });
    ids.forEach(function (id) {
      var node = byId[id];
      var path = node.path || id;
      var bucket = buckets.get(parentPath(path));
      if (bucket) bucket.files.push({ id: id, path: path, abs: node.abs, label: node.path ? path.slice(path.lastIndexOf('/') + 1) : node.label, kind: 'file', legacy: node.legacy });
    });
    return { buckets: buckets, exploration: exploration, filtered: filtered, used: used, scoped: Boolean(a || state.evidence || filtered) };
  }

  function describeActivity(node, context) {
    var exploration = context.exploration;
    if (context.filtered && node.kind === 'folder' && !context.filtered.folders.has(node.path)) {
      return { status: '', label: '', empty: 0 };
    }
    if (context.filtered && !exploration) {
      return node.kind === 'file' ? { status: 'opened', label: 'Opened', empty: 0 } : { status: 'explored', label: 'Explored', empty: 0 };
    }
    var actions = node.kind === 'folder' ? exploration?.scopes.get(node.path) || [] : [];
    var results = exploration?.results.get(node.path) || [];
    var empty = actions.reduce(function (total, lookup) {
      return total + (lookup.operation === 'search' && lookup.outcome === 'empty' ? (lookup.count || 1) : 0);
    }, 0);
    var status = [];
    if (node.kind === 'folder') {
      var direct = actions.filter(function (lookup) { return lookup.target === node.path && lookup.outcome !== 'failed'; });
      if (direct.some(function (lookup) { return lookup.operation === 'list'; })) status.push('listed');
      if (direct.some(function (lookup) { return lookup.operation === 'search'; })) status.push('searched');
      if (direct.some(function (lookup) { return lookup.operation === 'unknown'; })) status.push('lookup');
      if (!status.length && actions.some(function (lookup) { return lookup.target !== node.path && lookup.outcome !== 'failed'; })) status.push('file lookup');
      if (actions.some(function (lookup) { return lookup.outcome === 'failed'; })) status.push('lookup failed');
      if (!status.length && results.length) status.push('seen in results');
    } else if (exploration?.opened.has(node.path)) status.push('opened');
    else if (results.some(function (lookup) { return lookup.operation === 'search'; })) status.push('matched');
    else if (results.some(function (lookup) { return lookup.operation === 'list'; })) status.push('listed');
    else if (results.length) status.push('seen');
    else if (context.used.has(node.id)) status.push('used');
    var label = status.map(function (item) { return item.charAt(0).toUpperCase() + item.slice(1); }).join(', ');
    return { status: status.join(','), label: label, empty: empty };
  }

  var matches = [];
  var visibleItems = new Map();
  var width = 1;
  var full = false;
  var CARD = 246, GAP = 16, PAD = 10, HEAD = 48, ROW = 34;
  function layoutMap(context, query) {
    var buckets = Array.from(context.buckets.values());
    var placed = new Map();
    matches = [];
    buckets = buckets.map(function (folder) {
      var files = folder.files.sort(function (a, b) { return a.label.localeCompare(b.label); });
      if (query) {
        var folderMatch = folder.label.toLowerCase().includes(query) || folder.path.toLowerCase().includes(query);
        if (folderMatch) matches.push(folder);
        files = files.filter(function (file) {
          var match = [file.label, file.path, file.abs].some(function (name) { return name && name.toLowerCase().includes(query); });
          if (match) matches.push(file);
          return folderMatch || match;
        });
        if (!folderMatch && !files.length) return null;
      }
      return { ...folder, files: files };
    }).filter(Boolean);
    var available = mapArea().w || CARD + GAP * 2;
    var columns = Math.max(1, Math.min(buckets.length, Math.floor((available - GAP) / (CARD + GAP))));
    width = columns * (CARD + GAP) + GAP;
    var y = GAP, rowHeight = 0;
    buckets.forEach(function (folder, i) {
      var col = i % columns;
      if (i && col === 0) { y += rowHeight + GAP; rowHeight = 0; }
      var x = GAP + col * (CARD + GAP);
      var height = HEAD + folder.files.length * ROW + (folder.files.length ? PAD : 0);
      rowHeight = Math.max(rowHeight, height);
      folder.box = { x: x, y: y, w: CARD, h: height };
      placed.set(folder.id, { ...folder, x: x + PAD, y: y + 2, w: CARD - 2 * PAD, h: HEAD - 5 });
      folder.files.forEach(function (file, k) {
        placed.set(file.id, { ...file, x: x + PAD, y: y + HEAD + k * ROW, w: CARD - 2 * PAD, h: ROW - 4 });
      });
    });
    return { buckets: buckets, placed: placed, height: y + rowHeight + GAP };
  }

  function connections(context, placed) {
    if (!state.file) return [];
    var edges = [], seen = new Set();
    function add(from, to, kind) {
      var key = JSON.stringify([from, to, kind]);
      if (from === to || !placed.has(from) || !placed.has(to) || seen.has(key)) return;
      seen.add(key);
      edges.push({ from: from, to: to, kind: kind });
    }
    if (!isFolder(state.file)) (MAP.references || []).forEach(function (reference) {
      if (reference.from === state.file || reference.to === state.file) add(reference.from, reference.to, 'reference');
    });
    context.exploration?.lookups.forEach(function (lookup) {
      var scope = lookup.folder || lookup.target;
      var folder = folderId(scope);
      var from = lookup.target !== scope && byId[lookup.target] ? lookup.target : folder;
      lookup.resultPaths.forEach(function (path) {
        var to = context.buckets.has(path) ? folderId(path) : path;
        if (from === state.file || to === state.file || folder === state.file) add(from, to, 'lookup');
      });
    });
    return edges;
  }

  function edgeSvg(edge, placed) {
    var a = placed.get(edge.from), b = placed.get(edge.to);
    var apart = Math.abs(a.x - b.x) > a.w;
    var right = a.x < b.x;
    var x1 = apart ? a.x + (right ? a.w : 0) : a.x + a.w - PAD;
    var x2 = apart ? b.x + (right ? -3 : b.w + 3) : b.x + b.w + 1;
    var y1 = a.y + a.h / 2, y2 = b.y + b.h / 2;
    var bend = apart ? (x1 + x2) / 2 : a.x + a.w + 14;
    var d = 'M' + x1 + ',' + y1 + ' C' + bend + ',' + y1 + ' ' + bend + ',' + y2 + ' ' + x2 + ',' + y2;
    return '<path class="' + edge.kind + '-line" data-from="' + esc(edge.from) + '" data-to="' + esc(edge.to) + '" d="' + d + '" marker-end="url(#' + edge.kind + '-arrow)"/>';
  }

  function itemSvg(node, activity) {
    var folder = node.kind === 'folder';
    var selected = state.file === node.id;
    var label = clip(node.label, folder ? 31 : node.abs ? 27 : 30);
    var detail = [activity.label, activity.empty ? plural(activity.empty, 'empty search', 'empty searches') : '', node.legacy ? 'Outside this map' : ''].filter(Boolean).join(' · ');
    var attrs = ' data-kind="' + node.kind + '" data-activity="' + activity.status + '"' + (activity.empty ? ' data-empty-searches="' + activity.empty + '"' : '');
    var y = node.y + (folder && !detail ? 23 : detail ? 12 : 19);
    var icon = folder ? 'M0 4h5l2 2h7v8H0z' : 'M1 1h8l4 4v9H1zM9 1v5h4';
    var s = '<g role="button" tabindex="0" aria-pressed="' + selected + '" aria-label="' + esc([node.label === 'Project root' ? node.label : node.path, detail].filter(Boolean).join(', ')) +
      '" data-id="' + esc(node.id) + '"' + attrs + (node.abs ? ' data-abs="' + esc(node.abs) + '"' : '') + '>';
    s += '<rect class="map-item" x="' + node.x + '" y="' + node.y + '" width="' + node.w + '" height="' + node.h + '" rx="5"/>';
    s += '<path class="map-icon" d="' + icon + '" transform="translate(' + (node.x + 8) + ' ' + (y - 11) + ')"/>';
    s += '<text class="map-name" x="' + (node.x + 27) + '" y="' + y + '">' + esc(label) + '</text>';
    if (detail) s += '<text class="map-activity" x="' + (node.x + 27) + '" y="' + (y + 13) + '">' + esc(detail) + '</text>';
    if (node.abs) {
      var x = node.x + node.w - 21, copyY = node.y + 7;
      s += '<g class="cp"><rect x="' + (x - 4) + '" y="' + (copyY - 4) + '" width="22" height="24" fill="transparent"/><path d="M' + x + ',' + (copyY + 9) + 'v-9h8m-4,4h8v10h-8z"/></g>';
    }
    return s + '</g>';
  }

  function drawMap() {
    var svg = document.getElementById('map');
    var focused = svg.contains(document.activeElement) ? document.activeElement.getAttribute('data-id') : null;
    var query = mapSearch.value.trim().toLowerCase();
    var context = mapContext(), layout = layoutMap(context, query);
    activityFilters.hidden = state.view !== 'sessions' || !DATA.sessions.length;
    openedFilesButton.setAttribute('aria-pressed', String(state.openedFiles));
    exploredFoldersButton.setAttribute('aria-pressed', String(state.exploredFolders));
    if (state.file && context.filtered) {
      var stillVisible = isFolder(state.file) ? context.buckets.has(state.file.slice(7)) : context.filtered.files.has(state.file);
      if (!stillVisible) state.file = null;
    }
    visibleItems = layout.placed;
    var shown = layout.buckets.length && (!query || matches.length);
    svg.style.display = shown ? '' : 'none';
    mapStatus.textContent = query ? (matches.length ? plural(matches.length, 'match', 'matches') : 'No matching files or folders') : '';
    if (!query && !shown && context.filtered) {
      mapStatus.textContent = state.openedFiles && state.exploredFolders ? 'No file opens or folder visits recorded.'
        : state.openedFiles ? 'No file opens recorded.' : 'No folder listings or searches recorded.';
    }
    if (!shown) { svg.innerHTML = ''; return; }
    var s = '<defs><marker id="lookup-arrow" markerWidth="6" markerHeight="6" refX="5" refY="3" orient="auto"><path d="M0 0l6 3-6 3z"/></marker><marker id="reference-arrow" markerWidth="6" markerHeight="6" refX="5" refY="3" orient="auto"><path d="M0 0l6 3-6 3z"/></marker></defs>';
    layout.buckets.forEach(function (folder) {
      var box = folder.box, activity = describeActivity(folder, context);
      s += '<rect class="map-folder" data-explored="' + Boolean(activity.status || activity.empty) + '" data-seen="' + (activity.status === 'seen in results') + '" x="' + box.x + '" y="' + box.y + '" width="' + box.w + '" height="' + box.h + '" rx="10"/>';
    });
    visibleItems.forEach(function (node) { s += itemSvg(node, describeActivity(node, context)); });
    s += '<g class="map-edges" aria-hidden="true">' + connections(context, visibleItems).map(function (edge) { return edgeSvg(edge, visibleItems); }).join('') + '</g>';
    svg.setAttribute('class', context.scoped ? 'map-scoped' : '');
    svg.setAttribute('viewBox', '0 0 ' + width + ' ' + layout.height);
    svg.innerHTML = s;
    applyZoom();
    if (focused) focusFile(focused);
  }

  function focusFile(id) {
    var node = Array.from(document.querySelectorAll('#map g[data-id]')).find(function (g) {
      return g.getAttribute('data-id') === id;
    });
    if (node) node.focus();
    else mapSearch.focus();
  }

  // ---------- selected item ----------
  function lookupDetails(lookups) {
    var scopes = new Map();
    lookups.forEach(function (lookup) {
      var path = lookup.target === '.' ? 'Project root' : lookup.target;
      if (!scopes.has(path)) scopes.set(path, new Set());
      if (lookup.query) scopes.get(path).add(lookup.query);
    });
    if (!scopes.size) return '';
    var details = Array.from(scopes, function (entry) {
      var terms = Array.from(entry[1], function (term) { return '<li><code>' + esc(term) + '</code></li>'; });
      return '<li><b>' + esc(entry[0]) + '</b>' + (terms.length ? '<ul>' + terms.join('') + '</ul>' : '') + '</li>';
    });
    return '<details class="map-lookup-detail"><summary>Lookup scope and search terms</summary><ul>' + details.join('') + '</ul></details>';
  }

  function drawNote() {
    var el = document.getElementById('note'), a = active();
    var context = mapContext();
    var coverage = context.exploration?.coverage;
    var coverageText = coverage === 'reads-only' ? 'This session recorded file opens only.'
      : coverage === 'partial' ? 'Some lookups have incomplete records.'
      : coverage === 'unavailable' || (a?.kind === 'session' && !coverage) ? 'Lookup details are unavailable for this session.' : '';
    if (coverageStatus) {
      coverageStatus.textContent = coverageText;
      coverageStatus.hidden = !coverageText;
    }
    var selection = visibleItems.get(state.file);
    el.hidden = !selection && Boolean(coverageStatus || !coverageText);
    if (!selection) { el.textContent = coverageStatus ? '' : coverageText; return; }
    var detail = describeActivity(selection, context);
    var refs = MAP.references || [];
    var from = refs.filter(function (edge) { return edge.to === selection.id; }).map(function (edge) { return edge.from; });
    var to = refs.filter(function (edge) { return edge.from === selection.id; }).map(function (edge) { return edge.to; });
    var direct = selection.kind === 'folder' ? context.exploration?.scopes.get(selection.path) : context.exploration?.targets.get(selection.path);
    var lookups = (direct || []).concat(context.exploration?.results.get(selection.path) || []);
    el.innerHTML = '<div class="map-selection"><b>' + esc(selection.path === '.' ? selection.label : selection.path) + '</b>' +
      (detail.label ? '<span>' + esc(detail.label) + '</span>' : '') +
      (detail.empty ? '<span>' + plural(detail.empty, 'empty search', 'empty searches') + '</span>' : '') +
      (selection.legacy ? '<span>Outside this map</span>' : '') +
      (selection.abs ? '<button type="button" class="keybtn" data-copy-path>Copy path</button>' : '') + '</div>' +
      (to.length ? '<div>References ' + esc(to.join(', ')) + '</div>' : '') +
      (from.length ? '<div>Referenced by ' + esc(from.join(', ')) + '</div>' : '') +
      lookupDetails(lookups);
  }

  // ---------- tooltip ----------
  mapBox.addEventListener('mousemove', function (e) {
    var gEl = e.target.closest('g[data-id]');
    var node = gEl && visibleItems.get(gEl.getAttribute('data-id'));
    if (!node || node.path === '.') { tipEl.hidden = true; return; }
    tipEl.textContent = node.abs || node.path;
    tipEl.hidden = false;
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
  function selectFile(id) {
    state.file = state.file === id ? null : id;
    tipEl.hidden = true;
    if (!active()) {
      evidenceSearch.value = '';
      state.evidence = null;
    }
    redraw();
    focusFile(id);
  }
  mapBox.addEventListener('click', function (e) {
    var gEl = e.target.closest('g[data-id]');
    if (!gEl) return;
    var abs = gEl.getAttribute('data-abs');
    if (!e.target.closest('.cp') || !abs) {
      selectFile(gEl.getAttribute('data-id'));
      return;
    }
    try {
      navigator.clipboard.writeText(abs).then(function () { say('Path copied: ' + abs); }, function () { showToCopy(abs); });
    } catch (err) { showToCopy(abs); }
  });
  mapBox.addEventListener('keydown', function (e) {
    var node = e.target.closest('#map g[data-id]');
    if (!node || (e.key !== 'Enter' && e.key !== ' ')) return;
    e.preventDefault();
    selectFile(node.getAttribute('data-id'));
  });
  mapSearch.addEventListener('input', function () { drawMap(); drawNote(); });
  activityFilters.addEventListener('click', function (event) {
    var button = event.target.closest('button');
    if (!button) return;
    if (button === openedFilesButton) state.openedFiles = !state.openedFiles;
    if (button === exploredFoldersButton) state.exploredFolders = !state.exploredFolders;
    mapBox.scrollTop = 0;
    redraw();
  });
  mapSearch.addEventListener('keydown', function (e) {
    if (e.key === 'Enter' && matches.length) {
      e.preventDefault();
      selectFile(matches[0].id);
    }
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
    var status = document.getElementById('evidence-status');
    status.textContent = '';
    if (DATA.version && !DATA.version.evidence) {
      evidenceSearch.hidden = true;
      el.innerHTML = '<div class="empty">Detailed session evidence is unavailable for this version.</div>';
      return;
    }
    var bar = selBar();
    evidenceSearch.hidden = state.view !== 'sessions' || Boolean(sessionById[state.ssel]);
    var query = state.view === 'sessions' ? evidenceSearch.value.trim().toLowerCase() : '';
    if (state.view === 'sessions') {
      var slist = DATA.sessions.filter(function (s) {
        return (state.evidence ? state.evidence.has(s.id) : usesFile(s)) &&
          (!query || [s.title, span(s)].join(' ').toLowerCase().includes(query));
      });
      if (sessionById[state.ssel]) { el.innerHTML = overview(sessionById[state.ssel]); return; }
      if (query) status.textContent = plural(slist.length, 'matching session');
      el.innerHTML = bar + (!DATA.sessions.length ? '<div class="empty">No sessions for this project.</div>' : !slist.length ? '<div class="empty">' + (query ? 'No matching sessions.' : esc(noUse('session'))) + '</div>' : slist.map(function (s) {
        var n = s.intentCount ? '<span class="n">' + plural(s.intentCount, 'intent') + '</span>' : '<span class="n off">' + esc(s.reasonShort) + '</span>';
        return '<button type="button" class="sess" data-s="' + esc(s.id) + '" title="' + esc(s.first) + '"><span class="m">' + esc(s.title) + '</span><span class="d">' + esc(span(s)) + '</span>' + n + '</button>';
      }).join(''));
      if (!query && !state.evidence && !state.file && DATA.skipped.length) {
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
      if (state.file && fileUse(g) === 'through') tags = '<span class="tag via">' + (state.file === SKILLS ? 'loaded a skill' : 'went through it') + '</span>' + tags;
      return '<button type="button" class="intent" data-g="' + esc(g.id) + '" aria-pressed="' + on + '"><span>' + esc(g.label) + '</span><span class="n">' + g.count + 'x</span>' + (tags ? '<span class="tags">' + tags + '</span>' : '') + '</button>' +
        (on ? '<div class="sub">' + g.sessions.map(function (id) { var s = sessionById[id]; return '<button type="button" data-s="' + esc(id) + '" title="' + esc(s ? clip(s.first, 80) : id) + '">' + esc(s ? s.date : id) + '</button>'; }).join('') + '</div>' : '');
    }).join('') : '<div class="empty">' + (!query && state.file && state.filter === 'all' ? esc(noUse('intent')) : 'No matching intents.') + '</div>');
  }
  // ---------- one session: what was asked, what was done ----------
  // Local time: the person looks for the hour that they worked.
  var dayOf = function (d) { return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }); };
  var hourOf = function (d) { return d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }); };
  function span(s) {
    if (!s.start) return s.date;
    var a = new Date(s.start), b = new Date(s.end || s.start);
    return dayOf(a) + ', ' + hourOf(a) + (dayOf(a) !== dayOf(b) ? ' to ' + dayOf(b) + ', ' + hourOf(b) : hourOf(a) !== hourOf(b) ? ' to ' + hourOf(b) : '');
  }
  var FILES = 6;
  function overview(s) {
    var steps = s.steps.map(function (p, k) {
      var open = state.step === k, g = p.group && groupById[p.group];
      return '<li class="step' + (open ? ' open' : '') + '"><button type="button" data-step="' + k + '" aria-expanded="' + open + '"><b>' + esc(p.goal) + '</b>' + (p.did ? '<span class="did">' + esc(p.did) + '</span>' : '') + '</button>' +
        (open ? (p.you ? '<p class="you"><em>You wrote</em>' + esc(p.you) + '</p>' : '') + (g ? '<button type="button" class="same" data-g="' + esc(g.id) + '">' + (g.count > 1 ? 'See all ' + g.count + ' like this' : 'See the files it used') + '</button>' : '') : '') + '</li>';
    }).join('');
    var files = s.edited.slice(0, FILES).map(function (f) { return '<li title="' + esc(f) + '"><bdi>' + esc(f) + '</bdi></li>'; }).join('');
    var backLabel = state.evidence ? 'Back to evidence' : state.file ? 'Back to sessions' : 'All sessions';
    return '<div class="over"><button type="button" class="showall back">' + backLabel + '</button>' +
      '<h2>' + esc(s.title) + '</h2><p class="when">' + esc(span(s)) + '<br>' + plural(s.asked, 'message') + ' from you</p>' +
      (steps ? '<ol class="steps">' + steps + '</ol>' : '') +
      (files ? '<h3>Files changed</h3><ul class="changed">' + files + (s.edited.length > FILES ? '<li class="more" title="' + esc(s.edited.slice(FILES).join('\n')) + '">and ' + (s.edited.length - FILES) + ' more</li>' : '') + '</ul>' : '') + '</div>';
  }
  // The bar on top of the list: what is selected, and a button that shows all again.
  function selBar() {
    var group = state.view === 'intents' && state.sel;
    if (!state.file && !group && !state.evidence) return '';
    var parts = [];
    if (state.evidence && state.view === 'sessions') parts.push(plural(state.evidence.size, 'session') + ' from this finding');
    if (isFolder(state.file)) parts.push('Folder <b>' + esc(state.file === folderId('.') ? 'Project root' : state.file.slice(7)) + '</b>');
    else if (state.file) parts.push('File <b>' + esc(byId[state.file]?.path || byId[state.file]?.label || state.file) + '</b>');
    if (group && groupById[state.sel]) parts.push('Intent <b>' + esc(clip(groupById[state.sel].label, 40)) + '</b>');
    return '<div class="selbar"><span>' + parts.join(' · ') + '</span><button type="button" class="showall">Show all</button></div>';
  }
  function focusSession(id) {
    var row = Array.from(document.querySelectorAll('#list .sess')).find(function (item) { return item.getAttribute('data-s') === id; });
    (row || document.querySelector('#switch [data-v="sessions"]')).focus();
  }
  function openSession(id) {
    state.view = 'sessions'; state.ssel = id; state.step = null;
    mapSearch.value = '';
    redraw();
    if (mapBox.clientHeight && mapBox.scrollHeight > mapBox.clientHeight) {
      var exploration = exploredBySession.get(id);
      var firstLookup = exploration.lookups.find(function (lookup) { return lookup.outcome !== 'failed'; }) || exploration.lookups[0];
      var item = (firstLookup && visibleItems.get(folderId(firstLookup.folder || firstLookup.target))) ||
        visibleItems.get(exploration.opened.values().next().value);
      var svg = document.getElementById('map');
      if (item) mapBox.scrollTop = Math.max(0, item.y * svg.getBoundingClientRect().width / width - GAP);
    }
    document.getElementById('list').scrollTop = 0;
    document.querySelector('#list .back').focus();
  }
  function showEvidence(button) {
    var ids = JSON.parse(button.getAttribute('data-finding-sessions')).filter(function (id) { return sessionById[id]; });
    var file = button.getAttribute('data-finding-file');
    state.file = byId[file] ? file : null;
    state.view = 'sessions'; state.sel = null; state.ssel = null; state.step = null;
    state.evidence = ids.length ? new Set(ids) : null;
    mapSearch.value = '';
    evidenceSearch.value = '';
    redraw();
    if (ids.length) focusSession(ids[0]);
    else mapSearch.focus();
  }
  function redraw() { drawMap(); drawChips(); drawList(); drawNote(); }
  evidenceSearch.addEventListener('input', drawList);
  document.getElementById('switch').addEventListener('click', function (e) {
    var b = e.target.closest('button'); if (!b) return;
    if (state.view !== b.getAttribute('data-v')) evidenceSearch.value = '';
    state.view = b.getAttribute('data-v');
    state.evidence = null;
    redraw();
  });
  document.getElementById('chips').addEventListener('click', function (e) {
    var b = e.target.closest('button'); if (!b) return;
    state.filter = b.getAttribute('data-k'); drawChips(); drawList();
    document.querySelector('#chips [aria-pressed="true"]').focus();
  });
  document.getElementById('list').addEventListener('click', function (e) {
    if (e.target.closest('.back')) {
      var previous = state.ssel;
      state.ssel = null; state.step = null;
      redraw(); focusSession(previous); return;
    }
    if (e.target.closest('.showall')) {
      state.file = null; state.sel = null; state.ssel = null; state.evidence = null;
      redraw();
      document.querySelector('#switch [aria-pressed="true"]').focus();
      return;
    }
    var step = e.target.closest('[data-step]');
    if (step) {
      var k = Number(step.getAttribute('data-step'));
      state.step = state.step === k ? null : k;
      drawList();
      var same = document.querySelector('#list [data-step="' + k + '"]'); if (same) same.focus();
      return;
    }
    var session = e.target.closest('button[data-s]');
    if (session) { openSession(session.getAttribute('data-s')); return; }
    var intent = e.target.closest('button[data-g]');
    if (intent) {
      var id = intent.getAttribute('data-g');
      state.view = 'intents';
      if (intent.classList.contains('same')) {
        evidenceSearch.value = '';
        state.evidence = null; state.filter = 'all'; state.sel = id;
      } else state.sel = state.sel === id ? null : id;
      redraw();
      Array.from(document.querySelectorAll('#list .intent')).find(function (item) { return item.getAttribute('data-g') === id; })?.focus();
    }
  });

  // Zoom: Fit shows the whole map in the panel. + and - zoom in and out; the panel then scrolls.
  function applyZoom() {
    var svg = document.getElementById('map');
    // Start at readable file sizes. Fit scales even very wide maps to the viewport.
    var fit = state.zoom === null;
    svg.style.maxWidth = fit ? width + 'px' : 'none';
    svg.style.width = fit ? '100%' : Math.round(width * state.zoom) + 'px';
    document.getElementById('zoom-level').setAttribute('aria-pressed', String(fit));
  }
  var zoomBox = document.getElementById('zoom');
  if (zoomBox) zoomBox.addEventListener('click', function (e) {
    var b = e.target.closest('button'); if (!b) return;
    var k = b.getAttribute('data-z');
    var scale = state.zoom === null ? Math.min(1, mapArea().w / width) : state.zoom;
    state.zoom = k === 'fit' ? null : k === 'in' ? Math.min(scale * 1.5, 6) : Math.max(scale / 1.5, .1);
    applyZoom();
  });

  // ---------- full screen ----------
  // The card covers the page. The browser goes to full screen too, when it can. Escape or the button ends both.
  function setFull(on) {
    if (full === on) return;
    full = on;
    document.body.classList.toggle('full', on);
    var b = document.getElementById('full');
    b.setAttribute('aria-pressed', String(on));
    b.setAttribute('aria-label', on ? 'Exit full screen' : 'Full screen');
    b.title = on ? 'Exit full screen' : 'Full screen';
    tipEl.hidden = true;
    state.zoom = 1;
    drawMap();
  }
  document.getElementById('full').addEventListener('click', function () {
    var on = !full;
    setFull(on);
    try {
      var r = on ? document.documentElement.requestFullscreen && document.documentElement.requestFullscreen() : document.fullscreenElement && document.exitFullscreen();
      if (r && r.catch) r.catch(function () { /* not allowed: the card still covers the page */ });
    } catch (err) { /* the same */ }
  });
  document.addEventListener('fullscreenchange', function () { if (!document.fullscreenElement) setFull(false); });
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && full && !document.fullscreenElement) setFull(false); });
  window.addEventListener('resize', function () { drawMap(); drawNote(); });

  // ---------- the command to add the new sessions ----------
  var rerunBtn = document.getElementById('copy-rerun');
  if (rerunBtn) rerunBtn.addEventListener('click', function () {
    var cmd = document.getElementById('rerun').textContent;
    try {
      navigator.clipboard.writeText(cmd).then(function () { say('Command copied. Paste it in a terminal.'); }, function () { showToCopy(cmd); });
    } catch (err) { showToCopy(cmd); }
  });

  function reveal(target, focus) {
    for (var part = target.parentElement; part; part = part.parentElement) {
      if (part.tagName === 'DETAILS') part.open = true;
    }
    target.scrollIntoView({ block: 'start' });
    (focus || target).focus({ preventScroll: true });
  }
  var embedded = window.parent !== window && Boolean(document.getElementById('embed'));
  var dashboardActions = ['fix', 'analyse', 'old-path'];
  document.addEventListener('click', function (e) {
    var button = e.target.closest('[data-finding-sessions]');
    if (button) { showEvidence(button); return; }
    var control = e.target.closest('[data-report-action]');
    var action = control && control.getAttribute('data-report-action');
    var anchor = e.target.closest('a[href^="#"]');
    var href = anchor && anchor.getAttribute('href');
    if (action === 'explore' || href === '#mapcard') {
      e.preventDefault();
      reveal(document.getElementById('mapcard'), mapSearch);
      return;
    }
    if (href && (href === '#fixes' || href.startsWith('#finding-'))) {
      var finding = document.getElementById(href.slice(1));
      if (finding) {
        e.preventDefault();
        reveal(finding);
      }
      return;
    }
    if (embedded && dashboardActions.includes(action)) {
      e.preventDefault();
      var message = { type: 'context-health-action', action: action };
      if (control.hasAttribute('data-finding')) message.finding = control.getAttribute('data-finding');
      if (control.hasAttribute('data-fingerprint')) message.fingerprint = control.getAttribute('data-fingerprint');
      window.parent.postMessage(message, window.location.origin);
      return;
    }
    var command = e.target.closest('[data-copy-command]');
    var pathButton = e.target.closest('[data-copy-path]');
    var source = command && document.getElementById(command.getAttribute('data-copy-command'));
    var value = source ? source.textContent : pathButton && byId[state.file]?.abs;
    if (!value) return;
    var confirmation = pathButton ? 'Path copied: ' + value : 'Command copied. Paste it in a terminal.';
    try {
      navigator.clipboard.writeText(value).then(function () { say(confirmation); }, function () { showToCopy(value); });
    } catch (err) { showToCopy(value); }
  });
  if (embedded) window.addEventListener('message', function (e) {
    if (e.source !== window.parent || e.origin !== window.location.origin) return;
    if (e.data?.type !== 'context-health-action' || e.data.action !== 'findings') return;
    var findings = document.getElementById('fixes');
    if (findings) reveal(findings);
  });

  // ---------- the improvement prompt ----------
  var panel = document.getElementById('prompt');
  var showBtn = document.getElementById('show-prompt');
  function setPanel(open) {
    panel.hidden = !open;
    showBtn.setAttribute('aria-expanded', String(open));
    showBtn.textContent = open ? 'Hide prompt' : 'Show prompt';
  }
  if (showBtn) showBtn.addEventListener('click', function () { setPanel(panel.hidden); });
  function selectPanel() {
    setPanel(true);
    var r = document.createRange(); r.selectNodeContents(panel);
    var sel = window.getSelection(); sel.removeAllRanges(); sel.addRange(r);
    say('Copy blocked. The prompt is selected: press Cmd+C or Ctrl+C.');
  }
  document.getElementById('copy-prompt')?.addEventListener('click', function () {
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
  // Let the outer project page scroll naturally through the graph and the session list.
  if (window.parent !== window && document.getElementById('explorer-embed') && window.ResizeObserver) {
    var embeddedGrid = document.querySelector('.grid');
    var observeGrid = new ResizeObserver(function () {
      if (document.body.classList.contains('full')) return;
      window.parent.postMessage({ type: 'context-health-explorer-height', height: Math.ceil(embeddedGrid.getBoundingClientRect().height) }, window.location.origin);
    });
    observeGrid.observe(embeddedGrid);
  }
})();
