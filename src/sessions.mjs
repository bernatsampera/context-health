// Step 3: read the Claude Code sessions of the project. No model calls.
// It turns each interactive session into numbered messages and file events (read, search, load, edit, miss),
// and gives each read the first place in the session that names its path (knownFrom).
// The report keeps no tool output text. The full texts go into `memory` for steps 4 and 5.
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { TOKEN_METHOD, tokens } from './collect.mjs';
import { PIPE_FILTERS, classifyShellCommand, removePrefixes, shellWords, splitSegments } from '../vendor/show-context/shell-kind.mjs';

const P = path.posix;
const TEXT_CUT = 300;
const FOLDER_NAME_MAX = 200; // Claude Code cuts a longer folder name and adds a hash.
const EDIT_TOOLS = new Set(['Edit', 'Write', 'MultiEdit', 'NotebookEdit']);
const AGENT_TOOLS = new Set(['Agent', 'Task']);
const SEARCH_PROGRAMS = new Set(['ls', 'find', 'grep', 'rg', 'fd', 'tree']);
const NOT_USER_TEXT = /^(<task-notification|<local-command-|<bash-input|<bash-stdout|<bash-stderr|<system-reminder|<user-memory-input)/;

const cmp = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
const encode = folder => folder.replace(/[^A-Za-z0-9]/g, '-');
const isDir = dir => { try { return statSync(dir).isDirectory(); } catch { return false; } };
const readText = file => { try { return readFileSync(file, 'utf8'); } catch { return null; } };

function parseLines(file) {
  const records = [];
  for (const line of (readText(file) || '').split('\n')) {
    if (!line.trim()) continue;
    try { records.push(JSON.parse(line)); } catch { /* a damaged line: skip it, keep the session */ }
  }
  return records;
}

function textOf(value) {
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) return value.map(textOf).filter(Boolean).join('\n');
  if (value?.type === 'image' || value?.source?.type === 'base64') return '[image]';
  if (typeof value?.text === 'string') return value.text;
  if (value?.content != null) return textOf(value.content);
  return '';
}

function cleanUserText(text) {
  return text.replaceAll('\r', '')
    .replace(/<system-reminder\b[^>]*>[\s\S]*?<\/system-reminder>/gi, '')
    .replace(/<local-command-[^>]+>[\s\S]*?<\/local-command-[^>]+>/gi, '')
    .replace(/\n{3,}/g, '\n\n').trim();
}

const cut = text => {
  const chars = Array.from(text);
  return { text: chars.slice(0, TEXT_CUT).join(''), cut: chars.length > TEXT_CUT };
};

// ---------- paths ----------

// The worktree part at the start of a path under a root. Claude Code makes its worktrees in
// `.claude/worktrees/<name>/`. `.worktrees/<name>/` is the other usual place. A worktree is a copy of the project,
// so a path in it is the same file as the path in the main folder.
const WORKTREE_BASES = ['.claude/worktrees', '.worktrees'];
const WORKTREE = /^(\.claude\/worktrees|\.worktrees)\/([^/]+)(?:\/|$)/;
// The part is cut each time it is at the start. Real sessions have paths with 2 parts: the recorded cwd is in the
// worktree, and the command starts with a relative `cd .claude/worktrees/<name>`.
const stripWorktree = rel => {
  let out = rel;
  while (WORKTREE.test(out)) out = out.replace(WORKTREE, '');
  return out;
};

// Map an absolute (or cwd-relative) path to the report form: project-relative, ~/.claude/..., ~/..., or absolute.
// A path in a worktree becomes the path in the main folder.
function pathMapper({ roots, home, claudeSettingsHome }) {
  const sorted = [...roots].sort((a, b) => b.length - a.length);
  return (value, cwd) => {
    if (!value) return null;
    let abs = value.startsWith('~/') ? P.join(home, value.slice(2))
      : P.isAbsolute(value) ? P.normalize(value) : P.resolve(cwd || sorted.at(-1), value);
    if (abs.length > 1) abs = abs.replace(/\/$/, '');
    for (const root of sorted) {
      if (abs !== root && !abs.startsWith(`${root}/`)) continue;
      const rel = stripWorktree(abs.slice(root.length + 1));
      return rel || '.';
    }
    if (abs.startsWith(`${claudeSettingsHome}/`)) return `~/.claude/${abs.slice(claudeSettingsHome.length + 1)}`;
    if (abs === home || abs.startsWith(`${home}/`)) return `~${abs.slice(home.length)}`;
    // A home folder of another machine (the session ran on the Mac, the tool runs here).
    const other = abs.match(/^\/(?:Users|home)\/[^/]+(\/.*)?$/);
    if (other) return `~${other[1] || ''}`;
    return abs;
  };
}

const isRelative = rel => rel && !rel.startsWith('~') && !rel.startsWith('/');

// Does `text` (the text of a source at `base`, a folder in report form, or null) name the path `target`?
// Full path, or the correct relative path from `base`. A base name alone matches only when that is the right path.
function textNames(text, target, base, mapPath) {
  if (!text || !target || target === '.') return false;
  const name = P.basename(target);
  for (let at = text.indexOf(name); at >= 0; at = text.indexOf(name, at + 1)) {
    const after = text.slice(at + name.length, at + name.length + 2);
    if (/^[A-Za-z0-9_-]/.test(after) || /^\.[A-Za-z0-9]/.test(after)) continue;
    let start = at;
    while (start > 0 && !/[\s()[\]<>"'`,;:|*{}=]/.test(text[start - 1])) start -= 1;
    let token = text.slice(start, at + name.length).replace(/^@/, '');
    if (!token) continue;
    if (token.startsWith('~/') || token.startsWith('/')) {
      if (mapPath(token) === target) return true;
      continue;
    }
    token = token.replace(/^\.\//, '');
    // A relative path with a worktree part names the file of the main folder.
    if (P.normalize(token) === target || stripWorktree(P.normalize(token)) === target) return true;
    if (base != null && P.normalize(P.join(base, token)) === target) return true;
  }
  return false;
}

// ---------- shell commands ----------

function optionValue(words, names) {
  const index = words.findIndex(word => names.includes(word));
  return index >= 0 ? words[index + 1] ?? null : null;
}

// The first search program of a Bash command: its pattern and folder, or null.
function shellSearch(command, cwd) {
  let dir = cwd;
  for (const segment of splitSegments(command)) {
    let words = removePrefixes(shellWords(segment.text));
    if (words[0] === 'cd' && words[1]) {
      dir = P.resolve(dir, words[1].replace(/^~(?=\/|$)/, process.env.HOME || '~'));
      words = removePrefixes(words.slice(2));
    }
    if (!words.length) continue;
    const program = P.basename(words[0]);
    if (segment.separator === '|' && PIPE_FILTERS.has(program)) continue;
    const args = words.slice(1);
    const plain = args.filter(arg => !arg.startsWith('-'));
    if (program === 'git') {
      const sub = args.find(arg => !arg.startsWith('-'));
      if (sub === 'ls-files' || sub === 'ls-tree') return { program: 'git', query: null, target: '.', dir };
      continue;
    }
    if (!SEARCH_PROGRAMS.has(program)) continue;
    if (program === 'ls' || program === 'tree') return { program, query: null, target: plain[0] || '.', dir };
    if (program === 'find') {
      const firstOption = args.findIndex(arg => arg.startsWith('-'));
      const roots = (firstOption < 0 ? args : args.slice(0, firstOption));
      return { program, query: optionValue(args, ['-name', '-iname', '-path', '-ipath']), target: roots[0] || '.', dir };
    }
    if (program === 'fd') return { program, query: plain[0] ?? null, target: plain[1] || '.', dir };
    // grep, rg: skip option values, then pattern and folder.
    const rest = [];
    let pattern = optionValue(args, ['-e', '--regexp']);
    for (let i = 0; i < args.length; i += 1) {
      const arg = args[i];
      if (['-e', '--regexp', '-A', '-B', '-C', '-m', '-g', '--glob', '-t', '--type', '--include', '--exclude', '--max-count'].includes(arg)) { i += 1; continue; }
      if (!arg.startsWith('-')) rest.push(arg);
    }
    if (pattern == null) pattern = rest.shift() ?? null;
    return { program, query: pattern, target: rest[0] || '.', dir };
  }
  return null;
}

// The parts of a command that print output. A bare cd and a pipe filter do not count.
function outputParts(command) {
  return splitSegments(command).filter(segment => {
    const words = removePrefixes(shellWords(segment.text));
    if (!words.length) return false;
    if (words[0] === 'cd') return words.length > 2;
    return !(segment.separator === '|' && PIPE_FILTERS.has(P.basename(words[0])));
  }).length;
}

// ---------- one session ----------

function newCounter() {
  return { userMessages: 0, reads: 0, filesRead: 0, readTokens: 0, searches: 0, searchTokens: 0, loads: 0, edits: 0, misses: 0 };
}

function parseSession({ sessionId, file, folder, worktree, entrypoint, records, subagents, ctx }) {
  const { mapPath, fileSet } = ctx;
  const messages = [];
  const memoryMessages = [];
  const events = [];
  const eventText = {};
  const compactions = [];
  const startLoad = [];
  const startLoadText = {};
  const readBefore = new Set();
  const writtenBefore = new Set();
  const usage = { firstRequestTokens: null, peakContextTokens: null };
  let startDone = false;
  let afterCompaction = false;
  let lastText = '';
  let toolsSince = new Map();

  const mainSources = [];
  const currentMessage = () => messages.length ? messages.length : null;

  const findKnown = (target, sources) => {
    for (const source of sources) {
      const hit = source.path === target || source.resultPaths?.includes(target)
        || textNames(source.text, target, source.base, mapPath);
      if (!hit) continue;
      return { kind: source.kind, path: source.kind === 'start' || source.kind === 'file' ? source.path : null,
        message: source.kind === 'user' ? source.message : null, event: source.kind === 'search' ? source.event : null };
    }
    return { kind: 'none', path: null, message: null, event: null };
  };
  const baseOf = rel => rel === '.' ? '.' : P.dirname(rel);

  const addMessage = (kind, fullText) => {
    const n = messages.length + 1;
    const shown = cut(fullText);
    messages.push({ n, kind, text: shown.text, cut: shown.cut, mentions: [], firstEvent: events.length });
    memoryMessages.push({ n, kind, text: fullText,
      agentBefore: { lastText, tools: [...toolsSince].map(([name, count]) => ({ name, count })) } });
    toolsSince = new Map();
    // "Agent before" holds only the agent text since the last message.
    lastText = '';
    mainSources.push({ kind: 'user', message: n, text: fullText, base: null });
    if (kind === 'user') afterCompaction = false;
  };

  const pushEvent = (thread, event, text, sources) => {
    const i = events.length;
    for (const item of compactions) if (item.beforeEvent === null) item.beforeEvent = i;
    const full = { i, message: thread.message ?? currentMessage(), thread: thread.name, parentEvent: thread.parentEvent(i), ...event };
    events.push(full);
    if (text != null && (event.kind === 'read' || event.kind === 'load')) eventText[i] = text;
    if (event.kind === 'read' || event.kind === 'load') sources.push({ kind: 'file', path: event.path, text, base: baseOf(event.path) });
    if (event.kind === 'search') sources.push({ kind: 'search', event: i, resultPaths: event.resultPaths });
    if (event.kind === 'read') readBefore.add(event.path);
    if (event.kind === 'edit') writtenBefore.add(event.path);
    return full;
  };

  const fileEvent = (kind, tool, rel, tokenCount, extra, sources) => {
    const event = { kind, tool, path: rel, tokens: tokenCount, inProject: fileSet.has(rel) };
    if (kind === 'read') {
      Object.assign(event, { lines: extra.lines ?? null, knownFrom: findKnown(rel, sources),
        repeat: readBefore.has(rel), afterOwnWrite: writtenBefore.has(rel) });
    }
    if (kind === 'miss') event.knownFrom = findKnown(rel, sources);
    if (kind === 'load') event.how = extra.how;
    return event;
  };

  // Paths listed in a search result text: one per line, or the part before the first ':'.
  const outputPaths = (text, dir) => {
    const found = [];
    for (const raw of text.split('\n')) {
      const line = raw.trim();
      if (!line) continue;
      for (const candidate of [line, line.split(':')[0]]) {
        if (!candidate || /\s/.test(candidate)) continue;
        const rel = mapPath(candidate, dir);
        const keep = fileSet.has(rel) || (!isRelative(rel) && /[./]/.test(candidate))
          || (isRelative(rel) && candidate.includes('/') && /\.[A-Za-z0-9]+$/.test(candidate));
        if (keep && rel !== '.' && !found.includes(rel)) { found.push(rel); break; }
      }
    }
    return found;
  };
  const lsPaths = (text, targetAbs) => {
    const found = [];
    let dir = targetAbs;
    for (const raw of text.split('\n')) {
      const line = raw.trim();
      if (!line || /^total \d+/.test(line)) continue;
      if (line.endsWith(':') && !line.includes(' ')) { dir = P.resolve(targetAbs, line.slice(0, -1)); continue; }
      const parts = line.split(/\s+/);
      const name = (/^[dlcbps-][rwxsStT-]{9}/.test(line) ? parts.at(-1) : line).replace(/[/*@=|]$/, '');
      if (!name || name === '.' || name === '..') continue;
      // A line with a full path is not a name in the listed folder: `ls` got full paths, or another part of the
      // command printed the line (then the path ends at the first ":").
      const full = name.startsWith('/') ? name.split(':')[0] : null;
      if (full != null ? /\s/.test(full) : (name.includes('/') && /\s/.test(name))) continue;
      const rel = mapPath(full ?? P.join(dir, name));
      if (rel && rel !== '.' && !found.includes(rel)) found.push(rel);
    }
    return found;
  };

  const readResult = (record, block, resultText) => {
    const result = record.toolUseResult;
    if (result && typeof result === 'object' && (['image', 'pdf'].includes(result.type) || result.file?.base64)) {
      return { text: null, tokens: null, lines: null };
    }
    if (result && typeof result === 'object' && typeof result.file?.content === 'string') {
      const f = result.file;
      return { text: f.content, tokens: tokens(f.content),
        lines: { from: f.startLine ?? null, count: f.numLines ?? null, total: f.totalLines ?? null } };
    }
    // No structured result (subagent records): strip the line numbers of the result text.
    const clean = resultText.replace(/<system-reminder>[\s\S]*?<\/system-reminder>/g, '').replace(/\s+$/, '');
    const numbered = clean.split('\n').map(line => line.match(/^\s*(\d+)[\t→](.*)$/));
    if (clean && numbered.every(Boolean)) {
      const content = numbered.map(match => match[2]).join('\n');
      return { text: content, tokens: tokens(content),
        lines: { from: Number(numbered[0][1]), count: numbered.length, total: null } };
    }
    return { text: clean, tokens: tokens(clean), lines: null };
  };

  // Events of one tool result. `thread` gives the thread name, message and parent; `sources` the knownFrom sources.
  const toolEvents = (call, block, record, thread, sources) => {
    const name = call.name;
    const input = call.input || {};
    const cwd = record.cwd || call.cwd;
    const resultText = textOf(block.content);
    const isError = block.is_error === true;
    if (name === 'Read') {
      const rel = mapPath(input.file_path, cwd);
      if (!rel) return;
      if (isError) {
        pushEvent(thread, fileEvent('miss', 'Read', rel, tokens(resultText), {}, sources), null, sources);
        return;
      }
      const read = readResult(record, block, resultText);
      pushEvent(thread, fileEvent('read', 'Read', rel, read.tokens, { lines: read.lines }, sources), read.text, sources);
      return;
    }
    if (EDIT_TOOLS.has(name)) {
      const rel = mapPath(input.file_path || input.notebook_path, cwd);
      if (rel && !isError) pushEvent(thread, fileEvent('edit', name, rel, null, {}, sources), null, sources);
      return;
    }
    if (name === 'Grep' || name === 'Glob') {
      const dirAbs = input.path ? P.resolve(cwd || '/', input.path) : cwd;
      pushEvent(thread, { kind: 'search', tool: name, path: null, tokens: tokens(resultText),
        query: input.pattern ?? null, target: mapPath(dirAbs, cwd) || '.', resultPaths: isError ? [] : outputPaths(resultText, cwd) }, null, sources);
      return;
    }
    if (name !== 'Bash' || typeof input.command !== 'string') return;
    const command = input.command;
    const kind = classifyShellCommand(cwd ? `cd '${cwd.replaceAll("'", "'\\''")}' && ${command}` : command,
      { home: ctx.home });
    if (kind.kind === 'file') {
      const files = (kind.files || []).filter(item => !item.revision && !/[$*?]/.test(item.path));
      const share = files.length ? Math.ceil(tokens(resultText) / files.length) : 0;
      // The output comes from one program only when the command has one part that prints (cd and pipe filters do not count).
      const alone = outputParts(command) === 1;
      let first = null;
      for (const item of files) {
        const rel = mapPath(item.path, cwd);
        const missing = isError && new RegExp(`${P.basename(item.path).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}: No such file`).test(resultText);
        if (missing) { pushEvent(thread, fileEvent('miss', 'Bash', rel, tokens(resultText), {}, sources), null, sources); continue; }
        let text = resultText;
        let count = tokens(resultText);
        if (!alone || files.length > 1) {
          // The output is not only this file. A project file gets the tokens of the file on disk, and its own text
          // when the output holds it. Else: one program shares its whole output as the text, a command of several parts gives none.
          const disk = ctx.diskText(rel);
          count = disk != null ? tokens(disk) : share;
          text = disk != null && disk.trim() && resultText.includes(disk.trim()) ? disk : alone ? resultText : null;
        }
        const event = pushEvent(thread, fileEvent('read', 'Bash', rel, count, { lines: null }, sources), text, sources);
        if (first === null) first = event.i;
      }
      // A command of several parts (for example cat x && ls y): the rest of the output is a search result.
      if (!alone && !isError && first !== null) {
        const search = shellSearch(command, cwd || '/');
        const resultPaths = search?.program === 'ls' ? lsPaths(resultText, P.resolve(search.dir, search.target))
          : outputPaths(resultText, search?.dir || cwd);
        sources.push({ kind: 'search', event: first, resultPaths });
      }
      return;
    }
    if (kind.kind !== 'explore') return;
    const search = shellSearch(command, cwd || '/');
    if (!search) return;
    const targetAbs = P.resolve(search.dir, search.target);
    const resultPaths = isError ? [] : search.program === 'ls' ? lsPaths(resultText, targetAbs) : outputPaths(resultText, search.dir);
    pushEvent(thread, { kind: 'search', tool: 'Bash', path: null, tokens: tokens(resultText), query: search.query,
      target: mapPath(targetAbs) || '.', resultPaths }, null, sources);
  };

  // Each subagent file is walked at most once. A subagent result can point back to a subagent
  // that is already on the walk stack (real data), which else loops until the stack overflows.
  const walked = new Set();

  // Walk the records of one thread. Main: messages, loads, compactions. Subagent: tool events only.
  const walk = (list, thread, sources) => {
    const calls = new Map();
    for (const record of list) {
      const isMain = thread.name === 'main';
      if (isMain && record.isSidechain === true) continue;
      if (record.type === 'assistant') {
        const sum = ['input_tokens', 'cache_read_input_tokens', 'cache_creation_input_tokens']
          .reduce((total, key) => total + (record.message?.usage?.[key] || 0), 0);
        if (isMain && record.message?.usage) {
          if (usage.firstRequestTokens === null) usage.firstRequestTokens = sum;
          usage.peakContextTokens = Math.max(usage.peakContextTokens ?? 0, sum);
        }
        for (const block of Array.isArray(record.message?.content) ? record.message.content : []) {
          if (isMain && block.type === 'text' && block.text?.trim()) lastText = block.text.trim();
          if (block.type !== 'tool_use') continue;
          calls.set(block.id, { name: block.name, input: block.input, cwd: record.cwd, message: thread.message ?? currentMessage() });
          if (isMain) toolsSince.set(block.name, (toolsSince.get(block.name) || 0) + 1);
        }
        continue;
      }
      if (record.type === 'system' && record.subtype === 'compact_boundary' && isMain) {
        const meta = record.compactMetadata || {};
        compactions.push({ beforeEvent: null, preTokens: meta.preTokens ?? null, postTokens: meta.postTokens ?? null });
        afterCompaction = true;
        continue;
      }
      if (record.type === 'attachment') {
        const att = record.attachment || {};
        if (att.type === 'instructions' && isMain && !startDone) {
          startDone = true;
          for (const item of att.files || []) {
            const rel = mapPath(item.path, record.cwd);
            const text = typeof item.content === 'string' ? item.content : '';
            startLoad.push({ path: rel, type: item.type ?? null, tokens: tokens(text) });
            startLoadText[rel] = text;
            mainSources.push({ kind: 'start', path: rel, text, base: baseOf(rel) });
          }
        } else if (att.type === 'nested_memory') {
          const rel = mapPath(att.path || att.content?.path, record.cwd);
          const text = textOf(att.content?.content ?? '');
          if (rel) pushEvent(thread, fileEvent('load', null, rel, tokens(text), { how: 'nested' }, sources), text, sources);
        } else if (att.type === 'file' && att.filename) {
          const rel = mapPath(att.filename, record.cwd);
          const content = att.content?.file?.content;
          const image = att.content?.type === 'image' || att.content?.file?.base64;
          const how = afterCompaction ? 'restore' : 'mention';
          if (isMain && how === 'mention' && messages.length && !messages.at(-1).mentions.includes(rel)) messages.at(-1).mentions.push(rel);
          pushEvent(thread, fileEvent('load', null, rel, image ? null : tokens(content || ''), { how }, sources), image ? null : (content || ''), sources);
        } else if (att.type === 'directory' && att.path && isMain && messages.length) {
          const rel = mapPath(att.path, record.cwd);
          if (!messages.at(-1).mentions.includes(rel)) messages.at(-1).mentions.push(rel);
        }
        continue;
      }
      if (record.type !== 'user') continue;
      const content = record.message?.content;
      const blocks = Array.isArray(content) ? content : [];
      for (const block of blocks.filter(item => item.type === 'tool_result')) {
        const call = calls.get(block.tool_use_id);
        if (!call) continue;
        const resultText = textOf(block.content);
        if (isMain && call.name === 'AskUserQuestion') {
          const answers = record.toolUseResult?.answers;
          const text = answers && typeof answers === 'object'
            ? Object.entries(answers).map(([question, answer]) => `${question} ${answer}`).join('\n')
            : resultText.replace(/\s*(Read the answers carefully|You can now continue)[\s\S]*$/i, '').trim();
          addMessage('answer', text);
          continue;
        }
        if (block.is_error && (record.permissionDecision?.decision === 'reject'
          || /doesn't want to proceed|rejected by the user|user rejected/i.test(resultText))) {
          if (isMain) addMessage('denied', resultText.match(/the user said:\n([\s\S]*)$/i)?.[1]?.trim() || '');
          continue;
        }
        if (AGENT_TOOLS.has(call.name)) {
          const agentId = subagents.byToolUse.get(block.tool_use_id) || record.toolUseResult?.agentId;
          const sub = agentId && !walked.has(agentId) ? (walked.add(agentId), subagents.records(agentId)) : null;
          const first = events.length;
          if (sub) {
            const subThread = { name: `agent:${agentId}`, message: call.message, parentEvent: () => first };
            walk(sub, subThread, [...sources]);
          }
          // The Agent result is a search result for the thread that called it.
          sources.push({ kind: 'search', event: events.length > first ? first : null, text: resultText, base: null });
          continue;
        }
        toolEvents(call, block, record, thread, sources);
      }
      if (!isMain) continue;
      const direct = typeof content === 'string' ? content
        : blocks.filter(block => block.type === 'text' || block.type === 'image').map(textOf).join('\n');
      if (!direct.trim()) continue;
      if (record.isMeta) {
        const skill = direct.match(/^Base directory for this skill:\s*(\S+)/);
        if (skill) {
          const rel = mapPath(P.join(skill[1], 'SKILL.md'), record.cwd);
          pushEvent(thread, fileEvent('load', null, rel, tokens(direct), { how: 'skill' }, sources), direct, sources);
        } else if (messages.at(-1)?.kind === 'command' && events.length === messages.at(-1).firstEvent) {
          // The body of a slash command: the agent has it as the text of the command message.
          mainSources.findLast(source => source.kind === 'user').text += `\n${direct}`;
        }
        continue;
      }
      if (record.isCompactSummary || record.promptSource === 'system' || record.origin?.kind === 'task-notification') continue;
      const trimmed = direct.trim();
      if (NOT_USER_TEXT.test(trimmed)) continue;
      if (/^\[Request interrupted by user/.test(trimmed)) { addMessage('interruption', trimmed); continue; }
      const commandName = trimmed.match(/<command-name>([\s\S]*?)<\/command-name>/)?.[1]?.trim();
      if (commandName) {
        const args = trimmed.match(/<command-args>([\s\S]*?)<\/command-args>/)?.[1]?.trim();
        const slash = commandName.startsWith('/') ? commandName : `/${commandName}`;
        addMessage('command', args ? `${slash} ${args}` : slash);
        continue;
      }
      const clean = cleanUserText(direct);
      if (clean) addMessage('user', clean);
    }
  };

  walk(records, { name: 'main', message: undefined, parentEvent: () => null }, mainSources);

  for (const message of messages) if (message.firstEvent >= events.length) message.firstEvent = null;
  const times = records.map(record => record.timestamp).filter(value => typeof value === 'string').sort();
  const totals = newCounter();
  const readPaths = new Set();
  totals.userMessages = messages.filter(message => message.kind === 'user').length;
  for (const event of events) {
    if (event.kind === 'read') { totals.reads += 1; totals.readTokens += event.tokens || 0; readPaths.add(event.path); }
    if (event.kind === 'search') { totals.searches += 1; totals.searchTokens += event.tokens || 0; }
    if (event.kind === 'load') totals.loads += 1;
    if (event.kind === 'edit') totals.edits += 1;
    if (event.kind === 'miss') totals.misses += 1;
  }
  totals.filesRead = readPaths.size;
  const report = {
    sessionId, folder, worktree, entrypoint,
    startedAt: times[0] ?? null, endedAt: times.at(-1) ?? null,
    gitBranch: records.find(record => record.gitBranch)?.gitBranch ?? null,
    startLoad, messages, events, compactions, usage, totals
  };
  return { report, memory: { messages: memoryMessages, startLoadText, eventText }, file };
}

// ---------- folders ----------

function sessionFiles(dir) {
  return readdirSync(dir, { withFileTypes: true }).filter(entry => entry.isFile() && entry.name.endsWith('.jsonl'))
    .map(entry => entry.name).sort();
}

function firstCwd(file) {
  for (const line of (readText(file) || '').split('\n')) {
    const match = line.match(/"cwd":"((?:[^"\\]|\\.)*)"/);
    if (match) { try { return JSON.parse(`"${match[1]}"`); } catch { /* next line */ } }
  }
  return null;
}

// Each different cwd of a session file, in the order of the file.
function allCwds(file) {
  const found = [];
  for (const match of (readText(file) || '').matchAll(/"cwd":"((?:[^"\\]|\\.)*)"/g)) {
    try {
      const cwd = JSON.parse(`"${match[1]}"`);
      if (!found.includes(cwd)) found.push(cwd);
    } catch { /* a damaged value: skip it */ }
  }
  return found;
}

// The worktree of a cwd under `root`: { base, name }, or null.
function worktreeOf(cwd, root) {
  const match = cwd.slice(root.length + 1).match(WORKTREE);
  return match ? { base: match[1], name: match[2] } : null;
}

// The session folders of the known roots: the exact folder, plus worktree and subfolder folders whose cwd is under the root.
// A worktree folder gets the worktree name, for both places of a worktree.
function findFolders(projectsDir, roots, display) {
  if (!isDir(projectsDir)) return [];
  const names = readdirSync(projectsDir, { withFileTypes: true }).filter(entry => entry.isDirectory()).map(entry => entry.name).sort();
  const found = [];
  for (const name of names) {
    const dir = path.join(projectsDir, name);
    for (const root of roots) {
      const encoded = encode(root);
      const exact = name === encoded;
      const prefix = encoded.length > FOLDER_NAME_MAX ? encoded.slice(0, FOLDER_NAME_MAX) : `${encoded}-`;
      if (!exact && !name.startsWith(prefix)) continue;
      const files = sessionFiles(dir);
      if (exact) {
        found.push({ name, dir, root, worktree: null, files, display: display(root) });
        break;
      }
      const under = value => value === root || value?.startsWith(`${root}/`);
      const cwd = files.map(file => firstCwd(path.join(dir, file))).find(under);
      if (!cwd) continue;
      let worktree = worktreeOf(cwd, root);
      // A session can start in the main folder and go into the worktree later. Then the folder name still names the worktree:
      // `<project>--claude-worktrees-<name>` or `<project>--worktrees-<name>`. The exact name comes from a later cwd.
      const base = worktree ? null : WORKTREE_BASES.find(item => name.startsWith(encode(`${root}/${item}/`)));
      if (base) {
        const later = files.flatMap(file => allCwds(path.join(dir, file))).filter(under).map(value => worktreeOf(value, root))
          .filter(item => item && item.base === base);
        const encoded = item => encode(`${root}/${base}/${item.name}`);
        const rest = name.slice(encode(`${root}/${base}/`).length);
        worktree = later.find(item => encoded(item) === name) || later.find(item => name.startsWith(`${encoded(item)}-`))
          || (rest ? { base, name: rest } : null);
      }
      const start = worktree ? `${root}/${worktree.base}/${worktree.name}` : cwd;
      found.push({ name, dir, root, worktree: worktree?.name ?? null, files, display: display(start) });
      break;
    }
  }
  return found;
}

function subagentsOf(dir, sessionId) {
  const sub = path.join(dir, sessionId, 'subagents');
  const byToolUse = new Map();
  if (isDir(sub)) {
    for (const name of readdirSync(sub).sort()) {
      const match = name.match(/^agent-(.+)\.meta\.json$/);
      if (!match) continue;
      try {
        const meta = JSON.parse(readText(path.join(sub, name)));
        if (meta.toolUseId) byToolUse.set(meta.toolUseId, match[1]);
      } catch { /* a damaged meta file: the agent is not linked */ }
    }
  }
  return { byToolUse, records: agentId => isDir(sub) ? parseLines(path.join(sub, `agent-${agentId}.jsonl`)) : [] };
}

// ---------- main ----------

// skipIds: session ids that do not count, for example the sessions of `context-health fix`.
export function readSessions({ root, home, claudeSettingsHome, oldPaths = [], files = [], skipIds = [] }) {
  const skipSet = new Set(skipIds);
  root = path.resolve(root);
  home = path.resolve(home);
  claudeSettingsHome = path.resolve(claudeSettingsHome);
  const knownRoots = [root, ...oldPaths.map(item => P.normalize(item).replace(/\/$/, ''))];
  const fileSet = new Set(files);
  const diskText = rel => (fileSet.has(rel) ? readText(path.join(root, rel)) : null);
  const display = abs => {
    if (abs.startsWith(`${claudeSettingsHome}/`)) return `~/.claude/${abs.slice(claudeSettingsHome.length + 1)}`;
    if (abs === home || abs.startsWith(`${home}/`)) return `~${abs.slice(home.length)}`;
    return abs;
  };
  const folders = findFolders(path.join(claudeSettingsHome, 'projects'), [...new Set(knownRoots)], display);
  const skipped = [];
  const parsed = [];
  for (const folder of folders) {
    for (const file of folder.files) {
      if (skipSet.has(file.replace(/\.jsonl$/, ''))) {
        skipped.push({ folder: folder.name, file, reason: 'fix-session' });
        continue;
      }
      const records = parseLines(path.join(folder.dir, file));
      const entrypoints = records.map(record => record.entrypoint).filter(Boolean);
      if (entrypoints.length && entrypoints.every(value => value === 'sdk-cli')) {
        skipped.push({ folder: folder.name, file, reason: 'headless' });
        continue;
      }
      const sessionId = file.replace(/\.jsonl$/, '');
      // A session in the exact folder whose first cwd is outside all known roots was moved (for example from the Mac).
      // Its first cwd counts as an old root for this session.
      const roots = [...knownRoots];
      const first = records.find(record => record.cwd)?.cwd;
      if (!folder.worktree && first && !roots.some(item => first === item || first.startsWith(`${item}/`))
        && folder.name === encode(folder.root)) roots.push(first);
      const mapPath = pathMapper({ roots, home, claudeSettingsHome });
      const result = parseSession({ sessionId, file, folder: folder.name, worktree: folder.worktree,
        entrypoint: entrypoints.find(value => value !== 'sdk-cli') ?? null, records,
        subagents: subagentsOf(folder.dir, sessionId), ctx: { mapPath, fileSet, home, diskText } });
      if (!result.report.totals.userMessages) {
        skipped.push({ folder: folder.name, file, reason: 'no-user-message' });
        continue;
      }
      parsed.push(result);
    }
  }
  skipped.sort((a, b) => cmp(a.folder, b.folder) || cmp(a.file, b.file));
  parsed.sort((a, b) => cmp(b.report.startedAt || '', a.report.startedAt || '')
    || cmp(a.report.sessionId, b.report.sessionId));
  const list = parsed.map(item => item.report);
  const memory = new Map(parsed.map(item => [item.report.sessionId, item.memory]));
  const sum = key => list.reduce((total, session) => total + session.totals[key], 0);
  const report = {
    tokenMethod: TOKEN_METHOD,
    oldPaths: [...oldPaths],
    folders: folders.map(folder => ({ name: folder.name, root: folder.display, worktree: folder.worktree, files: folder.files.length })),
    skipped,
    totals: { sessions: list.length, userMessages: sum('userMessages'), reads: sum('reads'), readTokens: sum('readTokens'), searches: sum('searches') },
    list
  };
  return { report, memory };
}
