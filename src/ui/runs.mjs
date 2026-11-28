// The runs of the dashboard. Each run is the command line tool in a child process, so there is one code path.
// One run for each project at a time.
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';

export class Runs {
  constructor({ binPath, dataRoot, onChange }) {
    Object.assign(this, { binPath, dataRoot, onChange });
    this.runs = new Map();
    this.children = new Map();
  }

  // The process group: Stop must reach claude too, which is a child of the child.
  spawn(args, extraEnv = {}, track = false) {
    const stdio = track ? ['ignore', 'pipe', 'pipe', 'ipc'] : ['ignore', 'pipe', 'pipe'];
    return spawn(process.execPath, [this.binPath, ...args, '--no-open'], { detached: true, stdio,
      env: { ...process.env, CONTEXT_HEALTH_HOME: this.dataRoot, CONTEXT_HEALTH_ASK: '', ...extraEnv } });
  }

  get(key) { return this.runs.get(key) ?? null; }
  busy(key) { return this.children.has(key); }

  // kind: refresh, analyse, fix, apply. total: the model calls that the run makes, or 0.
  start(key, kind, args, total = 0, model = null) {
    const run = { id: randomUUID(), kind, status: 'running', done: 0, total, error: null, model,
      activeCalls: 0, completedCalls: 0, startedAt: new Date().toISOString(), finishedAt: null };
    const child = this.spawn(args, { CONTEXT_HEALTH_PROGRESS: '1' }, true);
    this.runs.set(key, run);
    this.children.set(key, child);
    let errors = '';
    let rest = '';
    let partial = null;
    child.on('message', message => {
      if (message?.type === 'modelStart') run.activeCalls++;
      else if (message?.type === 'modelEnd') {
        run.activeCalls = Math.max(0, run.activeCalls - 1);
        run.completedCalls++;
      } else return;
      this.onChange(key, run);
    });
    child.stdout.on('data', chunk => {
      const lines = (rest + chunk).split('\n');
      rest = lines.pop();
      for (const line of lines) {
        if (!line.startsWith('progress: partial ')) continue;
        try {
          const message = JSON.parse(line.slice('progress: partial '.length));
          if (typeof message === 'string') partial = message;
        } catch { /* An ordinary output line can start with the same words. */ }
      }
      const calls = lines.filter(line => line === 'progress: call done').length;
      if (!calls) return;
      run.done += calls;
      run.total = Math.max(run.total, run.done);
      this.onChange(key, run);
    });
    child.stderr.on('data', chunk => { errors = (errors + chunk).slice(-2000); });
    const end = (status, error = null) => {
      if (run.status !== 'running' && run.status !== 'stopping') return;
      Object.assign(run, { status, error, activeCalls: 0, finishedAt: new Date().toISOString() });
      this.children.delete(key);
      this.onChange(key, run);
    };
    child.on('error', error => end('failed', error.message));
    child.on('close', code => {
      if (run.status === 'stopping') return end('stopped');
      if ((code === 0 || code === 2) && partial) return end('partial', partial);
      end(code === 0 ? 'done' : 'failed', code === 0 ? null : errors.trim().split('\n').at(-1) || `The run ended with code ${code}.`);
    });
    this.onChange(key, run);
    return run;
  }

  stop(key) {
    const child = this.children.get(key);
    if (!child) return false;
    this.runs.get(key).status = 'stopping';
    this.onChange(key, this.runs.get(key));
    try { process.kill(-child.pid, 'SIGTERM'); } catch { child.kill('SIGTERM'); }
    return true;
  }

  stopAll() { for (const key of this.children.keys()) this.stop(key); }

  // A command that prints JSON on its last line.
  json(args) {
    return new Promise((resolve, reject) => {
      const child = this.spawn(args);
      let out = '';
      let errors = '';
      child.stdout.on('data', chunk => { out += chunk; });
      child.stderr.on('data', chunk => { errors += chunk; });
      child.on('error', reject);
      child.on('close', code => {
        try {
          if (code !== 0) throw new Error(errors.trim().split('\n').at(-1) || `The command ended with code ${code}.`);
          resolve(JSON.parse(out.trim().split('\n').at(-1)));
        } catch (error) { reject(error); }
      });
    });
  }
}
