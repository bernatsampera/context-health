// Dashboard shell. Each project owns its saved workspace and has one active job.
'use strict';
const $ = id => document.getElementById(id);
const token = document.querySelector('meta[name="token"]').content;
const view = $('view');
const dialog = $('dialog');
let projects = [];
let home = '';
let current = { key: null, page: 'all' };
let screen = 0;
let fix = null;
let activities = {};
let connected = false;
let connectionLost = false;
let activityInitialized = false;
let haveActivity = false;
let modalKind = '';
let activitySeq = 0;
let newestRendered = 0;

function h(tag, props, ...children) {
  const node = document.createElement(tag);
  for (const [name, value] of Object.entries(props || {})) {
    if (value == null || value === false) continue;
    if (name.startsWith('on')) node.addEventListener(name.slice(2), value);
    else if (name === 'class') node.className = value;
    else if (name in node && typeof value !== 'string') node[name] = value;
    else node.setAttribute(name, value);
  }
  node.append(...children.flat(Infinity).filter(child => child != null && child !== false));
  return node;
}
const ICONS = {
  back: 'm10 3-5 5 5 5',
  next: 'm6 3 5 5-5 5',
  plus: 'M8 3v10M3 8h10',
  close: 'm4 4 8 8M12 4l-8 8',
  folder: 'M1.5 4a1 1 0 0 1 1-1h4l1.5 2h5.5a1 1 0 0 1 1 1v6a1 1 0 0 1-1 1h-11a1 1 0 0 1-1-1Z',
  settings:
    'M2 5h7m4 0h1M2 11h1m4 0h7M11 3.2a1.8 1.8 0 1 1 0 3.6 1.8 1.8 0 0 1 0-3.6ZM5 9.2a1.8 1.8 0 1 1 0 3.6 1.8 1.8 0 0 1 0-3.6Z',
  refresh: 'M13 6a5 5 0 1 0 .1 4M13 2.5V6H9.5',
  ai: 'm8 2 1.5 4.5L14 8l-4.5 1.5L8 14l-1.5-4.5L2 8l4.5-1.5Z',
  arrow: 'M2 8h11m-5-5 5 5-5 5',
  copy: 'M6 6h8v8H6zM10 3V2H2v8h1',
  file: 'M3 1.5h6L13 5v9.5H3zM8.5 2v4h4',
  check: 'm2 8 4 4L14 4',
  down: 'm3 6 5 5 5-5'
};
function icon(name) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  for (const [key, val] of Object.entries({
    class: 'glyph',
    viewBox: '0 0 16 16',
    fill: 'none',
    stroke: 'currentColor',
    'stroke-width': '1.45',
    'stroke-linecap': 'round',
    'stroke-linejoin': 'round',
    'aria-hidden': true
  }))
    svg.setAttribute(key, val);
  const line = document.createElementNS(svg.namespaceURI, 'path');
  line.setAttribute('d', ICONS[name] || ICONS.file);
  svg.append(line);
  return svg;
}
const button = (text, onclick, { kind = '', count = null, ...props } = {}) =>
  h(
    'button',
    { type: 'button', class: ('btn ' + kind).trim(), onclick, ...props },
    text,
    count ? h('span', { class: 'count' }, String(count)) : null
  );
const iconButton = (name, label, onclick, props = {}) =>
  button(icon(name), onclick, { kind: 'icon', 'aria-label': label, title: label, ...props });
const plural = (n, word) => n + ' ' + word + (n === 1 ? '' : 's');
const short = file => (home && (file === home || file.startsWith(home + '/')) ? '~' + file.slice(home.length) : file);
const dateText = value =>
  value && Number.isFinite(Date.parse(value))
    ? new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', year: 'numeric' }).format(new Date(value))
    : '';
const timeText = value =>
  value && Number.isFinite(Date.parse(value))
    ? new Intl.DateTimeFormat(undefined, { weekday: 'short', hour: 'numeric', minute: '2-digit' }).format(new Date(value))
    : '';
const projectUrl = item => '/projects/' + encodeURIComponent(item.key);
const projectHref = (key, page = '') => (key ? '#/p/' + encodeURIComponent(key) + page : '#/');
const go = (key, page = '') => {
  location.hash = projectHref(key, page);
};
function route() {
  const match = location.hash.match(/^#\/p\/([^/]+)(?:\/(fix|versions))?$/);
  if (!match) return { key: null, page: 'all' };
  try {
    return { key: decodeURIComponent(match[1]), page: match[2] === 'fix' ? 'fix' : 'project' };
  } catch {
    return { key: null, page: 'all' };
  }
}
const active = a => ['running', 'stopping'].includes(a?.status);
const jobOf = item => activities[item.key] || item.activity;
const isBusy = item => active(jobOf(item) || item.run);
let toastTimer;
function toast(text) {
  $('toast').textContent = text;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    $('toast').textContent = '';
  }, 6500);
}
async function api(method, url, body) {
  let response;
  try {
    response = await fetch('/api' + url, {
      method,
      headers: { 'x-context-health-token': token, 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body)
    });
  } catch {
    throw new Error('The local dashboard is disconnected. Reconnect to try again.');
  }
  const answer = await response.json().catch(() => ({}));
  if (!response.ok) throw Object.assign(new Error(answer.error || 'The request failed.'), { answer, status: response.status });
  return answer;
}
function showError(error) {
  if (!dialog.open) {
    toast(error.message);
    return;
  }
  let box = dialog.querySelector('[data-shell-error]');
  if (!box) {
    box = h('p', { class: 'dbody error-text', 'data-shell-error': '', role: 'alert' });
    dialog.append(box);
  }
  box.textContent = error.message;
}
const act = task => async event => {
  const target = event?.currentTarget;
  if (target && 'disabled' in target) target.disabled = true;
  try {
    await task(event);
  } catch (error) {
    showError(error);
  } finally {
    if (target?.isConnected) target.disabled = false;
  }
};
function openDialog(title, ...children) {
  modalKind = '';
  dialog.replaceChildren(
    h(
      'div',
      { class: 'dhead' },
      h('h2', { id: 'dtitle' }, title),
      iconButton('close', 'Close dialog', () => dialog.close())
    ),
    ...children
  );
  dialog.setAttribute('aria-labelledby', 'dtitle');
  if (!dialog.open) dialog.showModal();
}
dialog.addEventListener('close', () => {
  modalKind = '';
});
dialog.addEventListener('click', e => {
  if (e.target !== dialog) return;
  const rect = dialog.getBoundingClientRect();
  if (e.clientX < rect.left || e.clientX > rect.right || e.clientY < rect.top || e.clientY > rect.bottom) dialog.close();
});
const cancel = () => button('Cancel', () => dialog.close());
const footer = (...children) => h('div', { class: 'dfoot' }, children);
const projectByKey = key => projects.find(p => p.key === key);
function remember(item) {
  const at = projects.findIndex(p => p.key === item.key);
  if (at === -1) projects.push(item);
  else projects[at] = item;
}
async function loadProject(key) {
  const item = await api('GET', '/projects/' + encodeURIComponent(key));
  remember(item);
  return item;
}
function confirmRun({ title, detail, rows = [], label, task, ai = false, danger = false }) {
  const confirm = button(
    label,
    act(async () => {
      await task();
      if (dialog.contains(confirm)) dialog.close();
    }),
    { kind: ai ? 'ai' : danger ? 'danger' : 'primary' }
  );
  openDialog(
    title,
    h(
      'div',
      { class: 'dialog-body' },
      h('p', null, detail),
      rows.length
        ? h(
            'dl',
            { class: 'detail-list' },
            rows.map(([k, v]) => h('div', null, h('dt', null, k), h('dd', null, v)))
          )
        : null
    ),
    footer(cancel(), confirm)
  );
}

// ---------- add a project ----------
async function addProject(root) {
  const { key } = await api('POST', '/projects', { root });
  dialog.close();
  go(key);
}
async function openAdd() {
  const input = h('input', {
    class: 'search',
    type: 'search',
    placeholder: 'Find a project',
    'aria-label': 'Find a project',
    autocomplete: 'off'
  });
  const picks = h('div', { class: 'picks' }, h('p', { class: 'nothing', role: 'status' }, 'Reading local project folders…'));
  const choose = button(
    [icon('folder'), 'Choose folder'],
    act(async () => {
      const answer = await api('POST', '/pick');
      if (answer.path) await addProject(answer.path);
    })
  );
  openDialog(
    'Add a project',
    h('div', { class: 'filter-field' }, input),
    picks,
    h('p', { class: 'dbody caption' }, 'Adding a project reads its files and sessions locally.'),
    footer(choose)
  );
  input.focus();
  let found = [];
  function draw() {
    const words = input.value.toLowerCase().trim().split(/\s+/);
    const rows = found.filter(p => words.every(v => p.root.toLowerCase().includes(v)));
    picks.replaceChildren(
      ...(rows.length
        ? rows.map(p =>
            h(
              'button',
              { type: 'button', class: 'pick', onclick: act(() => addProject(p.root)) },
              h('span', { class: 'folder-tile' }, icon('folder')),
              h('span', null, h('b', null, p.name), h('small', null, short(p.parent))),
              h('time', { dateTime: p.lastAt }, dateText(p.lastAt))
            )
          )
        : [h('p', { class: 'nothing' }, input.value ? 'No matching folders.' : 'Choose a folder to add your project.')])
    );
  }
  input.addEventListener('input', draw);
  input.addEventListener('keydown', e => {
    if (e.key === 'Enter') picks.querySelector('.pick')?.click();
  });
  try {
    found = (await api('GET', '/suggestions')).suggestions;
    if (picks.isConnected) draw();
  } catch (e) {
    if (picks.isConnected) picks.replaceChildren(h('p', { class: 'error-text' }, e.message));
  }
}
function openSettings(item, focusPaths = false) {
  const settings = item.settings;
  const limit = h('input', { type: 'number', min: 1, max: 500, step: 1, required: true, value: settings.sessions });
  const model = h(
    'select',
    null,
    [...new Set(['sonnet', 'opus', 'haiku', settings.intentsModel])].map(v =>
      h('option', { value: v, selected: v === settings.intentsModel }, v)
    )
  );
  const paths = h('textarea', { rows: 2, placeholder: '/previous/project/folder' });
  paths.value = (settings.oldPaths || []).join('\n');
  const checks = [
    ['user', 'Personal instructions and memory'],
    ['skills', 'Skills, commands and agents']
  ].map(([id, label]) => ({ id, label, input: h('input', { type: 'checkbox', checked: settings.ignore.includes(id) }) }));
  const field = (text, input) => h('label', { class: 'form-field' }, text, input);
  const save = h('button', { type: 'submit', class: 'btn primary' }, 'Save and refresh');
  const form = h(
    'form',
    null,
    h(
      'div',
      { class: 'fields' },
      h('div', { class: 'field-pair' }, field('Session limit', limit), field('AI analysis model', model)),
      field('Previous project folders', paths),
      h('p', { class: 'caption' }, 'One absolute folder path per line.'),
      h(
        'fieldset',
        { class: 'form-field' },
        h('legend', null, 'Exclude from the health score'),
        checks.map(c => h('label', { class: 'check' }, c.input, c.label))
      ),
      h('p', { class: 'caption' }, 'Saving refreshes the report locally.')
    ),
    footer(cancel(), save)
  );
  form.addEventListener('submit', async e => {
    e.preventDefault();
    if (save.disabled) return;
    save.disabled = true;
    try {
      await api('PUT', projectUrl(item) + '/settings', {
        ...settings,
        sessions: Number(limit.value),
        intentsModel: model.value,
        oldPaths: paths.value
          .split('\n')
          .map(v => v.trim())
          .filter(Boolean),
        ignore: checks.filter(i => i.input.checked).map(i => i.id)
      });
      await api('POST', projectUrl(item) + '/run', { calls: false });
      if (dialog.contains(form)) dialog.close();
      toast('Settings saved. Refreshing the report locally.');
    } catch (error) {
      showError(error);
    } finally {
      save.disabled = false;
    }
  });
  openDialog('Project settings', form);
  if (focusPaths) paths.focus();
}

const KIND = {
  refresh: 'Report refresh',
  analyse: 'Session analysis',
  fix: 'Draft changes',
  apply: 'Apply changes',
  benchmark: 'Benchmark run',
  generate: 'Question generation',
  capture: 'Save version',
  update: 'Update version',
  investigate: 'Review map',
  child: 'Create version',
  'refactor-start': 'Start refactor',
  'refactor-review': 'Review file changes',
  'refactor-save': 'Save refactored version',
  'refactor-cancel': 'End refactor'
};
const MODEL_PHASE = {
  analyse: 'Analyzing sessions',
  fix: 'Drafting edits',
  benchmark: 'Answering a question',
  generate: 'Generating questions'
};
const statusText = {
  done: 'Completed',
  partial: 'Partially completed',
  failed: 'Failed',
  stopped: 'Stopped',
  stopping: 'Stopping'
};
function jobLabel(job) {
  const what = KIND[job.kind] || 'Project task';
  if (job.status === 'stopping') return 'Stopping ' + what.toLowerCase();
  if (!active(job)) return what + ' · ' + (statusText[job.status] || job.status);
  if (job.stage === 'model') return (MODEL_PHASE[job.kind] || what) + ' with AI';
  if (job.stage === 'saving')
    return 'Saving ' + (job.kind === 'benchmark' ? 'the answer' : job.kind === 'generate' ? 'questions' : 'changes') + ' locally';
  if (job.stage === 'preparing' && MODEL_PHASE[job.kind]) return 'Preparing ' + what.toLowerCase();
  return (
    {
      refresh: 'Refreshing the local report',
      apply: 'Applying selected changes',
      investigate: 'Reading the saved map',
      capture: 'Saving the current map',
      update: 'Updating the saved map',
      child: 'Creating a new map version',
      'refactor-start': 'Checking the project against the starting version',
      'refactor-review': 'Comparing project files with the starting version',
      'refactor-save': 'Saving the reviewed files as a new version',
      'refactor-cancel': 'Closing the refactor'
    }[job.kind] || 'Processing ' + what.toLowerCase() + ' locally'
  );
}
function jobMode(job) {
  return !active(job) && ['failed', 'partial'].includes(job.status)
    ? 'error'
    : active(job) && job.stage === 'model'
      ? 'ai'
      : 'local';
}
function jobScope(job) {
  const scope = [job.versionName, job.question || null].filter(Boolean);
  if (job.unit === 'intents' && Number.isInteger(job.total))
    scope.push((job.done ?? 0) + ' of ' + plural(job.total, 'intent') + ' reviewed');
  if (job.unit === 'calls' && job.done > 0) scope.push(plural(job.done, 'completed call'));
  if (job.model && (job.stage === 'model' || !active(job)))
    scope.push(/^claude/i.test(job.model) ? job.model : 'Claude ' + job.model);
  return scope.join(' · ');
}
function updateIndicator() {
  const jobs = Object.values(activities).filter(active);
  const ai = jobs.filter(a => a.stage === 'model').length;
  const mode = connectionLost
    ? 'offline'
    : !connected || !haveActivity
      ? 'connecting'
      : ai
        ? 'ai'
        : jobs.length
          ? 'local'
          : 'idle';
  const label = connectionLost
    ? 'Reconnecting'
    : !connected || !haveActivity
      ? 'Checking activity'
      : ai
        ? 'AI running'
        : jobs.length
          ? 'Working locally'
          : 'AI idle';
  const toggle = $('activity-toggle');
  toggle.dataset.mode = mode;
  $('activity-text').textContent = label;
  const task = $('activity-task');
  let detail = '';
  if (connected && haveActivity && jobs.length) {
    const currentJob = activities[current.key];
    const job = active(currentJob) ? currentJob : jobs.find(entry => entry.stage === 'model') || jobs[0];
    detail =
      jobs.length === 1
        ? job.stage === 'model'
          ? MODEL_PHASE[job.kind] || KIND[job.kind]
          : KIND[job.kind]
        : plural(jobs.length, 'active project');
  }
  task.hidden = !detail;
  task.textContent = detail || '';
  toggle.setAttribute('aria-label', 'Activity. ' + [label, detail].filter(Boolean).join('. ') + '. View task details');
  toggle.title = 'View activity across projects';
}
function addActivityEntry(key, job) {
  const isCurrent = current.key === key;
  const projectName = projectByKey(key)?.name || job.projectName || key.replace(/-[a-f0-9]{6}$/, '');
  const description = jobScope(job);
  return h(
    'section',
    { class: 'activity-entry' },
    h(
      'div',
      { class: 'entry-heading' },
      h('i', { class: 'activity-dot ' + jobMode(job), 'aria-hidden': true }),
      h('h3', null, jobLabel(job))
    ),
    h('small', null, projectName + ' · ' + timeText(job.finishedAt || job.startedAt)),
    description ? h('p', null, description) : null,
    job.error ? h('p', { class: 'error-text' }, job.error) : null,
    h(
      'div',
      { class: 'action-row' },
      active(job) && job.canStop
        ? button(
            'Stop',
            act(() => stopJob(key, job)),
            { 'data-job-control': 'stop-' + key, disabled: !connected || job.status === 'stopping' }
          )
        : null,
      isCurrent
        ? null
        : h(
            'a',
            { href: projectHref(key), 'data-job-control': 'open-' + key, class: 'btn quiet', onclick: () => dialog.close() },
            'Open project'
          )
    )
  );
}
function drawActivity() {
  const rows = Object.entries(activities)
    .filter(([, job]) => job)
    .sort(
      ([, a], [, b]) =>
        Number(active(b)) - Number(active(a)) ||
        String(b.finishedAt || b.startedAt).localeCompare(String(a.finishedAt || a.startedAt))
    );
  const offline = connectionLost
    ? h('p', { class: 'connection-note', role: 'status' }, 'Connection lost. Showing the last known activity.')
    : null;
  const list = h(
    'div',
    { class: 'activity-list' },
    offline,
    rows.length
      ? rows.map(([k, a]) => addActivityEntry(k, a))
      : h(
          'p',
          { class: 'activity-entry' },
          haveActivity && connected
            ? 'No tasks have run since the dashboard started.'
            : connectionLost
              ? 'Waiting for the dashboard to reconnect.'
              : 'Checking activity…'
        )
  );
  if (modalKind === 'activity' && dialog.open) {
    const old = dialog.querySelector('.activity-list');
    const focused = old?.contains(document.activeElement) && document.activeElement.dataset.jobControl;
    old?.replaceWith(list);
    if (focused)
      [...list.querySelectorAll('[data-job-control]')]
        .find(el => el.dataset.jobControl === focused && !el.disabled)
        ?.focus({ preventScroll: true });
    return;
  }
  openDialog('Activity', list);
  modalKind = 'activity';
}
$('activity-toggle').addEventListener('click', () => {
  drawActivity();
  syncActivity().catch(showError);
});
async function stopJob(key, job) {
  await api('POST', '/projects/' + encodeURIComponent(key) + '/stop', { activityId: job.id });
  if (current.key === key && activities[key]?.id === job.id)
    $('project-work')?.dispatchEvent(new CustomEvent('workspace-stop'));
  await syncActivity();
}
function renderProjectActivity(item) {
  const box = $('project-activity');
  if (!box) return;
  const job = jobOf(item);
  box.replaceChildren();
  const previousFailure = item.summary?.analysis?.failures?.[0];
  if (!job && previousFailure) {
    box.dataset.mode = 'error';
    box.append(h('div', null, h('strong', null, 'A session check failed'), h('p', null, previousFailure.reason)));
    if (previousFailure.retryable) box.append(button('Review retry', act(() => analyse(item))));
    return;
  }
  if (
    !job ||
    (active(job) && ['benchmark', 'generate'].includes(job.kind)) ||
    (!active(job) && !['failed', 'partial', 'stopped'].includes(job.status))
  )
    return;
  box.dataset.mode = jobMode(job);
  const scope = job.error || jobScope(job);
  box.append(h('div', null, h('strong', null, jobLabel(job)), scope ? h('p', null, scope) : null));
  if (active(job) && job.canStop)
    box.append(
      button(
        'Stop',
        act(() => stopJob(item.key, job)),
        { disabled: !connected || job.status === 'stopping' }
      )
    );
}
async function syncActivity() {
  const seq = ++activitySeq;
  const { activities: next } = await api('GET', '/activity');
  if (seq <= newestRendered) return;
  newestRendered = seq;
  const firstSync = !activityInitialized;
  const previous = activities;
  activities = next || {};
  haveActivity = true;
  activityInitialized = true;
  updateIndicator();
  if (modalKind === 'activity' && dialog.open) drawActivity();
  const item = projectByKey(current.key),
    job = activities[current.key],
    prior = previous[current.key];
  if (current.page === 'all') {
    for (const row of view.querySelectorAll('[data-job-project]')) {
      const project = projectByKey(row.dataset.jobProject);
      if (project) row.textContent = projectNote(project);
    }
  }
  const reportJobs = ['refresh', 'analyse', 'apply', 'fix'];
  if (
    current.page === 'all' &&
    !firstSync &&
    Object.entries(activities).some(
      ([key, entry]) =>
        reportJobs.includes(entry.kind) && !active(entry) && (entry.id !== previous[key]?.id || active(previous[key]))
    )
  )
    refreshList();
  if (!item || JSON.stringify(job) === JSON.stringify(prior)) return;
  renderProjectActivity(item);
  $('project-work')?.dispatchEvent(new CustomEvent('workspace-activity', { detail: job || null }));
  if (active(job) !== active(prior)) drawProjectTools(item);
  if (firstSync || !job || active(job) || (prior?.id === job.id && !active(prior))) return;
  // Only report changes need to replace the explorer. A benchmark finishing never remounts the project.
  if (!reportJobs.includes(job.kind)) return;
  const seqAtStart = screen;
  let fresh;
  try {
    fresh = await loadProject(item.key);
  } catch {
    return;
  }
  if (seqAtStart !== screen || current.key !== item.key) return;
  if (job.kind === 'fix' && job.status === 'done' && fresh.fix && !dialog.open) {
    go(item.key, '/fix');
    return;
  }
  drawProjectTools(fresh);
  if (job.status === 'done' || job.status === 'partial') {
    $('project-work')?.dispatchEvent(new CustomEvent('workspace-report', { detail: fresh }));
    if (job.status === 'done') toast(jobLabel(job));
  }
}
function projectNote(item) {
  const a = jobOf(item);
  if (active(a)) return jobLabel(a);
  if (a && ['failed', 'partial'].includes(a.status)) return jobLabel(a);
  if (item.fix) return 'Draft ready for review';
  if (item.newSessions) return plural(item.newSessions, 'new session');
  return '';
}
function scoreCell(item) {
  const s = item.summary;
  if (s?.shown !== 'score' || s.score == null)
    return h(
      'span',
      { class: 'quiet-value' },
      s?.shown === 'thin' ? 'Early findings' : s?.shown === 'not-proven' ? 'Awaiting evidence' : 'No score yet'
    );
  const grade = { good: 'Good', mixed: 'Mixed', poor: 'Poor' }[s.label];
  return h(
    'span',
    { class: 'row-score' },
    h('b', null, String(s.score)),
    h('small', null, grade || '/ 100'),
    item.delta
      ? h(
          'span',
          { class: 'row-delta', 'aria-label': 'Score change ' + item.delta, title: 'Change from the previous comparable report' },
          (item.delta > 0 ? '+' : '') + item.delta
        )
      : null
  );
}
function projectRow(item) {
  return h(
    'a',
    { class: 'project-row', href: projectHref(item.key), 'aria-label': 'Open ' + item.name },
    h(
      'div',
      { class: 'project-cell' },
      h('span', { class: 'folder-tile' }, icon('folder')),
      h(
        'div',
        null,
        h('strong', null, item.name),
        h('span', { class: 'row-path', title: item.root }, short(item.parent)),
        h('small', { class: 'mobile-job', 'data-job-project': item.key }, projectNote(item))
      )
    ),
    scoreCell(item),
    h(
      'div',
      { class: 'session-count row-info numeric' },
      item.summary?.sessions != null ? (item.summary.analysed ?? 0) + ' of ' + item.summary.sessions : 'No report'
    ),
    h(
      'div',
      { class: 'report-date row-info' },
      h('time', { dateTime: item.summary?.at }, dateText(item.summary?.at) || 'No report'),
      h('small', { 'data-job-project': item.key }, projectNote(item))
    ),
    h('span', { class: 'row-arrow' }, icon('next'))
  );
}
function drawAll() {
  $('breadcrumb').replaceChildren();
  const title = h(
    'div',
    { class: 'page-heading' },
    h('h1', { class: 'page-title' }, 'Projects'),
    button([icon('plus'), 'Add project'], act(openAdd), { kind: 'primary' })
  );
  const list = h(
    'div',
    { class: 'project-list' },
    h(
      'div',
      { class: 'list-head', 'aria-hidden': true },
      h('span', null, 'Project'),
      h('span', null, 'Context health'),
      h('span', { class: 'session-count' }, 'Sessions analyzed'),
      h('span', { class: 'report-date' }, 'Latest report'),
      h('span')
    ),
    [...projects].sort((a, b) => a.name.localeCompare(b.name)).map(projectRow)
  );
  view.replaceChildren(
    h(
      'div',
      { class: 'page' },
      title,
      projects.length
        ? list
        : h(
            'div',
            { class: 'empty' },
            h('h2', null, 'Choose your first project'),
            h('p', null, 'Add a local project to see how its files guide an agent.')
          )
    )
  );
}
async function analyse(item) {
  const pending = h('p', { class: 'dbody', role: 'status' }, 'Reading the local report to estimate the AI calls.');
  openDialog('Checking the estimate', pending, footer(cancel()));
  let estimate;
  try {
    estimate = await api('GET', projectUrl(item) + '/estimate');
  } catch (error) {
    if (dialog.open && dialog.contains(pending)) {
      pending.textContent = error.message;
      pending.classList.add('error-text');
    }
    return;
  }
  if (!dialog.open || !dialog.contains(pending) || current.key !== item.key) return;
  if (!estimate.total) {
    if (dialog.open) dialog.close();
    toast('The report already includes the available session evidence.');
    return;
  }
  confirmRun({
    title: 'Analyze sessions with AI?',
    ai: true,
    detail:
      'Claude reads selected session messages, tool counts, file paths and relevant excerpts. This can include personal instructions or skills excluded from your score.',
    rows: [
      ['Model', estimate.model],
      ['AI calls', 'At least ' + estimate.total],
      ['Scope', estimate.sessions ? plural(estimate.sessions, 'session') : 'Pending checks']
    ],
    label: 'Start AI analysis',
    task: () => api('POST', projectUrl(item) + '/run', { calls: true, total: estimate.total })
  });
}
function startFix(item, finding, fingerprint) {
  confirmRun({
    title: 'Draft edits with AI?',
    detail: 'Claude receives the finding and project context, then edits a temporary copy for you to review.',
    ai: true,
    label: 'Create AI draft',
    task: () => api('POST', projectUrl(item) + '/fix', { finding, fingerprint })
  });
}
function reportControls(item) {
  const pending = item.newSessions || item.summary?.pending?.total || 0;
  const option = (title, detail, actButton) =>
    h('section', { class: 'report-option' }, h('h3', null, title), h('p', null, detail), actButton);
  const local = button(
    [icon('refresh'), 'Refresh locally'],
    act(async () => {
      await api('POST', projectUrl(item) + '/run', { calls: false });
      if (dialog.contains(local)) dialog.close();
      await syncActivity();
    })
  );
  openDialog(
    'Update project report',
    h(
      'div',
      { class: 'report-options' },
      option('Refresh files and sessions', 'Read the current project folder and reuse saved session analysis.', local),
      option(
        'Analyze session evidence',
        pending
          ? plural(pending, 'pending check') + ' in this project. Review the call estimate before starting.'
          : 'Check whether any sessions or findings need AI analysis.',
        button(
          [icon('ai'), 'Review AI analysis'],
          act(() => analyse(item)),
          { kind: 'ai' }
        )
      )
    ),
    footer(h('a', {
      class: 'btn quiet', href: '/p/' + encodeURIComponent(item.key) + '/report.html?view=standalone',
      target: '_blank', rel: 'noopener'
    }, 'Open current project report'))
  );
}
const GIT_WORD = { 'no-git': 'The project is outside Git', 'no-commit': 'The project needs a first Git commit' };
function drawProjectTools(item) {
  const tools = $('project-tools');
  if (!tools) return;
  if (current.page === 'fix' && fix) {
    tools.replaceChildren(
      button('Discard draft', () =>
        confirmRun({
          title: 'Discard this draft?',
          detail: 'Discard the saved draft and its proposed file edits.',
          label: 'Discard draft',
          danger: true,
          task: async () => {
            await api('POST', projectUrl(item) + '/fix/discard', { id: fix.id });
            go(item.key);
          }
        })
      ),
      button(
        'Apply selected files',
        act(() => applyFix(item)),
        { kind: 'primary', count: fix.checked.size, disabled: !fix.checked.size || isBusy(item) }
      )
    );
    return;
  }
  tools.replaceChildren(
    ...(item.fix ? [button('Review draft', () => go(item.key, '/fix'))] : []),
    button(
      [icon('refresh'), item.hasReport ? 'Update project report' : 'Read sessions'],
      act(() => (item.hasReport ? reportControls(item) : api('POST', projectUrl(item) + '/run', { calls: false }))),
      { disabled: isBusy(item) }
    ),
    button([icon('settings'), 'Settings'], () => openSettings(item), {
      kind: 'quiet', 'aria-label': 'Project settings', disabled: isBusy(item)
    })
  );
}
function pageHeader(item, title) {
  $('breadcrumb').replaceChildren(h('a', { href: '#/' }, 'Projects'));
  return h(
    'div',
    { class: 'page-heading' },
    h(
      'div',
      null,
      h('h1', { class: 'page-title' }, title || item.name),
      h('p', { class: 'project-path' }, title ? item.name : short(item.root))
    ),
    h('div', { class: 'project-tools', id: 'project-tools' })
  );
}
function createExplorer(box) {
  let project, version, showingFullReport = false, loadedUrl = '';
  const heading = h('h2', { class: 'section-title', id: 'explorer-title' });
  const toggle = button('View full report', () => {
    showingFullReport = !showingFullReport;
    display();
  }, { kind: 'quiet' });
  const status = h('p', { class: 'muted', role: 'status' });
  const content = h('div');
  box.replaceChildren(h('div', { class: 'explorer-head' }, heading, toggle), status, content);
  box.hidden = true;

  function display() {
    box.hidden = !version && !project.hasReport;
    if (box.hidden) {
      loadedUrl = '';
      content.replaceChildren();
      return;
    }
    const view = showingFullReport ? 'full' : 'explorer';
    const base = '/p/' + encodeURIComponent(project.key);
    const params = new URLSearchParams({ view });
    let url;
    if (version) {
      params.set('revision', version.revision);
      if (version.reportKey) params.set('reportKey', version.reportKey);
      url = base + '/maps/' + encodeURIComponent(version.id) + '/report.html?' + params;
      heading.textContent = (showingFullReport ? 'Full report' : 'Context map') + ' · ' + version.name;
    } else {
      if (project.summary?.at) params.set('at', project.summary.at);
      url = base + '/report.html?' + params;
      heading.textContent = showingFullReport ? 'Project report' : 'Current context map';
    }
    toggle.textContent = showingFullReport ? 'Back to map' : 'View full report';
    if (url === loadedUrl) return;
    loadedUrl = url;
    status.textContent = showingFullReport ? 'Loading the report locally…' : 'Loading the map locally…';
    status.hidden = false;
    const frame = h('iframe', {
      class: 'report', title: heading.textContent + ' for ' + project.name,
      sandbox: 'allow-scripts', allow: 'clipboard-write *; fullscreen *',
      'data-view': view, 'data-version-id': version?.id,
      onload: () => { if (content.contains(frame)) status.hidden = true; },
      src: url
    });
    content.replaceChildren(frame);
  }
  return {
    select(item, selectedVersion) {
      project = item;
      version = selectedVersion;
      display();
    },
    focusMap() {
      showingFullReport = false;
      display();
      box.scrollIntoView({ block: 'start' });
      content.querySelector('iframe')?.focus({ preventScroll: true });
    }
  };
}
async function drawProject(item) {
  const header = pageHeader(item);
  const panel = h(
    'div',
    { class: 'workspace', id: 'project-work' },
    h('p', { role: 'status', class: 'muted' }, 'Reading saved versions…')
  );
  const explorer = h('section', { class: 'project-explorer', id: 'map-explorer', 'aria-labelledby': 'explorer-title' });
  const report = createExplorer(explorer);
  view.replaceChildren(
    h(
      'div',
      { class: 'page' },
      header,
      h('div', { class: 'inline-alert', id: 'project-activity', role: 'status' }),
      panel,
      explorer
    )
  );
  drawProjectTools(item);
  renderProjectActivity(item);
  try {
    const { openWorkspace } = await import('/map-versions.js');
    if (!panel.isConnected) return;
    await openWorkspace({
      panel,
      item,
      api,
      h,
      button,
      icon,
      openDialog,
      dialog,
      plural,
      projectUrl,
      toast,
      reviewSessions: () => analyse(projectByKey(item.key) || item),
      checkFolders: () => openSettings(projectByKey(item.key) || item, true),
      showReport: report.select,
      jumpToExplorer: report.focusMap
    });
  } catch (error) {
    if (panel.isConnected)
      panel.replaceChildren(
        h('p', { role: 'alert', class: 'error-text' }, error.message),
        button('Try again', () => drawProject(item))
      );
  }
}

window.addEventListener('message', event => {
  const frame = view.querySelector('iframe.report');
  if (!frame || event.source !== frame.contentWindow || event.origin !== 'null' || current?.page !== 'project') return;
  if (event.data?.type === 'context-health-explorer-height' && frame.dataset.view === 'explorer') {
    const height = event.data.height;
    if (Number.isSafeInteger(height) && height >= 120 && height <= 5000) frame.style.height = height + 'px';
    return;
  }
  if (dialog.open || frame.dataset.versionId) return;
  const item = projects.find(entry => entry.key === current.key);
  if (!item || isBusy(item) || event.data?.type !== 'context-health-action') return;
  const { action, finding, fingerprint } = event.data;
  if (action === 'analyse') analyse(item).catch(error => toast(error.message));
  if (action === 'old-path') openSettings(item, true);
  if (
    action === 'fix' &&
    item.summary?.fixes &&
    /^x[1-9]\d*$/.test(finding) &&
    (fingerprint === undefined || /^[a-f0-9]{64}$/.test(fingerprint))
  ) {
    if (item.fix) go(item.key, '/fix');
    else if (item.git !== 'ok') {
      const quoted = "'" + item.root.replaceAll("'", "'\\''") + "'";
      const command = `context-health fix ${quoted} --finding ${finding}${fingerprint ? ` --fingerprint ${fingerprint}` : ''}`;
      openDialog(
        'Preview needs Git',
        h(
          'p',
          { class: 'dbody' },
          `${GIT_WORD[item.git]}. To review edits with Claude Code in your project, run this in a terminal.`
        ),
        h('pre', { class: 'dbody' }, command),
        h(
          'div',
          { class: 'dfoot' },
          button('Close', () => dialog.close())
        )
      );
    } else startFix(item, finding, fingerprint);
  }
});

// ---------- the review of a fix ----------

function diffLines(patch) {
  const rows = [];
  let before = 0;
  let after = 0;
  let body = false;
  for (const line of patch.replace(/\n$/, '').split('\n')) {
    const hunk = line.match(/^@@ -(\d+)(?:,\d+)? \+(\d+)/);
    if (hunk) {
      if (body) rows.push(h('div', { class: 'gap' }, '⋯'));
      body = true;
      before = Number(hunk[1]);
      after = Number(hunk[2]);
    } else if (body && '+- '.includes(line[0] || ' ')) {
      const kind = { '+': 'a', '-': 'r' }[line[0]] || '';
      const no = line[0] === '-' ? before : after;
      if (line[0] !== '+') before += 1;
      if (line[0] !== '-') after += 1;
      rows.push(
        h(
          'div',
          { class: 'diff-line ' + kind },
          h('span', { class: 'no' }, String(no)),
          h('span', null, line[0] === '-' ? '−' : line[0] || ''),
          h('span', null, line.slice(1) || ' ')
        )
      );
    }
  }
  return rows.length ? rows : [h('div', { class: 'gap' }, 'No text to show')];
}

function reviewReason(finding, file) {
  const related = [...new Set([finding.target, ...finding.files, ...(finding.editFiles || [])])].filter(
    path => path && path !== file.path
  );
  return h(
    'section',
    { class: 'review-reason' },
    h('strong', null, 'Finding for this file'),
    h('p', null, finding.text),
    related.length ? h('p', null, 'Related files: ' + related.join(', ')) : null
  );
}

function drawFix(item) {
  const file = fix.files.find(entry => entry.path === fix.shown);
  const header = pageHeader(item, 'Review draft');
  const left = h(
    'div',
    { class: 'files' },
    h('h2', null, 'Files to apply'),
    fix.files.map(entry =>
      h(
        'div',
        { class: 'filerow' + (entry.path === fix.shown ? ' on' : '') + (fix.conflicts.includes(entry.path) ? ' conflict' : '') },
        h('input', {
          type: 'checkbox',
          'aria-label': 'Apply ' + entry.path,
          checked: fix.checked.has(entry.path),
          onchange: event => {
            if (event.target.checked) fix.checked.add(entry.path);
            else fix.checked.delete(entry.path);
            drawProjectTools(item);
          }
        }),
        h(
          'button',
          {
            type: 'button',
            onclick: () => {
              fix.shown = entry.path;
              drawFix(item);
              view.querySelector('.filerow.on button')?.focus({ preventScroll: true });
            },
            title: entry.path,
            'aria-current': entry.path === fix.shown ? 'true' : null
          },
          h('bdi', { class: 'fname' }, entry.path),
          entry.added ? h('span', { class: 'plus' }, '+' + entry.added) : null,
          entry.removed ? h('span', { class: 'minus' }, '−' + entry.removed) : null
        )
      )
    ),
    fix.blocked.length ? h('p', { class: 'blocked' }, 'Skipped files: ' + fix.blocked.join(', ')) : null
  );
  const diff = h(
    'div',
    { class: 'diff' },
    h('h2', { class: 'diff-title' }, file.path),
    fix.findings.filter(f => file.findingIds?.includes(f.id)).map(f => reviewReason(f, file)),
    diffLines(file.patch)
  );
  view.replaceChildren(
    h(
      'div',
      { class: 'page' },
      header,
      h('div', { id: 'project-activity', class: 'inline-alert', role: 'status' }),
      h('div', { class: 'draft' }, left, diff),
      h('div', { class: 'return-link' }, h('a', { href: projectHref(item.key) }, 'Back to ' + item.name))
    )
  );
  drawProjectTools(item);
  renderProjectActivity(item);
}
async function applyFix(item) {
  const draft = fix;
  confirmRun({
    title: 'Apply changes to project files?',
    detail: 'Write the selected edits to ' + item.root + ' and refresh the report locally.',
    rows: [['Selected files', [...draft.checked].join(', ')]],
    label: 'Apply ' + plural(draft.checked.size, 'file'),
    task: async () => {
      try {
        await api('POST', projectUrl(item) + '/fix/apply', { id: draft.id, files: [...draft.checked] });
        go(item.key);
      } catch (error) {
        if (!error.answer?.conflicts) throw error;
        draft.conflicts = error.answer.conflicts;
        for (const file of draft.conflicts) draft.checked.delete(file);
        if (current.key === item.key && current.page === 'fix') drawFix(item);
        throw new Error(
          'These files changed after the draft was created: ' + draft.conflicts.join(', ') + '. Review the remaining selection.'
        );
      }
    }
  });
}

// ---------- routing and live activity ----------
function loadError(error) {
  const back = h('a', { href: '#/', class: 'btn quiet' }, 'All projects');
  view.replaceChildren(
    h(
      'div',
      { class: 'page' },
      h(
        'section',
        { class: 'empty', role: 'alert' },
        h('h1', null, 'Could not open this workspace'),
        h('p', null, error.message),
        h('div', { class: 'action-row' }, button('Try again', start), back)
      )
    )
  );
}
async function start() {
  const id = ++screen;
  current = route();
  if (dialog.open) dialog.close();
  if (window.scrollY) window.scrollTo({ top: 0, behavior: 'instant' });
  const path = current;
  document.title = path.key ? 'Project | Context Health' : 'Projects | Context Health';
  if (!path.key) $('breadcrumb').replaceChildren();
  view.replaceChildren(
    h('div', { class: 'page pending-page', role: 'status' }, path.key ? 'Opening project…' : 'Reading local projects…')
  );
  try {
    if (!path.key) {
      const answer = await api('GET', '/projects');
      if (screen !== id) return;
      projects = answer.projects;
      home = answer.home;
      drawAll();
      return;
    }
    const item = await loadProject(path.key);
    if (screen !== id) return;
    document.title = item.name + ' | Context Health';
    if (path.page === 'fix') {
      let data;
      try {
        data = await api('GET', projectUrl(item) + '/fix');
      } catch (error) {
        if (screen !== id) return;
        if (error.status === 404) {
          go(item.key);
          return;
        }
        throw error;
      }
      if (screen !== id) return;
      if (!data.files?.length) {
        go(item.key);
        return;
      }
      fix = {
        id: data.id,
        key: item.key,
        files: data.files,
        findings: data.findings || [],
        blocked: data.blocked || [],
        checked: new Set(data.files.map(f => f.path)),
        shown: data.files[0].path,
        conflicts: []
      };
      drawFix(item);
    } else await drawProject(item);
  } catch (error) {
    if (screen === id) loadError(error);
  }
}
document.querySelector('.skip-link').addEventListener('click', e => {
  e.preventDefault();
  view.focus();
});
window.addEventListener('hashchange', start);
document.addEventListener('visibilitychange', () => {
  if (!document.hidden) {
    requestActivity();
    if (!current.key && !dialog.open) refreshList();
  }
});
async function refreshList() {
  const id = screen;
  try {
    const answer = await api('GET', '/projects');
    if (id !== screen || current.key || dialog.open) return;
    projects = answer.projects;
    home = answer.home;
    const focused = document.activeElement?.closest('.project-row')?.getAttribute('href');
    drawAll();
    if (focused)
      [...view.querySelectorAll('.project-row')]
        .find(row => row.getAttribute('href') === focused)
        ?.focus({ preventScroll: true });
  } catch (error) {
    toast(error.message);
  }
}
let needsSync = false;
let syncing = false;
async function requestActivity() {
  needsSync = true;
  if (syncing) return;
  syncing = true;
  try {
    while (needsSync) {
      needsSync = false;
      await syncActivity();
    }
  } catch (error) {
    if (error.status === 403) {
      location.reload();
      return;
    }
    haveActivity = false;
    updateIndicator();
    if (modalKind === 'activity' && dialog.open) drawActivity();
  } finally {
    syncing = false;
  }
}
const events = new EventSource('/api/events');
events.onopen = () => {
  connected = true;
  connectionLost = false;
  updateIndicator();
  const item = projectByKey(current.key);
  if (item) renderProjectActivity(item);
  requestActivity();
};
events.onmessage = requestActivity;
events.onerror = () => {
  connected = false;
  connectionLost = true;
  haveActivity = false;
  updateIndicator();
  if (modalKind === 'activity' && dialog.open) drawActivity();
  const item = projectByKey(current.key);
  if (item) renderProjectActivity(item);
};
start();
