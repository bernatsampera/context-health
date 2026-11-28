// Exercise the shipped UI and local HTTP server together, including the connection while an AI job is active.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createInterface } from 'node:readline';
import test from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';
import { JSDOM, VirtualConsole } from 'jsdom';

const repo = path.resolve(import.meta.dirname, '..');

async function until(read, description) {
  const deadline = Date.now() + 10000;
  while (Date.now() < deadline) {
    const result = await read();
    if (result) return result;
    await delay(20);
  }
  assert.fail(description);
}

test(
  'Owners can follow and stop AI from another screen, reconnect and inspect a benchmark verdict',
  { timeout: 60000 },
  async t => {
    const work = mkdtempSync(path.join(os.tmpdir(), 'context-health-interface-'));
    const root = path.join(work, 'handbook');
    const data = path.join(work, 'data');
    const claudeHome = path.join(work, 'claude');
    const control = path.join(work, 'fake-control.json');
    mkdirSync(path.join(root, 'docs'), { recursive: true });
    mkdirSync(claudeHome);
    writeFileSync(path.join(root, 'CLAUDE.md'), 'See [release instructions](docs/publishing.md).');
    writeFileSync(path.join(root, 'docs/publishing.md'), 'Publish from the stable branch.');

    const server = spawn(
      process.execPath,
      ['bin/context-health.mjs', 'ui', '--port', '0', '--no-open', '--claude-settings-home', claudeHome],
      {
        cwd: repo,
        stdio: ['ignore', 'pipe', 'pipe'],
        env: {
          ...process.env,
          CONTEXT_HEALTH_HOME: data,
          CONTEXT_HEALTH_CLAUDE_BIN: path.join(repo, 'test/fake-claude.mjs'),
          CONTEXT_HEALTH_FAKE_CONTROL: control
        }
      }
    );
    t.after(() => server.kill('SIGTERM'));
    let base;
    for await (const line of createInterface({ input: server.stdout })) {
      base = line.match(/http:\/\/127\.0\.0\.1:\d+/)?.[0];
      if (base) break;
    }
    assert.ok(base, 'Local fixture server started');

    const [html, script, workspace] = await Promise.all(
      ['/', '/app.js', '/map-versions.js'].map(async resource => (await fetch(base + resource)).text())
    );
    const errors = [];
    const dom = new JSDOM(html, {
      url: base,
      runScripts: 'outside-only',
      pretendToBeVisual: true,
      virtualConsole: new VirtualConsole().on('jsdomError', error => errors.push(error.message))
    });
    const w = dom.window;
    const d = w.document;
    const select = expression => d.querySelector(expression);
    const visibleButton = (label, parent = d) =>
      [...parent.querySelectorAll('button')].find(b => b.textContent.trim() === label && !b.disabled);
    const press = async (label, parent) =>
      (await until(() => visibleButton(label, parent), 'Missing enabled action: ' + label)).click();
    const headers = { 'x-context-health-token': select('meta[name=token]').content, 'content-type': 'application/json' };
    const api = async (method, route, body) => {
      const response = await fetch(base + '/api' + route, { method, headers, body: body && JSON.stringify(body) });
      assert.equal(response.status, 200);
      return response.json();
    };
    const { key } = await api('POST', '/projects', { root });
    const prefix = '/projects/' + key;
    await until(async () => (await api('GET', prefix)).activity?.status === 'done', 'First local report finished');
    const reportFile = path.join(data, key, 'report.json');
    const report = JSON.parse(readFileSync(reportFile, 'utf8'));
    report.groups.list = [{ id: 'g1', label: 'Ship a release', members: [{ sessionId: 'sample', intentId: 'i1' }] }];
    report.needs.sessions = [
      {
        sessionId: 'sample',
        intents: [{ intentId: 'i1', needs: [{ kind: 'file', scope: 'project', path: 'docs/publishing.md' }] }]
      }
    ];
    writeFileSync(reportFile, JSON.stringify(report));

    // jsdom lacks native dialogs, ES module loading and EventSource. Deliver events
    // from the real server stream and allow the test to interrupt the connection.
    let stream;
    w.EventSource = class {
      constructor(resource) {
        this.resource = resource;
        stream = this;
        this.connect();
      }
      connect() {
        this.controller = new AbortController();
        const xhr = new w.XMLHttpRequest();
        const start = this.controller;
        let offset = 0;
        xhr.open('GET', this.resource);
        xhr.onprogress = () => {
          if (start.signal.aborted) return;
          if (offset === 0) this.onopen?.();
          const data = xhr.responseText.slice(offset);
          const end = data.lastIndexOf('\n\n');
          if (end < 0) return;
          offset += end + 2;
          if (data.slice(0, end).includes('data:')) this.onmessage?.();
        };
        xhr.onerror = () => this.onerror?.();
        start.signal.addEventListener('abort', () => xhr.abort(), { once: true });
        xhr.send();
      }
      disconnect() {
        this.controller.abort();
        this.onerror?.();
      }
    };
    t.after(() => {
      stream?.controller.abort();
      w.close();
    });
    w.fetch = (url, options) => fetch(new URL(url, base), options);
    w.HTMLDialogElement.prototype.showModal = function () {
      this.open = true;
    };
    w.HTMLDialogElement.prototype.close = function () {
      this.open = false;
      this.dispatchEvent(new w.Event('close'));
    };
    w.eval(
      workspace.replace('export async function openWorkspace', 'async function openWorkspace') +
        '\nwindow.workspaceModule={openWorkspace};'
    );
    w.eval(script.replace("await import('/map-versions.js')", 'window.workspaceModule'));

    const statuses = [];
    const expectStatus = async label => {
      await until(() => select('#activity-text').textContent === label, 'Expected global status: ' + label);
      statuses.push(label);
    };
    await expectStatus('AI idle');
    (await until(() => select('.project-row'), 'Project list')).click();
    await press('Save first version');
    select('dialog form input').value = 'Original map';
    select('dialog form').requestSubmit();
    await press('Generate from intents');
    const intent = select('.work-picker input');
    assert.ok(intent);
    intent.click();
    const state = await api('GET', prefix + '/map-versions');
    assert.equal(state.questions.length, 0);
    writeFileSync(control, JSON.stringify({ pauseIntent: state.intents[0].id }));
    await press('Generate for 1 intent');
    await expectStatus('AI running');
    select('#breadcrumb a').click();
    await until(() => select('.project-row'), 'Owner can leave the project');
    select('#activity-toggle').click();
    const details = select('#dialog');
    assert.match(details.textContent, /Generating questions with AI/);
    assert.match(details.textContent, /Original map/);
    assert.match(details.textContent, /sonnet/i);
    stream.disconnect();
    await expectStatus('Reconnecting');
    assert.match(details.textContent, /last known activity/);
    assert.equal(visibleButton('Stop', details), undefined);
    stream.connect();
    await expectStatus('AI running');
    await press('Stop', details);
    await expectStatus('AI idle');
    assert.match(details.textContent, /Stopped/);
    details.close();
    select('.project-row').click();

    writeFileSync(control, '{}');
    await press('Generate from intents');
    select('.work-intent-list input').click();
    await press('Generate for 1 intent');
    await until(() => select('.work-table tbody tr'), 'Generated question is in the shared table');
    assert.match(select('.work-table').textContent, /stable branch/);
    await press('Run all questions');
    assert.match(details.textContent, /Claude Sonnet/);
    assert.equal((await api('GET', prefix + '/map-versions')).results.length, 0);
    await press('Run 1 check', details);
    await press('Correct');
    assert.match(details.textContent, /Expected phrase/);
    assert.match(details.textContent, /Verified in the text read/);
    assert.match(details.textContent, /docs\/publishing.md/);
    const verdict = details.textContent;
    details.close();
    await press('Update project report');
    await press('Refresh locally', details);
    await expectStatus('Working locally');
    assert.match(select('#activity-task').textContent, /Report refresh/);
    await expectStatus('AI idle');
    await press('Refactor context');
    await press('Copy refactor prompt', details);
    // Clipboard access can be denied, including on local dashboards. The owner
    // can still copy the complete selected text or return later to copy again.
    await press('Done', details);
    (await until(() => visibleButton('Copy refactor prompt', select('.work-overview')), 'Copy again from the open refactor')).click();
    const prompt = details.querySelector('textarea').value;
    assert.ok(prompt.includes(root));
    assert.match(prompt, /read.only[\s\S]+wait for my explicit approval[\s\S]+after i approve/i);
    assert.doesNotMatch(prompt, /stable branch|which branch do we publish from/i);
    let copied;
    Object.defineProperty(w.navigator, 'clipboard', { value: { writeText: async text => { copied = text; } } });
    await press('Copy refactor prompt', details);
    await until(() => !details.open, 'Copied the prompt and returned to the project');
    assert.equal(copied, prompt);
    await press('Review file changes');
    await until(() => details.textContent.includes('No file changes'), 'Empty review explains what to do next');
    assert.equal(visibleButton('Save new version', details), undefined);
    writeFileSync(path.join(root, 'CLAUDE.md'), 'Start with the [release guide](docs/publishing.md) when shipping.');
    await press('Check again', details);
    const field = await until(() => [...details.querySelectorAll('label')].find(l => l.textContent === 'New version name')?.querySelector('input'), 'Reviewed changes can be named');
    const file = [...details.querySelectorAll('summary')].find(el => el.textContent.includes('CLAUDE.md'));
    assert.ok(file);
    file.click();
    await until(() => details.textContent.includes('when shipping.'), 'The owner sees the changed text');
    field.value = 'Release handbook';
    field.dispatchEvent(new w.Event('input'));
    await press('Save new version', details);
    await until(() => select('.work-table.paired') && !details.open, 'Saving selected the child and opened the parent comparison');
    const headings = [...select('.work-table').querySelectorAll('thead th')].map(el => el.textContent);
    assert.ok(headings.includes('Agent answer · Original map'));
    assert.ok(headings.includes('Agent answer · Release handbook'));
    assert.ok(visibleButton('Correct', select('.work-table')));
    assert.ok(visibleButton('Run question', select('.work-table')));
    const beforeRemoval = await api('GET', prefix + '/map-versions');
    const [original, child] = beforeRemoval.versions;
    async function expectReport(version, mode) {
      const expected = '/p/' + key + '/maps/' + version.id + '/report.html';
      return until(() => {
        const frame = select('#map-explorer iframe');
        if (!frame) return;
        const url = new URL(frame.src);
        return url.pathname === expected && url.searchParams.get('revision') === version.revision && url.searchParams.get('view') === mode;
      }, 'Expected the ' + mode + ' report for ' + version.name);
    }
    await expectReport(child, 'explorer');
    const childFrame = select('#map-explorer iframe');
    await press('View full report');
    await expectReport(child, 'full');
    let mapScrolled = false;
    select('#map-explorer').scrollIntoView = () => { mapScrolled = true; };
    await press('View context map');
    await expectReport(child, 'explorer');
    assert.equal(mapScrolled, true);
    await press('View full report');
    await expectReport(child, 'full');
    const versionPicker = select('select[aria-label="Map version"]');
    versionPicker.value = original.id;
    versionPicker.dispatchEvent(new w.Event('change'));
    await expectReport(original, 'full');
    await press('Back to map');
    await expectReport(original, 'explorer');
    w.dispatchEvent(new w.MessageEvent('message', {
      origin: 'null', source: select('#map-explorer iframe').contentWindow,
      data: { type: 'context-health-action', action: 'old-path' }
    }));
    assert.equal(details.open, false, 'Reading a saved report cannot open settings for the current folder');
    assert.equal(childFrame.isConnected, false, 'The previous graph is gone after the version changes');
    const question = beforeRemoval.questions[0];
    assert.equal(beforeRemoval.results[0].questionId, question.id);
    await press('Remove', select('.work-table'));
    assert.ok(details.textContent.includes(question.question));
    assert.match(details.textContent, /results from every version/);
    await press('Cancel', details);
    assert.equal((await api('GET', prefix + '/map-versions')).results.length, 1);
    await press('Remove', select('.work-table'));
    await press('Remove question', details);
    await until(() => select('.work-empty')?.textContent.includes('No benchmark questions yet'), 'Removed the last question');
    const afterRemoval = await api('GET', prefix + '/map-versions');
    assert.deepEqual(afterRemoval.questions, []);
    assert.deepEqual(afterRemoval.results, []);
    assert.deepEqual(afterRemoval.versions, beforeRemoval.versions);
    assert.deepEqual(errors, []);
    const artifact = path.join(repo, 'out', 'e2e-dashboard-workflow');
    mkdirSync(artifact, { recursive: true });
    writeFileSync(
      path.join(artifact, 'activity-and-verdict.json'),
      JSON.stringify(
        { statuses, verdict, result: beforeRemoval.results[0], comparisonHeadings: headings, remainingQuestions: afterRemoval.questions.length, remainingResults: afterRemoval.results.length },
        null,
        2
      )
    );
  }
);
