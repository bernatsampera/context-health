// The score belongs to the selected map. Every version answers the project's shared questions.
const lastSelection = new Map();
const seconds = ms => (ms / 1000).toLocaleString(undefined, { maximumFractionDigits: 1 }) + ' s';
const changeLabels = { added: 'Added', edited: 'Edited', removed: 'Removed' };

function refactorPrompt(root) {
  return [
    'Help me redesign the project guidance in ' + root + '. Start with a read-only review. Keep the proposal in this chat and leave all files untouched until I approve the plan. The goal is for someone starting a common task to open one guide and understand what to do, when a rule applies, and why.',
    'Read the repository instructions and check work in progress. Survey the guidance across the project, including entry files, working guides, plans and decision records. Identify the jobs people actually do and where they have to piece an answer together. Design the file tree you would choose for those readers if you were writing the guidance today. Map the relevant sections of the old files to their new homes.',
    'Before editing, explain the plan to me in plain language. Show a short before-and-after tree of the affected files. For each main change, name what you would move, merge, split or rewrite and why. Use one real task to show how a reader would find the guidance afterward. End your reply by asking “Do you approve this plan, or would you like to change it?” Stop there and wait for my explicit approval of this plan in a later message. If I ask a question or request changes, answer or revise the plan and wait for approval.',
    'After I approve, apply the agreed changes in the repository. If you discover that a different structure or a wider set of changes is needed, bring the revised plan back to me before making those changes. Create clearly named guides for the tasks that need them. When one task is scattered across several files, bring the instructions together and rewrite them as one coherent explanation in the order the reader needs them. When one file serves several unrelated tasks, split its material between the guides for those tasks. For example, if releasing a build means piecing together a rollout plan, a decision note and a README, write a release guide that brings the steps, checks and exceptions together.',
    'Give each rule one authoritative home. Carry over exact commands, important exceptions, decisions and their reasons. Check contradictions against project sources and flag decisions that require the owner. Keep active guidance separate from open plans and historical records. As you migrate each topic, clear out superseded instructions in the old location. Where another tool or a published link relies on an old path, preserve the path and its required behavior. Respect existing edits, ownership rules and the scope of this documentation change.',
    'Once the guides contain the actual instructions, keep only project-wide essentials and the main starting points in the entry files. Put specialized references inside the relevant guides. Update the affected links and indexes, then walk through several real tasks from the entry file. Check that someone can carry out the work from the new guide, that important details survived, and that the old location no longer gives competing instructions. In your final reply, show a short before-and-after file tree and trace one task through the old files and its rewritten guide.'
  ].join('\n\n');
}

// Use identical lines as anchors. A line that occurs once in the new file can
// resynchronize the two texts without allocating a matrix for a long handbook.
function changedHunks(before, after) {
  const oldLines = before.match(/[^\n]*\n|[^\n]+$/g) || [];
  const newLines = after.match(/[^\n]*\n|[^\n]+$/g) || [];
  const positions = new Map();
  newLines.forEach((line, i) => positions.set(line, positions.has(line) ? -1 : i));
  const rows = [];
  let oldAt = 0, newAt = 0;
  function record(sign, text) {
    rows.push({ sign, text, oldLine: oldAt + 1, newLine: newAt + 1 });
    if (sign !== '+') oldAt++;
    if (sign !== '-') newAt++;
  }
  while (oldAt < oldLines.length || newAt < newLines.length) {
    if (oldLines[oldAt] === newLines[newAt]) {
      record(' ', oldLines[oldAt]);
      continue;
    }
    let oldEnd = oldAt;
    let newEnd = newLines.length;
    while (oldEnd < oldLines.length) {
      const next = positions.get(oldLines[oldEnd]);
      if (next >= newAt) {
        newEnd = next;
        break;
      }
      oldEnd++;
    }
    while (oldEnd > oldAt && newEnd > newAt && oldLines[oldEnd - 1] === newLines[newEnd - 1]) {
      oldEnd--;
      newEnd--;
    }
    while (oldAt < oldEnd) record('-', oldLines[oldAt]);
    while (newAt < newEnd) record('+', newLines[newAt]);
  }
  const ranges = [];
  for (let i = 0; i < rows.length; i++) {
    if (rows[i].sign === ' ') continue;
    const start = Math.max(0, i - 2);
    const end = Math.min(rows.length, i + 3);
    if (ranges.length && ranges.at(-1).end >= start) ranges.at(-1).end = end;
    else ranges.push({ start, end });
  }
  return ranges.map(({ start, end }) => rows.slice(start, end));
}

export async function openWorkspace({ panel, item, api, h, button, openDialog, dialog, plural, projectUrl, toast, showReport, jumpToExplorer, reviewSessions, checkFolders }) {
  const endpoint = name => projectUrl(item) + '/' + name;
  const read = () => api('GET', endpoint('map-versions'));
  const mapUrl = id => '/p/' + encodeURIComponent(item.key) + '/maps/' + encodeURIComponent(id);
  let state = await read();
  if (!panel.isConnected) return;
  const previousSelection = history.state?.mapSelection;
  let activeId = (previousSelection?.project === item.key && previousSelection.versionId)
    || lastSelection.get(item.key) || state.refactor?.versionId;
  let compareId = null,
    comparing = false,
    picking = false;
  let working = '',
    message = '',
    problem = '',
    stopRequested = false;
  const selectedIntents = new Set();
  let stateRead = 0;
  const activityKey = job => job && [job.id, job.status].join(':');
  let lastActivityId = activityKey(state.activity ?? item.activity);
  function scopeKey(node) {
    if (!node || !panel.contains(node)) return '';
    return (
      node.dataset.focus ||
      node.getAttribute('aria-label') ||
      node.id ||
      (node.tagName === 'BUTTON' || node.tagName === 'SUMMARY' ? node.textContent.trim() : '')
    );
  }
  function restoreFocus(key) {
    if (!key || dialog.open) return;
    const target = [...panel.querySelectorAll('button:not(:disabled),select:not(:disabled),summary,input:not(:disabled),a')].find(
      el => scopeKey(el) === key
    );
    target?.focus({ preventScroll: true });
  }
  let modalReturn = '';
  const active = () => state.versions.find(v => v.id === activeId);
  const intentList = () => state.intents || [];
  const shown = () => [comparing && state.versions.find(v => v.id === compareId), active()].filter(Boolean);
  const resultOf = (v, q) => state.results.find(r => r.versionId === v.id && r.questionId === q.id);
  const activeJob = () => ['running', 'stopping'].includes(state.activity?.status) ? state.activity : null;
  const running = () => Boolean(working || state.running || activeJob());
  const note = value => h('p', { class: 'work-muted' }, value);
  const action = (label, fn, kind = '', props = {}) => button(label, fn, { kind, disabled: running(), ...props });
  const close = () => dialog.close();
  const cancel = () => button('Cancel', close);
  const foot = (...children) => h('div', { class: 'work-foot' }, children);
  const modal = (title, ...children) => {
    if (!dialog.open) {
      modalReturn = scopeKey(panel.ownerDocument.activeElement);
      dialog.addEventListener(
        'close',
        () => {
          if (panel.isConnected) restoreFocus(modalReturn);
          modalReturn = '';
        },
        { once: true }
      );
    }
    openDialog(title, h('div', { class: 'work-dialog' }, children));
  };
  const select = (label, options, value, onChange) => {
    const node = h(
      'select',
      { 'aria-label': label, disabled: running(), onchange: e => onChange(e.target.value) },
      options.map(o => h('option', { value: o.id }, o.name))
    );
    node.value = value || '';
    return node;
  };
  function accept(next) {
    state = { ...state, ...next, running: next.running ?? null };
  }
  function choose(id) {
    activeId = id;
    lastSelection.set(item.key, id);
    if (panel.isConnected) {
      history.replaceState({ ...history.state, mapSelection: { project: item.key, versionId: id } }, '');
    }
    compareId = active()?.parentId || state.versions.find(v => v.id !== id)?.id;
    comparing = comparing && Boolean(compareId);
    picking = false;
    selectedIntents.clear();
  }
  function form(title, fields, submitLabel, submit, description) {
    const error = h('p', { class: 'work-error', role: 'alert' });
    const save = h('button', { type: 'submit', class: 'btn primary' }, submitLabel);
    const node = h(
      'form',
      { class: 'work-form' },
      description && note(description),
      fields.map(({ label, input, help }) => h('div', { class: 'work-field' }, h('label', null, label, input), help && note(help))),
      error,
      foot(cancel(), save)
    );
    node.onsubmit = async event => {
      event.preventDefault();
      if (save.disabled) return;
      save.disabled = true;
      save.textContent = 'Saving...';
      error.textContent = '';
      try {
        await submit(...fields.map(f => f.input.value.trim()));
        if (dialog.contains(node)) close();
        if (panel.isConnected) draw();
      } catch (e) {
        error.textContent = e.message;
      } finally {
        save.disabled = false;
        save.textContent = submitLabel;
      }
    };
    modal(title, node);
    fields[0].input.focus();
  }
  function textField(label, value, max, area = false, help) {
    const input = h(area ? 'textarea' : 'input', { required: true, maxlength: max, rows: area ? 2 : null });
    input.value = value || '';
    return { label, input, help };
  }

  function saveVersion() {
    const first = !state.versions.length;
    form(
      first ? 'Save your first version' : 'Save the current project as a version',
      [textField('Version name', first ? 'Original map' : '', 80)],
      'Save version',
      async name => {
        const next = await api('POST', endpoint('map-versions'), { name });
        const added = next.versions.find(v => v.name === name);
        accept(next);
        if (added) choose(added.id);
        message = 'Saved ' + name + '.';
      },
      'Save the project’s current context files and links under a name you choose.'
    );
  }

  function confirmAction({ title, detail, label, task, kind = 'primary' }) {
    const error = h('p', { class: 'work-error', role: 'alert' });
    const yes = button(
      label,
      async () => {
        yes.disabled = true;
        try {
          await task();
          if (dialog.contains(yes)) close();
        } catch (e) {
          error.textContent = e.message;
        } finally {
          yes.disabled = false;
        }
      },
      { kind }
    );
    modal(title, note(detail), error, foot(cancel(), yes));
  }
  function updateFiles(v) {
    confirmAction({
      title: 'Update ' + v.name + '?',
      detail: 'Replace this map’s saved files with the current project files. When the files change, its previous results are cleared.',
      label: 'Update saved files',
      task: async () => {
        accept(await api('PUT', endpoint('map-versions'), { versionId: v.id }));
        draw();
      }
    });
  }

  function refactorFiles(changes) {
    const files = changes.map(change => {
      const details = h('details', null,
        h('summary', null,
          h('code', null, change.path),
          h('span', null, changeLabels[change.kind], change.presentAtStart ? ' · Changed before start' : '')
        )
      );
      details.addEventListener('toggle', () => {
        if (!details.open || details.childElementCount > 1) return;
        const full = h('div', { class: 'work-file-versions' });
        for (const [label, text] of [['Saved version', change.before], ['Project folder', change.after]]) {
          if (text !== null) full.append(h('div', { class: 'work-file-text' },
            h('strong', null, label),
            text ? h('pre', { tabindex: 0, 'aria-label': label + ' text of ' + change.path }, text) : note('Empty file')
          ));
        }
        if (change.kind !== 'edited') {
          details.append(full);
          return;
        }
        const hunks = changedHunks(change.before, change.after);
        const diff = h('div', { class: 'work-file-diff', tabindex: 0, role: 'region', 'aria-label': 'Changed lines in ' + change.path });
        for (const lines of hunks) {
          diff.append(h('p', null, 'Saved line ' + lines[0].oldLine + ' · Project line ' + lines[0].newLine));
          const code = h('pre', null);
          let span;
          for (const row of lines) {
            if (!span || span.dataset.sign !== row.sign) {
              span = h('span', { 'data-sign': row.sign });
              code.append(span);
            }
            const atEnd = !row.text.endsWith('\n');
            span.append(row.sign + ' ' + row.text + (atEnd ? '\n' : ''));
            if (atEnd && row.sign !== ' ') span.append('  (No newline at end of file)\n');
          }
          diff.append(code);
        }
        details.append(diff, h('details', { class: 'work-full-files' }, h('summary', null, 'Read full files'), full));
      });
      return details;
    });
    const list = h('div', { class: 'work-refactor-files' }, files);
    if (files.length > 6) {
      const more = button('Show all ' + files.length + ' files', () => {
        for (const file of files.slice(6)) file.hidden = false;
        more.remove();
        files[6].querySelector('summary').focus();
      }, { kind: 'quiet' });
      for (const file of files.slice(6)) file.hidden = true;
      list.append(more);
    }
    return list;
  }

  function copyRefactor(pending) {
    const prompt = refactorPrompt(item.root);
    const field = h('textarea', { rows: 10, readonly: true, 'aria-label': 'Refactor prompt' });
    field.value = prompt;
    const preview = h('details', { class: 'work-details work-prompt' }, h('summary', null, 'Read prompt'), field);
    const status = h('p', { class: 'work-muted', role: 'status' });
    const copy = button('Copy refactor prompt', async () => {
      try {
        await navigator.clipboard.writeText(prompt);
        if (dialog.open && dialog.contains(copy)) close();
        toast('Refactor prompt copied. Paste it into your project agent.');
      } catch {
        if (!dialog.open || !dialog.contains(copy)) return;
        preview.open = true;
        field.focus();
        field.select();
        status.textContent = 'Copy the selected text and paste it into your agent.';
        copy.replaceWith(button('Done', close, { kind: 'primary' }));
      }
    }, { kind: 'primary' });
    modal('Refactor from ' + pending.versionName,
      h('p', null, 'Paste this into your project agent. It will show you a plan and ask for approval in that chat before editing. Return here to review the changed files.'),
      h('code', { class: 'work-root' }, item.root),
      preview, status, foot(copy)
    );
    modalReturn = 'review-refactor';
    copy.focus();
  }

  function endRefactor(pending) {
    confirmAction({
      title: 'End this refactor?',
      detail: 'Close the refactor from ' + pending.versionName + '. The files in your project folder keep their current contents.',
      label: 'End refactor',
      task: async () => {
        const next = await api('POST', endpoint('map-refactor/cancel'), { refactorId: pending.id });
        ++stateRead;
        accept(next);
        modalReturn = 'start-refactor';
        draw();
        toast('Refactor closed.');
      }
    });
  }

  function reviewRefactor(v, pending = null) {
    const content = h('div', { class: 'work-refactor-review' });
    const visible = () => panel.isConnected && dialog.open && dialog.contains(content);
    let name = '';
    modal(pending ? 'Review file changes' : 'Refactor context', content);

    async function check(acceptRevision) {
      content.replaceChildren(h('p', { role: 'status' }, 'Comparing local context files with ' + v.name + '...'));
      try {
        const result = pending
          ? await api('POST', endpoint('map-refactor/review'), { refactorId: pending.id })
          : await api('POST', endpoint('map-refactor/start'), { versionId: v.id, revision: v.revision, acceptRevision });
        if (result.refactor) {
          ++stateRead;
          state.refactor = result.refactor;
          draw();
        }
        if (!visible()) return;
        if (pending) showReview(result);
        else if (result.refactor) copyRefactor(result.refactor);
        else {
          content.replaceChildren(
            h('h3', null, 'Your folder already differs from ' + v.name),
            note('These changes will be included when you save the new version. Review them before giving the prompt to your agent.'),
            refactorFiles(result.changes),
            foot(cancel(), button('Include these changes', () => check(result.workingRevision), { kind: 'primary' }))
          );
        }
      } catch (error) {
        if (!visible()) return;
        content.replaceChildren(h('p', { class: 'work-error', role: 'alert' }, error.message),
          foot(pending && button('End refactor', () => endRefactor(pending), { kind: 'quiet' }), button('Close', close), button('Check again', () => check())));
        // A second tab may have ended this refactor or updated the starting map.
        const latest = await read().catch(() => null);
        if (latest && panel.isConnected) {
          accept(latest);
          draw();
        }
      }
    }

    function showReview({ changes, canSave, workingRevision }) {
      const nameField = textField('New version name', name, 80);
      nameField.input.oninput = () => { name = nameField.input.value; };
      const error = h('p', { class: 'work-error', role: 'alert' });
      const save = h('button', { type: 'submit', class: 'btn primary' }, 'Save new version');
      const refresh = button('Check again', () => check());
      const recopy = button('Copy refactor prompt', () => copyRefactor(pending), { kind: 'quiet' });
      const end = button('End refactor', () => endRefactor(pending), { kind: 'quiet' });
      const form = h('form', { class: 'work-form' },
        canSave && h('label', { class: 'work-field' }, nameField.label, nameField.input),
        error, foot(refresh, canSave && save)
      );
      form.onsubmit = async event => {
        event.preventDefault();
        if (!canSave || save.disabled) return;
        for (const control of [save, refresh, recopy, end, nameField.input]) control.disabled = true;
        save.textContent = 'Saving version...';
        error.textContent = '';
        try {
          const next = await api('POST', endpoint('map-refactor/save'), { refactorId: pending.id, workingRevision, name: nameField.input.value.trim() });
          ++stateRead;
          accept(next);
          choose(next.createdVersionId);
          comparing = true;
          compareId = v.id;
          if (visible()) {
            modalReturn = 'Map version';
            close();
          }
          draw();
          toast('New version saved. You can now compare the shared benchmarks.');
        } catch (e) {
          error.textContent = e.message;
          for (const control of [save, refresh, recopy, end, nameField.input]) control.disabled = false;
          save.textContent = 'Save new version';
        }
      };
      const count = changes.length;
      const title = h('h3', { tabindex: -1 }, count ? plural(count, 'file') + (count === 1 ? ' differs' : ' differ') + ' from ' + v.name : 'No file changes from ' + v.name);
      content.replaceChildren(
        h('div', { class: 'work-refactor-summary' },
          title,
          !count && note('When your agent has saved the context files in the project folder, check again.'),
          count > 0 && !canSave && note('These differences were already here when you started. Make a change in the project folder, then check again.'),
          canSave && v.fileCount === changes.filter(c => c.kind === 'removed').length && changes.every(c => c.kind === 'removed')
            ? note('All saved context files were removed. The new version will be empty.') : null
        ),
        ...(count ? [refactorFiles(changes)] : []),
        form,
        h('div', { class: 'work-refactor-tools' }, recopy, end)
      );
      title.focus({ preventScroll: true });
    }

    check();
  }

  function editQuestion(q) {
    const intents = intentList().map(i => ({ id: i.id, name: i.label }));
    if (q?.intentId && !intents.some(i => i.id === q.intentId)) intents.push({ id: q.intentId, name: q.intentLabel || 'Previously recorded intent' });
    const field = { label: 'Intent (optional)', input: select('Intent', [{ id: '', name: 'No intent' }, ...intents], q?.intentId, () => {}) };
    form(
      q ? 'Edit benchmark question' : 'Add a benchmark question',
      [
        textField('Question', q?.question, 1000, true),
        textField('Expected answer', q?.expected, 240, false, 'Use a short phrase quoted from a project file.'),
        field
      ],
      q ? 'Save question' : 'Add question',
      async (question, expected, intentId) => {
        accept(await api(q ? 'PUT' : 'POST', endpoint('map-questions'), { questionId: q?.id, question, expected, intentId: intentId || null }));
        message = q ? 'Question updated.' : 'Question added to every version.';
      },
      q ? 'Changing the question or expected answer clears its previous results.' : ''
    );
  }
  function removeQuestion(q) {
    confirmAction({
      title: 'Remove this question?',
      detail: 'Removing “' + q.question + '” also removes its results from every version.',
      label: 'Remove question',
      kind: 'danger',
      task: async () => {
        const index = state.questions.findIndex(question => question.id === q.id);
        accept(await api('DELETE', endpoint('map-questions'), { questionId: q.id }));
        const next = state.questions[index] || state.questions.at(-1);
        modalReturn = next ? 'question-' + next.id : 'Add question';
        message = 'Question removed.';
        draw();
      }
    });
  }

  function scorePanel() {
    const v = active();
    const report = item.summary || {};
    const score = v ? v.score : report.shown === 'score' ? report.score : null;
    const grades = v ? v.grades : report.grades;
    const rating = score >= 80 ? 'Good' : score >= 50 ? 'Mixed' : 'Poor';
    const evidenceAt = v ? v.scoreEvidenceAt : report.at;
    const reason = v?.scoreReason || (v ? 'This version has no recorded score.' : 'Analyze project sessions to score the current map.');
    const metricNames = [
      ['served', 'Found directly'],
      ['slow', 'Found through extra links'],
      ['searched', 'Found by search'],
      ['missed', 'Missed']
    ];
    const parent = v?.parentId && state.versions.find(p => p.id === v.parentId);
    const pending = state.refactor;
    const startingVersion = pending && state.versions.find(saved => saved.id === pending.versionId);
    const lockedParent = v && (pending?.versionId === v.id || state.versions.some(saved => saved.source === 'refactor' && saved.parentId === v.id));
    const total = grades ? metricNames.reduce((sum, [id]) => sum + (grades[id] || 0), 0) : 0;
    const versionSelect =
      v &&
      h(
        'label',
        { class: 'work-version' },
        'Map version',
        select('Map version', state.versions, v.id, id => {
          choose(id);
          message = '';
          problem = '';
          draw();
        })
      );
    const metadata =
      v &&
      h(
        'details',
        { class: 'work-manage', 'data-disclosure': 'options-' + v.id },
        h('summary', null, 'Version options'),
        h(
          'div',
          { class: 'work-management' },
          h('a', { href: mapUrl(v.id), target: '_blank', rel: 'noopener' }, 'Explore saved files'),
          action('Save current project as a version', saveVersion, 'quiet'),
          !v.parentId && !lockedParent && action('Update saved files', () => updateFiles(v), 'quiet')
        )
      );
    const edits =
      parent &&
      h(
        'details',
        { class: 'work-details work-changes', 'data-disclosure': 'changes-' + v.id },
        h('summary', null, v.source === 'refactor' ? 'Refactored from ' + parent.name : plural(v.appliedCount || 0, 'edit') + ' from ' + parent.name),
        v.source === 'refactor'
          ? h('ul', { class: 'work-saved-files' }, v.changedFiles.map(f => h('li', null,
              h('code', null, f.path), h('span', null, changeLabels[f.kind], f.presentAtStart ? ' · Changed before start' : '')
            )))
          : (v.appliedFixes || []).map(p => h('article', { class: 'work-edit' }, h('strong', null, p.title), note(p.file), h('pre', null, p.after)))
      );
    const distribution = total
      ? h(
          'div',
          { class: 'work-route-data' },
          h('div', { class: 'work-ledger-head' }, h('h3', null, 'Routes to information'), h('span', null, plural(total, 'recorded need'))),
          h(
            'div',
            { class: 'work-grade-bar', 'aria-hidden': 'true' },
            metricNames.filter(([id]) => grades[id] > 0).map(([id]) => h('i', { class: 'grade-' + id, style: 'flex-grow:' + grades[id] }))
          ),
          h(
            'dl',
            { class: 'work-grades' },
            metricNames.map(([id, label]) =>
              h('div', null, h('dt', null, h('i', { class: 'grade-' + id, 'aria-hidden': 'true' }), label), h('dd', null, String(grades[id] || 0)))
            )
          )
        )
      : h('div', { class: 'work-no-grades' }, note(reason));
    const measured = Number.isFinite(score) && v?.shown !== 'no-sessions';
    const scoreInfo =
      measured &&
      h(
        'details',
        { class: 'work-details work-score-help', 'data-disclosure': 'score-' + (v?.id || 'current') },
        h('summary', null, 'How this is scored'),
        note(
          'A direct route earns full credit. Extra links and searches earn half. Missed information earns none. Unused context loaded at startup can lower the score.'
        ),
        evidenceAt &&
          note('Project report · ' + new Date(evidenceAt).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' }))
      );
    return h(
      'section',
      { class: 'work-overview', 'aria-labelledby': 'work-health' },
      h(
        'div',
        { class: 'work-readout' },
        h('h2', { id: 'work-health' }, 'Context health'),
        Number.isFinite(score)
          ? h('div', { class: 'work-number' }, String(score), h('small', null, '/100'))
          : h('p', { class: 'work-unscored' }, 'Not scored yet'),
        measured && h('span', { class: 'work-rating ' + rating.toLowerCase() }, rating),
        scoreInfo
      ),
      h(
        'div',
        { class: 'work-version-body' },
        h('div', { class: 'work-version-head' }, versionSelect || h('h3', null, 'Current project files'), metadata),
        distribution,
        startingVersion && h('div', { class: 'work-pending-refactor' },
          h('div', null, h('h3', null, 'Refactor from ' + pending.versionName), note('Review the changes here when your project agent finishes.')),
          h('div', { class: 'work-actions' },
            action('Review file changes', () => reviewRefactor(startingVersion, pending), 'primary', { 'data-focus': 'review-refactor' }),
            action('Copy refactor prompt', () => copyRefactor(pending), 'quiet')
          )
        ),
        h(
          'div',
          { class: 'work-next' },
          !v && action('Save first version', saveVersion, 'primary'),
          v && !pending && action('Refactor context', () => reviewRefactor(v), 'primary', { 'data-focus': 'start-refactor' }),
          v && action('Review struggles', () => reviewStruggles(v), '', { 'data-focus': 'review-struggles' }),
          (v || item.hasReport) && button('View context map', jumpToExplorer, {kind:'quiet'}),
          edits
        )
      )
    );
  }

  function evidence(v, q) {
    const r = resultOf(v, q);
    if (!r) return h('section', { class: 'work-evidence' }, h('h3', null, v.name), note('Run this question to see the answer and citation.'));
    if (r.status === 'error')
      return h('section', { class: 'work-evidence' }, h('h3', null, v.name), h('p', { class: 'work-error' }, r.error || 'The run failed.'));
    const proof = r.evidence;
    return h(
      'section',
      { class: 'work-evidence' },
      h('h3', null, v.name),
      h('p', null, h('strong', null, 'Agent answer'), ' · ', r.answer || 'No answer'),
      h('p', null, h('strong', null, 'Verdict'), ' · ', r.status === 'correct' ? 'Correct' : 'Incorrect'),
      proof
        ? h(
            'dl',
            null,
            h('div', null, h('dt', null, 'Expected phrase'), h('dd', null, proof.phraseMatched ? 'Found in the answer' : 'Missing from the answer')),
            h(
              'div',
              null,
              h('dt', null, 'Citation'),
              h(
                'dd',
                null,
                proof.quoteMatched ? 'Verified in the text read' : proof.sourceRead ? 'Answer missing from cited text' : 'No supporting text read'
              )
            )
          )
        : note('Detailed grading evidence was not recorded for this run.'),
      r.source
        ? h(
            'p',
            null,
            'Cited file · ',
            r.status === 'correct' || proof?.sourceRead
              ? h('a', { href: mapUrl(v.id) + '?' + new URLSearchParams({ file: r.source }), target: '_blank', rel: 'noopener' }, r.source)
              : r.source
          )
        : null,
      proof?.excerpt?.text ? h('blockquote', null, proof.excerpt.text) : null,
      note(
        [Number.isFinite(r.elapsedMs) ? seconds(r.elapsedMs) : '', Number.isFinite(r.lookups) ? plural(r.lookups, 'lookup') : '']
          .filter(Boolean)
          .join(' · ')
      )
    );
  }
  function inspect(q, versions) {
    modal(
      q.question,
      h('p', null, 'Expected answer · ', h('strong', null, q.expected)),
      versions.map(v => evidence(v, q)),
      foot(
        action('Remove question', () => removeQuestion(q), 'quiet'),
        action('Edit question', () => editQuestion(q), 'quiet'),
        button('Close', close)
      )
    );
  }
  function compareNote(a, b) {
    if (!a || !b || a.status === 'error' || b.status === 'error') return '';
    if (a.status !== b.status) return b.status === 'correct' ? 'Now correct' : 'Previously correct';
    if (
      a.status !== 'correct' ||
      !a.model ||
      a.model !== b.model ||
      (a.resolvedModel || a.model) !== (b.resolvedModel || b.model) ||
      !a.method ||
      a.method !== b.method ||
      !Number.isFinite(a.elapsedMs) ||
      !Number.isFinite(b.elapsedMs)
    )
      return '';
    const diff = b.elapsedMs - a.elapsedMs;
    return Math.abs(diff) < 100 ? 'Same time' : seconds(Math.abs(diff)) + (diff < 0 ? ' faster' : ' slower');
  }
  function resultCell(q, v, before) {
    const r = resultOf(v, q);
    const label = h('span', { class: 'work-mobile-label' }, 'Agent answer · ' + v.name);
    if (state.running?.versionId === v.id && state.running?.questionId === q.id) return h('td', null, label, 'Running...');
    if (!r || r.status === 'error')
      return h(
        'td',
        null,
        label,
        r && action('Run failed', () => inspect(q, [v]), 'work-verdict mismatch'),
        action(r ? 'Retry' : 'Run question', () => confirmChecks([{ v, q }]), 'quiet')
      );
    return h(
      'td',
      null,
      label,
      h('span', { class: 'work-response' }, r.answer || 'No answer'),
      action(
        r.status === 'correct' ? 'Correct' : 'Incorrect',
        () => inspect(q, [v]),
        'work-verdict ' + (r.status === 'correct' ? 'matched' : 'mismatch'),
        {
          'data-focus': 'answer-' + v.id + '-' + q.id,
          'aria-label': (r.status === 'correct' ? 'Correct' : 'Incorrect') + '. Inspect answer for ' + q.question + ' on ' + v.name
        }
      ),
      Number.isFinite(r.elapsedMs) ? h('small', null, ' · ' + seconds(r.elapsedMs)) : null,
      before ? h('small', { class: 'work-delta' }, compareNote(resultOf(before, q), r)) : null
    );
  }
  function table(versions) {
    if (!state.questions.length)
      return h(
        'div',
        { class: 'work-empty' },
        h('strong', null, 'No benchmark questions yet'),
        note('Start with something an agent should be able to answer from the project files.')
      );
    return h(
      'table',
      { class: 'work-table' + (versions.length === 2 ? ' paired' : ''), 'aria-label': 'Shared benchmark questions and results' },
      h(
        'thead',
        null,
        h(
          'tr',
          null,
          h('th', { scope: 'col' }, 'Question'),
          h('th', { scope: 'col' }, 'Expected answer'),
          versions.map(v => h('th', { scope: 'col' }, 'Agent answer · ' + v.name)),
          h('th', { scope: 'col', class: 'work-question-actions' }, 'Actions')
        )
      ),
      h(
        'tbody',
        null,
        state.questions.map(q =>
          h(
            'tr',
            null,
            h(
              'th',
              { scope: 'row' },
              button(q.question, () => inspect(q, versions), { kind: 'work-question-name', 'data-focus': 'question-' + q.id }),
              q.intentLabel ? h('small', { class: 'work-intent' }, 'Intent · ' + q.intentLabel) : null
            ),
            h('td', { class: 'work-expected' }, h('span', { class: 'work-mobile-label' }, 'Expected answer'), q.expected),
            versions.map((v, i) => resultCell(q, v, i ? versions[0] : null)),
            h('td', { class: 'work-question-actions' },
              action('Remove', () => removeQuestion(q), 'quiet', { 'aria-label': 'Remove question: ' + q.question })
            )
          )
        )
      )
    );
  }

  async function copyPrompt() {
    const prompt = [
      'Help me choose benchmark questions for ' + item.name + '. Read the project instructions and follow their links to the relevant guides.',
      'Recorded project intents\n' +
        JSON.stringify(
          intentList().map(i => i.label),
          null,
          2
        ),
      'Questions already in our shared benchmark\n' +
        JSON.stringify(
          state.questions.map(q => q.question),
          null,
          2
        ),
      'Suggest up to five questions about different decisions someone actually needs to make. Include routine work and an occasional high-impact decision. Keep the questions usable across map versions. Leave the answer and clues about its location out of the question.',
      'For each suggestion give the intent, the question, a short expected phrase you verified in a project file, and its relative path. List any question with no documented answer separately. Leave the project files as they are.'
    ].join('\n\n');
    try {
      await navigator.clipboard.writeText(prompt);
      toast('Prompt copied. Paste it into your agent.');
    } catch {
      const area = h('textarea', { rows: 9, readonly: true });
      area.value = prompt;
      modal(
        'Copy the question prompt',
        h('label', { class: 'work-field' }, 'Prompt for your agent', area),
        note('Copy the selected text and paste it into your agent.'),
        foot(button('Close', close))
      );
      area.focus();
      area.select();
    }
  }
  function picker() {
    const intents = intentList();
    const count = selectedIntents.size;
    const generate = h(
      'button',
      { type: 'button', class: 'btn ai', disabled: !count || running(), onclick: generateQuestions },
      count ? 'Generate for ' + plural(count, 'intent') : 'Generate questions'
    );
    const all = button(
      count === intents.length ? 'Clear selection' : 'Select all intents',
      () => {
        const selectAll = selectedIntents.size !== intents.length;
        selectedIntents.clear();
        if (selectAll) intents.forEach(i => selectedIntents.add(i.id));
        draw();
      },
      { kind: 'quiet', disabled: running() }
    );
    return h(
      'section',
      { id: 'work-picker', class: 'work-picker', 'aria-label': 'Generate benchmark questions from intents' },
      h('div', { class: 'work-row' }, h('h3', null, 'Choose intents'), all),
      h(
        'div',
        { class: 'work-intent-list' },
        intents.map(i =>
          h(
            'label',
            null,
            h('input', {
              type: 'checkbox',
              'data-focus': 'intent-' + i.id,
              disabled: running(),
              checked: selectedIntents.has(i.id),
              onchange: e => {
                if (e.target.checked) selectedIntents.add(i.id);
                else selectedIntents.delete(i.id);
                generate.disabled = !selectedIntents.size;
                generate.textContent = selectedIntents.size ? 'Generate for ' + plural(selectedIntents.size, 'intent') : 'Generate questions';
                all.textContent = selectedIntents.size === intents.length ? 'Clear selection' : 'Select all intents';
              }
            }),
            i.label
          )
        )
      ),
      note('Claude (' + (item.settings?.intentsModel || 'sonnet') + ') will use the selected intents and excerpts from ' + active().name + ' to draft shared questions.'),
      foot(
        action('Cancel', () => {
          picking = false;
          draw();
        }),
        generate
      )
    );
  }
  async function generateQuestions() {
    if (running() || !active() || !selectedIntents.size) return;
    working = 'Generating benchmark questions';
    problem = '';
    message = '';
    stopRequested = false;
    draw();
    try {
      const next = await api('POST', endpoint('map-questions/generate'), { versionId: activeId, intentIds: [...selectedIntents] });
      accept(next);
      selectedIntents.clear();
      picking = false;
      message = next.addedCount
        ? 'Added ' + plural(next.addedCount, 'shared question') + '.'
        : 'No new supported questions were found for those intents.';
    } catch (e) {
      problem = e.message;
    } finally {
      working = '';
      if (panel.isConnected) draw();
    }
  }

  function reviewStruggles(v) {
    let step = 0,
      report = null,
      pending = false,
      name = '';
    let showAllStruggles = false,
      showAllProposals = false;
    const selected = new Set();
    const content = h('div', { class: 'work-review' });
    const body = (...children) => content.replaceChildren(...children.flat(Infinity).filter(child => child != null));
    const open = () => dialog.open && dialog.contains(content) && panel.isConnected;
    function show(error = '') {
      if (!open()) return;
      const titles = ['Where agents struggled', 'Choose fixes', 'Create a new version'];
      const heading = dialog.querySelector('#dtitle');
      heading.textContent = titles[step];
      heading.tabIndex = -1;
      if (!pending) heading.focus({ preventScroll: true });
      const stepLine = h('div', { class: 'work-review-progress', style: '--step:' + (step + 1) }, h('span', null, 'Local review · ' + v.name), h('span', null, 'Step ' + (step + 1) + ' of 3'));
      const errorNode = h('p', { class: 'work-error', role: 'alert' }, error);
      const back = button(
        'Back',
        () => {
          step--;
          show();
        },
        { disabled: pending }
      );
      if (pending) {
        body(
          stepLine,
          h('p', { role: 'status' }, step === 1 ? 'Preparing proposed edits...' : step === 2 ? 'Creating version...' : 'Reading session evidence...')
        );
        return;
      }
      if (error && step < 2) {
        body(
          stepLine,
          errorNode,
          foot(
            cancel(),
            step ? back : null,
            button('Try again', () => investigate(step === 1))
          )
        );
        return;
      }
      if (step === 0) {
        const struggles = report?.struggles || [];
        const visible = showAllStruggles ? struggles : struggles.slice(0, 3);
        body(
          stepLine,
          visible.map(s => {
            const sessions = [...new Set(s.sessions || [])];
            return h(
              'article',
              { class: 'work-finding' },
              h('h3', null, s.title),
              h('p', null, s.detail),
              s.source && s.source !== s.title && !s.detail?.includes(s.source) ? h('small', null, s.source) : null,
              sessions.length
                ? h(
                    'details',
                    { class: 'work-details' },
                    h('summary', null, plural(sessions.length, 'session')),
                    h(
                      'ul',
                      null,
                      sessions.map(title => h('li', null, title))
                    )
                  )
                : null
            );
          }),
          struggles.length > 3
            ? button(
                showAllStruggles ? 'Show fewer' : 'Show ' + (struggles.length - 3) + ' more struggles',
                () => {
                  showAllStruggles = !showAllStruggles;
                  show();
                  content.querySelector('[data-toggle="struggles"]')?.focus({ preventScroll: true });
                },
                { kind: 'quiet', 'data-toggle': 'struggles', 'aria-expanded': String(showAllStruggles) }
              )
            : null,
          struggles.length ? null : note('No struggles were found in the available evidence for this version.'),
          foot(
            cancel(),
            struggles.length
              ? button(
                  'Propose fixes',
                  () => {
                    step = 1;
                    investigate(true);
                  },
                  { kind: 'primary' }
                )
              : null
          )
        );
      } else if (step === 1) {
        const proposals = report?.proposals || [];
        const next = button(
          'Set up new version',
          () => {
            step = 2;
            show();
          },
          { kind: 'primary', disabled: !selected.size }
        );
        body(
          stepLine,
          proposals.length ? note('Choose the edits you want to try together.') : note('No supported edits were found for these struggles.'),
          (showAllProposals ? proposals : proposals.slice(0, 3)).map(p =>
            h(
              'article',
              { class: 'work-finding' },
              h(
                'label',
                { class: 'work-choice' },
                h('input', {
                  type: 'checkbox',
                  checked: selected.has(p.id),
                  onchange: e => {
                    if (e.target.checked) selected.add(p.id);
                    else selected.delete(p.id);
                    next.disabled = !selected.size;
                  }
                }),
                h('span', null, h('strong', null, p.title), h('small', null, p.reason))
              ),
              h('details', { class: 'work-details' }, h('summary', null, 'Preview edit'), editPreview(p))
            )
          ),
          proposals.length > 3
            ? button(
                showAllProposals ? 'Show fewer' : 'Show ' + (proposals.length - 3) + ' more fixes',
                () => {
                  showAllProposals = !showAllProposals;
                  show();
                  content.querySelector('[data-toggle="proposals"]')?.focus({ preventScroll: true });
                },
                { kind: 'quiet', 'data-toggle': 'proposals', 'aria-expanded': String(showAllProposals) }
              )
            : null,
          foot(cancel(), back, proposals.length ? next : null)
        );
      } else {
        const nameField = textField('Version name', name, 80);
        const create = h('button', { type: 'submit', class: 'btn primary' }, 'Create version and apply fixes');
        const node = h(
          'form',
          { class: 'work-form' },
          h('label', { class: 'work-field' }, nameField.label, nameField.input),
          note('Apply these edits to a new saved map. Your project files stay as they are.'),
          report.proposals.filter(p => selected.has(p.id)).map(editPreview),
          errorNode,
          foot(cancel(), back, create)
        );
        nameField.input.oninput = () => {
          name = nameField.input.value;
        };
        node.onsubmit = async event => {
          event.preventDefault();
          name = nameField.input.value.trim();
          if (!name) {
            errorNode.textContent = 'Give this version a name.';
            nameField.input.focus();
            return;
          }
          pending = true;
          show();
          try {
            const next = await api('POST', endpoint('map-child'), { versionId: v.id, revision: report.revision, name, proposalIds: [...selected] });
            accept(next);
            choose(next.createdVersionId);
            compareId = v.id;
            comparing = true;
            message = 'Created ' + name + '. Run the shared questions to compare it with ' + v.name + '.';
            if (open()) close();
            if (panel.isConnected) draw();
          } catch (e) {
            pending = false;
            show(e.message);
          }
        };
        body(stepLine, node);
        nameField.input.focus();
      }
    }
    function editPreview(p) {
      return h(
        'div',
        { class: 'work-edit' },
        h('strong', null, p.file),
        p.before ? h('div', { class: 'work-before' }, h('small', null, 'Before'), h('pre', null, p.before)) : null,
        h('div', { class: 'work-after' }, h('small', null, 'After'), h('pre', null, p.after))
      );
    }
    async function investigate(withProposals) {
      pending = true;
      show();
      try {
        const next = await api('POST', endpoint('map-investigate'), { versionId: v.id, includeProposals: withProposals });
        if (!open()) return;
        if (withProposals && report?.revision && next.revision !== report.revision) {
          selected.clear();
          step = 0;
          report = null;
          await investigate(false);
          return;
        }
        report = next;
        pending = false;
        for (const key of ['score', 'scoreReason', 'grades', 'scoreEvidenceAt']) if (Object.hasOwn(next, key)) v[key] = next[key];
        draw();
        show();
      } catch (e) {
        pending = false;
        show(e.message);
      }
    }
    modal('Where agents struggled', content);
    investigate(false);
  }

  function confirmChecks(pairs, rerun = false) {
    if (!pairs.length || running()) return;
    confirmAction({
      title: rerun ? 'Run these questions again?' : 'Run benchmark questions?',
      detail:
        'Claude Sonnet will read the selected map files using your Claude account. Each question can use up to seven calls per version.' +
        (pairs.length > 1 ? ' Keep this project open to finish the whole set.' : '') +
        (rerun ? ' New results replace the previous times and answers.' : ' Completed answers are reused.'),
      label: (rerun ? 'Rerun ' : 'Run ') + plural(pairs.length, 'check'),
      kind: 'ai',
      task: () => {
        close();
        runChecks(pairs, rerun);
      }
    });
  }
  async function runChecks(pairs, rerun) {
    if (running()) return;
    stopRequested = false;
    problem = '';
    message = '';
    try {
      for (const [index, { v, q }] of pairs.entries()) {
        if (!panel.isConnected || stopRequested) break;
        working = 'Running check ' + (index + 1) + ' of ' + pairs.length;
        state.running = { versionId: v.id, questionId: q.id };
        draw();
        const result = await api('POST', endpoint('map-benchmark'), { versionId: v.id, questionId: q.id, rerun });
        state.results = state.results.filter(r => r.versionId !== v.id || r.questionId !== q.id);
        state.results.push(result);
        if (result.status === 'error') {
          problem = result.error || 'The check could not finish.';
          break;
        }
      }
      if (!problem) message = stopRequested ? 'Benchmark run stopped.' : 'Benchmark results are ready.';
    } catch (e) {
      problem = e.message;
    } finally {
      working = '';
      if (panel.isConnected) {
        try {
          accept(await read());
        } catch (e) {
          problem ||= e.message;
          state.running = null;
        }
        if (panel.isConnected) draw();
      }
    }
  }
  async function stopRun() {
    stopRequested = true;
    draw();
    try {
      const job = activeJob();
      await api('POST', endpoint('stop'), job ? { activityId: job.id } : {});
    } catch (e) {
      stopRequested = false;
      problem = e.message;
      if (panel.isConnected) draw();
    }
  }
  function runStatus() {
    if (!working && !state.running) return null;
    const q = state.questions.find(q => q.id === state.running?.questionId);
    const v = state.versions.find(v => v.id === state.running?.versionId);
    const job = activeJob();
    const stopping = stopRequested || job?.status === 'stopping';
    const label = working || (state.running?.kind === 'generate' ? 'Generating benchmark questions' : 'Running benchmark question');
    return h(
      'div',
      { class: 'work-notice', role: 'status' },
      h('div', null, h('strong', null, label), v ? h('p', null, q ? v.name + ' · ' + q.question : v.name) : null),
      button(stopping ? 'Stopping...' : 'Stop', stopRun, { disabled: stopping || job?.canStop === false })
    );
  }
  function benchmarks() {
    const versions = shown();
    const missing = state.questions
      .flatMap(q => versions.map(v => ({ v, q })))
      .filter(({ v, q }) => {
        const r = resultOf(v, q);
        return !r || r.status === 'error';
      });
    const all = state.questions.flatMap(q => versions.map(v => ({ v, q })));
    const compareSelect =
      comparing && state.versions.length > 2
        ? select(
            'Compare with',
            state.versions.filter(v => v.id !== activeId),
            compareId,
            id => {
              compareId = id;
              draw();
            }
          )
        : null;
    const completed = all.length - missing.length;
    const correct = all.filter(({ v, q }) => resultOf(v, q)?.status === 'correct').length;
    const summary = !all.length
      ? ''
      : completed === 0
        ? plural(all.length, 'check') + ' ready to run'
        : correct + ' correct of ' + completed + ' checked' + (missing.length ? ' · ' + missing.length + ' pending' : '');
    const runLabel = missing.length ? (missing.length === all.length ? 'Run all questions' : 'Run remaining checks') : 'Rerun all questions';
    const canGenerate = Boolean(active() && intentList().length);
    return h(
      'section',
      { class: 'work-bench', 'aria-labelledby': 'bench-title' },
      h(
        'div',
        { class: 'work-bench-head' },
        h('h2', { id: 'bench-title' }, 'Shared benchmarks'),
        h(
          'div',
          { class: 'work-actions' },
          action('Add question', () => editQuestion(), 'add-question'),
          action(
            'Generate from intents',
            () => {
              picking = !picking;
              draw();
              if (picking) panel.querySelector('.work-picker input')?.focus();
            },
            'ai',
            {
              'aria-expanded': String(picking),
              'aria-controls': 'work-picker',
              'aria-label': 'Generate benchmark questions from intents with AI',
              disabled: running() || !canGenerate,
              title: !active()
                ? 'Save a map version first.'
                : !intentList().length
                  ? 'Analyze sessions to find intents.'
                  : 'Draft questions with Claude'
            }
          ),
          action('Copy prompt', copyPrompt, 'quiet')
        )
      ),
      picking ? picker() : null,
      !canGenerate && !picking
        ? active()
          ? h('div', {class:'work-prerequisite'}, note(item.summary?.sessions ? 'Generate questions once the sessions have recorded intents.' : 'No session intents are available yet.'),
              item.summary?.sessions ? action('Review AI analysis', reviewSessions, 'quiet') : action('Check project folders', checkFolders, 'quiet'))
          : note('Save a map version to generate or run questions.')
        : null,
      summary || state.versions.length > 1
        ? h(
            'div',
            { class: 'work-run-toolbar' },
            h(
              'div',
              { class: 'work-suite-info' },
              h('strong', null, summary),
              state.versions.length > 1
                ? h(
                    'label',
                    { class: 'work-check' },
                    h('input', {
                      type: 'checkbox',
                      'data-focus': 'compare',
                      checked: comparing,
                      disabled: running(),
                      onchange: e => {
                        comparing = e.target.checked;
                        draw();
                      }
                    }),
                    compareSelect ? 'Compare with' : 'Compare versions'
                  )
                : null,
              compareSelect
            ),
            all.length
              ? action(runLabel, () => confirmChecks(missing.length ? missing : all, !missing.length), missing.length ? 'ai' : 'quiet', {
                  'data-focus': 'run-suite'
                })
              : null
          )
        : null,
      runStatus(),
      problem ? h('p', { class: 'work-error', role: 'alert' }, problem) : null,
      table(versions),
      message ? h('p', { class: 'work-note', role: 'status' }, message) : null
    );
  }

  function draw() {
    if (!panel.isConnected) return;
    if (!running()) stopRequested = false;
    if (!active() && state.versions.length) choose(state.versions.at(-1).id);
    showReport(item, active());
    if (!compareId || compareId === activeId || !state.versions.some(v => v.id === compareId)) {
      compareId = active()?.parentId || state.versions.find(v => v.id !== activeId)?.id;
      if (!compareId) comparing = false;
    }
    const key = scopeKey(panel.ownerDocument.activeElement);
    const disclosures = new Set([...panel.querySelectorAll('details[open][data-disclosure]')].map(el => el.dataset.disclosure));
    panel.replaceChildren(scorePanel(), benchmarks());
    panel.querySelectorAll('details[data-disclosure]').forEach(el => { el.open = disclosures.has(el.dataset.disclosure); });
    restoreFocus(key);
  }
  panel.addEventListener('workspace-report', event => {
    item = event.detail;
    if (panel.isConnected) draw();
  });
  panel.addEventListener('workspace-stop', () => {
    stopRequested = true;
    draw();
  });
  panel.addEventListener('workspace-activity', async event => {
    const job = event.detail;
    if (!panel.isConnected) return;
    state.activity = job;
    const signature = activityKey(job);
    if (signature === lastActivityId) return;
    lastActivityId = signature;
    if (working) return;
    const revision = ++stateRead;
    if (activeJob()) {
      state.running = ['benchmark', 'generate'].includes(job.kind) ? job : null;
      draw();
      return;
    }
    try {
      const next = await read();
      if (!panel.isConnected || revision !== stateRead || working) return;
      accept(next);
      draw();
    } catch (e) {
      if (panel.isConnected && revision === stateRead) {
        problem = e.message;
        draw();
      }
    }
  });
  if (active()) choose(activeId);
  draw();
}
