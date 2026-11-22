#!/usr/bin/env node
// One run of context-health on the bad context with the patches you name. `npm run ab` (ab.mjs) calls it for each
// combination. To run one version by hand:
//
//   node fixtures/context-ab/apply.mjs bad               bad/ as it is
//   node fixtures/context-ab/apply.mjs better            bad/ + all patches except the counter-examples (C2 to C5)
//   node fixtures/context-ab/apply.mjs C2                bad/ + C2 only
//   node fixtures/context-ab/apply.mjs C2 C3             bad/ + C2 and C3
//   node fixtures/context-ab/apply.mjs C2 --open         also open the page
//   node fixtures/context-ab/apply.mjs C2 --out <dir>    write the report to <dir> (default: out/context-ab/<label>/)
//
// It copies bad/ to a new temp folder outside this repo, applies each patch, runs `git init` there (the tool lists
// files with git), and runs the tool with the sessions of claude-home/ and the fake model (no real model call).
// The repo files do not change.
// Step 11: each run passes the config file context-files.json. In bad/, no file links second-iteration/direction.md
// (this is the planted fault), so with the rule alone the file is not a context file and its 3 reads are dropped.
// The config file says that the files of second-iteration/ and pipeline/ are context files. It also keeps the files
// of data/ (2 index files that no file names, and the 3 research files that git ignores). With them, the list of
// files is the list of step 10, so the fake answers of the duplicate check (a hash of the file paths) still fit, and
// the A/B list is not the list of fixtures/indoeuromap (that list has another fake answer).
import { execFileSync, spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, '..', '..');
const OLD = '/Users/example/projects/indoeuromap';
// Git-ignored in this repo too, so a git clone does not have them. The tool must see them, as in the other tests.
const IGNORED = ['wave-1-finish-2026-10-20', 'europe-expansion-2026-10-20', 'growth-metrics-2026-10-21']
  .map(name => `data/research/${name}/README.md`);

// The config file of the A/B runs (`--config`). It is outside each project copy.
export const CONFIG = path.join(here, 'context-files.json');

export const allPatches = readdirSync(path.join(here, 'patches')).filter(name => name.endsWith('.json')).map(name => name.slice(0, -5)).sort();
// A patch with "counterExample" shows a change that looks good but lowers a score. `better` leaves it out.
export const betterPatches = allPatches.filter(name =>
  !JSON.parse(readFileSync(path.join(here, 'patches', `${name}.json`), 'utf8')).counterExample);

export function parseArgs(argv) {
  const names = [];
  let open = false;
  let out = null;
  for (let k = 0; k < argv.length; k += 1) {
    const arg = argv[k];
    if (arg === '--open') open = true;
    else if (arg === '--out') out = argv[(k += 1)];
    else names.push(arg);
  }
  if (names.length === 0) throw new Error(`Name a version: bad, better, or patches (${allPatches.join(', ')}).`);
  let patches;
  if (names.length === 1 && names[0] === 'bad') patches = [];
  else if (names.length === 1 && names[0] === 'better') patches = betterPatches;
  else {
    for (const name of names) if (!allPatches.includes(name)) throw new Error(`Unknown patch "${name}". Patches: ${allPatches.join(', ')}.`);
    patches = allPatches.filter(name => names.includes(name));
  }
  const label = names.length === 1 && (names[0] === 'bad' || names[0] === 'better') ? names[0] : patches.join('+');
  return { patches, label, open, out: path.resolve(out || path.join(repo, 'out', 'context-ab', label)) };
}

export function applyPatch(project, name) {
  const patch = JSON.parse(readFileSync(path.join(here, 'patches', `${name}.json`), 'utf8'));
  for (const edit of patch.edits) {
    const file = path.join(project, edit.file);
    const text = readFileSync(file, 'utf8');
    const count = text.split(edit.find).length - 1;
    if (count !== 1) throw new Error(`${name}: the text to find is in ${edit.file} ${count} times, not 1: ${JSON.stringify(edit.find.slice(0, 80))}`);
    writeFileSync(file, text.replace(edit.find, () => edit.replace));
  }
  return patch;
}

export function run({ patches, label, open, out }) {
  const work = mkdtempSync(path.join(os.tmpdir(), `context-ab-${label.replace(/\+/g, '-')}-`));
  const project = path.join(work, 'indoeuromap');
  cpSync(path.join(here, 'bad'), project, { recursive: true });
  for (const rel of IGNORED) {
    if (existsSync(path.join(project, rel))) continue;
    mkdirSync(path.dirname(path.join(project, rel)), { recursive: true });
    writeFileSync(path.join(project, rel), `# ${rel.split('/')[2]}\n\nLocal research record.\n`);
  }
  const applied = patches.map(name => ({ name, title: applyPatch(project, name).title }));
  execFileSync('git', ['-C', project, 'init', '-q']);
  execFileSync('git', ['-C', project, 'add', '-A']);
  mkdirSync(out, { recursive: true });
  const args = [path.join(repo, 'bin', 'context-health.mjs'), project,
    '--claude-settings-home', path.join(here, 'claude-home'), '--old-path', OLD,
    '--intents', '--cache', path.join(work, 'cache'), '--out', out, '--config', CONFIG];
  if (!open) args.push('--no-open');
  const result = spawnSync(process.execPath, args, {
    encoding: 'utf8', env: { ...process.env, CONTEXT_HEALTH_CLAUDE_BIN: path.join(repo, 'test', 'fake-claude.mjs') }
  });
  if (result.status !== 0) throw new Error(`context-health failed (${result.status}):\n${result.stdout}\n${result.stderr}`);
  writeFileSync(path.join(out, 'version.json'), `${JSON.stringify({ label, patches: applied }, null, 2)}\n`);
  return { out, project, stdout: result.stdout };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const options = parseArgs(process.argv.slice(2));
    const { out, project } = run(options);
    console.log(`version: ${options.label}${options.patches.length ? ` (${options.patches.join(', ')})` : ''}`);
    console.log(`project copy: ${project}`);
    console.log(`report: ${path.join(out, 'report.html')}`);
  } catch (error) {
    console.error(error.message);
    process.exit(1);
  }
}
