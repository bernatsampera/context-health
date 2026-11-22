// Copy of show-context src/shell-kind.mjs (commit 1abeb39). Only change: splitSegments, shellWords and removePrefixes are exported, for context-health src/sessions.mjs.
import path from 'node:path';

export const FILE_PROGRAMS = new Set(['cat', 'head', 'tail', 'less', 'more', 'bat', 'nl']);
export const EXPLORE_PROGRAMS = new Set([
  'ls', 'find', 'grep', 'rg', 'fd', 'tree', 'wc', 'du', 'stat', 'file', 'which',
  'pgrep', 'ps', 'lsof', 'env'
]);
export const EXPLORE_GIT_SUBCOMMANDS = new Set([
  'log', 'status', 'diff', 'branch', 'ls-files', 'ls-tree'
]);
export const PIPE_FILTERS = new Set([
  'head', 'tail', 'grep', 'sort', 'uniq', 'cut', 'wc', 'jq', 'sed', 'awk', 'tr', 'column'
]);
export const SUDO_OPTIONS_WITH_VALUE = new Set(['-C', '-D', '-g', '-h', '-p', '-R', '-r', '-t', '-T', '-u']);
export const HEAD_TAIL_OPTIONS_WITH_VALUE = new Set(['-c', '--bytes', '-n', '--lines']);
export const NL_OPTIONS_WITH_VALUE = new Set(['-b', '-d', '-f', '-h', '-i', '-l', '-n', '-s', '-v', '-w']);
export const JQ_OPTIONS_WITH_TWO_VALUES = new Set(['--arg', '--argjson', '--slurpfile', '--rawfile', '--argfile']);
export const JQ_OPTIONS_WITH_VALUE = new Set(['-L', '--indent']);
export const KIND_STRENGTH = { run: 0, explore: 1, file: 2 };
// Helpers that set up or print; they are not the action of a command.
export const NEUTRAL_PROGRAMS = new Set(["mkdir", "echo", "printf", "export", "true", "set", "sleep", ":"]);

export function splitSegments(command) {
  const segments = [];
  let text = '';
  let quote = '';
  let substitutionDepth = 0;
  let separator = '';
  const push = nextSeparator => {
    if (text.trim()) segments.push({ text: text.trim(), separator });
    text = '';
    separator = nextSeparator;
  };
  for (let index = 0; index < command.length; index += 1) {
    const character = command[index];
    const next = command[index + 1];
    if (quote) {
      text += character;
      if (character === '\\' && quote === '"' && next) {
        text += next;
        index += 1;
      } else if (character === quote) {
        quote = '';
      }
      continue;
    }
    if (character === "'" || character === '"') {
      quote = character;
      text += character;
      continue;
    }
    if (character === '$' && next === '(') {
      substitutionDepth += 1;
      text += '$(';
      index += 1;
      continue;
    }
    if (substitutionDepth > 0) {
      text += character;
      if (character === '(') substitutionDepth += 1;
      if (character === ')') substitutionDepth -= 1;
      continue;
    }
    if (character === '&' && next === '&') {
      push('&&');
      index += 1;
    } else if (character === '|' && next === '|') {
      push('||');
      index += 1;
    } else if (character === '|' || character === ';' || character === '\n') {
      push(character);
    } else {
      text += character;
    }
  }
  push('');
  return segments;
}

export function shellWords(value) {
  const words = [];
  let word = '';
  let quote = '';
  let substitutionDepth = 0;
  const push = () => {
    if (word) words.push(word);
    word = '';
  };
  for (let index = 0; index < value.length; index += 1) {
    const character = value[index];
    const next = value[index + 1];
    if (quote) {
      if (character === '\\' && quote === '"' && next) {
        word += next;
        index += 1;
      } else if (character === quote) {
        quote = '';
      } else {
        word += character;
      }
      continue;
    }
    if (character === "'" || character === '"') {
      quote = character;
      continue;
    }
    if (character === '$' && next === '(') {
      substitutionDepth += 1;
      word += '$(';
      index += 1;
      continue;
    }
    if (substitutionDepth > 0) {
      word += character;
      if (character === '(') substitutionDepth += 1;
      if (character === ')') substitutionDepth -= 1;
      continue;
    }
    if (/\s/.test(character)) push();
    else if (character === '\\' && next) {
      word += next;
      index += 1;
    } else word += character;
  }
  push();
  return words;
}

function displayPath(value, home) {
  if (!value) return '';
  const normalized = path.normalize(value);
  return home && normalized === home ? '~' : home && normalized.startsWith(`${home}${path.sep}`)
    ? `~${normalized.slice(home.length)}` : normalized;
}

function resolvePath(value, cwd, home) {
  if (!value) return '';
  const expanded = value === '~' ? home : value.startsWith('~/') ? path.join(home, value.slice(2)) : value;
  if (path.isAbsolute(expanded)) return path.normalize(expanded);
  return cwd ? path.resolve(cwd, expanded) : path.normalize(expanded);
}

export function removePrefixes(words) {
  const remaining = [...words];
  while (remaining.length) {
    if (/^[A-Za-z_][A-Za-z0-9_]*=/.test(remaining[0])) {
      remaining.shift();
      continue;
    }
    if (remaining[0] === 'env' && remaining[1] === '-u') {
      remaining.shift();
      while (remaining[0] === '-u' && remaining.length >= 2) remaining.splice(0, 2);
      continue;
    }
    if (remaining[0] === 'command') {
      remaining.shift();
      if (remaining[0] === '--') remaining.shift();
      continue;
    }
    if (remaining[0] === 'time') {
      remaining.shift();
      while (remaining[0]?.startsWith('-')) remaining.shift();
      continue;
    }
    if (remaining[0] === 'sudo') {
      remaining.shift();
      while (remaining[0]?.startsWith('-')) {
        const option = remaining.shift();
        if (SUDO_OPTIONS_WITH_VALUE.has(option)) remaining.shift();
      }
      continue;
    }
    break;
  }
  return remaining;
}

function gitSubcommand(words) {
  let index = 1;
  while (index < words.length && words[index].startsWith('-')) {
    if (['-C', '-c', '--git-dir', '--work-tree'].includes(words[index])) index += 2;
    else index += 1;
  }
  return { name: words[index] || '', args: words.slice(index + 1) };
}

function plainFileArguments(program, args) {
  if (program === 'head' || program === 'tail') {
    const files = [];
    for (let index = 0; index < args.length; index += 1) {
      const argument = args[index];
      if (HEAD_TAIL_OPTIONS_WITH_VALUE.has(argument)) index += 1;
      else if (!argument.startsWith('-') && !argument.startsWith('+') && !/[<>]/.test(argument)) files.push(argument);
    }
    return files;
  }
  if (program === 'nl') {
    const files = [];
    for (let index = 0; index < args.length; index += 1) {
      const argument = args[index];
      if (NL_OPTIONS_WITH_VALUE.has(argument)) index += 1;
      else if (!argument.startsWith('-') && !/[<>]/.test(argument)) files.push(argument);
    }
    return files;
  }
  if (FILE_PROGRAMS.has(program)) {
    return args.filter(argument => !argument.startsWith('-') && !argument.startsWith('+') && !/[<>]/.test(argument));
  }
  if (program === 'sed') {
    const printOnly = args.some(argument => argument === '-n' || /^-[A-Za-z]*n[A-Za-z]*$/.test(argument));
    const candidates = args.filter(argument => !argument.startsWith('-'));
    const scriptIndex = candidates.findIndex(argument => /p(?:$|;)/.test(argument));
    return printOnly && scriptIndex >= 0
      ? candidates.slice(scriptIndex + 1).filter(argument => !/[<>]/.test(argument))
      : [];
  }
  if (program === 'jq') {
    let index = 0;
    while (index < args.length && args[index].startsWith('-')) {
      if (JQ_OPTIONS_WITH_TWO_VALUES.has(args[index])) index += 3;
      else if (JQ_OPTIONS_WITH_VALUE.has(args[index])) index += 2;
      else index += 1;
    }
    return args.slice(index + 1).filter(argument => !argument.startsWith('-') && !/[<>]/.test(argument));
  }
  if (program === 'awk') {
    let index = 0;
    while (index < args.length && args[index].startsWith('-')) {
      if (args[index] === '-v' || args[index] === '-F') index += 2;
      else index += 1;
    }
    return args.slice(index + 1).filter(argument => !argument.startsWith('-') && !/[<>]/.test(argument));
  }
  return [];
}

function fileResult(files, description) {
  // A variable or a wildcard is not a file name: keep the File kind, name it by the description.
  if (files.some(file => /[$*?]/.test(file.path))) {
    const folders = [...new Set(files.map(file => file.location).filter(location => !/[$*?]/.test(location)))];
    return { kind: "file", name: description, location: folders.length === 1 ? folders[0] : "", files };
  }
  const unique = [];
  const seen = new Set();
  for (const file of files) {
    const key = `${file.path}\u0000${file.location || ''}\u0000${file.revision || ''}`;
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(file);
  }
  if (unique.length === 1) {
    const file = unique[0];
    return { kind: 'file', name: path.basename(file.path), location: file.location, files: unique };
  }
  const locations = new Set(unique.map(file => file.location));
  const sameFolder = locations.size === 1;
  const location = sameFolder ? unique[0].location : '';
  return {
    kind: 'file',
    name: sameFolder ? `${unique.length} files in ${location}` : `${unique.length} files`,
    location,
    files: unique,
    items: unique.map(file => path.basename(file.path))
  };
}

export function classifyShellCommand(command, options = {}) {
  const home = options.home || '';
  const description = options.description || command.split('\n')[0].trim().slice(0, 60);
  const firstLine = command.split('\n')[0].trim().slice(0, 120);
  let cwd = '';
  let strongest = 'run';
  let sawProgram = false;
  let sawAction = false;
  const files = [];

  for (const segment of splitSegments(command)) {
    let words = shellWords(segment.text);
    words = removePrefixes(words);
    if (words[0] === 'cd' && words[1]) {
      cwd = resolvePath(words[1], cwd, home);
      words = words.slice(2);
      if (!words.length) continue;
    }
    words = removePrefixes(words);
    if (!words.length) continue;
    sawProgram = true;
    const program = path.basename(words[0]);
    const pipeFilter = segment.separator === '|' && PIPE_FILTERS.has(program);
    if (pipeFilter) continue;

    let segmentKind = 'run';
    const outputRedirect = /(^|\s)\d*>>?\s*/.test(segment.text);
    if (program === 'git') {
      const git = gitSubcommand(words);
      if (git.name === 'show' && !outputRedirect) {
        const object = git.args.find(argument => /^[^:]+:.+/.test(argument));
        if (object) {
          const marker = object.indexOf(':');
          const revision = object.slice(0, marker);
          const filePath = object.slice(marker + 1);
          const repo = displayPath(cwd || '.', home);
          files.push({ path: filePath, revision, location: `${repo} @ ${revision}` });
          segmentKind = 'file';
        }
      } else if (EXPLORE_GIT_SUBCOMMANDS.has(git.name)) {
        segmentKind = 'explore';
      }
    } else if (EXPLORE_PROGRAMS.has(program) || (program === 'echo' && words[1]?.startsWith('$'))) {
      segmentKind = 'explore';
    } else if (!outputRedirect && (FILE_PROGRAMS.has(program) || ['sed', 'jq', 'awk'].includes(program))) {
      const arguments_ = plainFileArguments(program, words.slice(1));
      if (arguments_.length) {
        for (const argument of arguments_) {
          const resolved = resolvePath(argument, cwd, home);
          files.push({ path: resolved, location: displayPath(path.dirname(resolved), home) });
        }
        segmentKind = 'file';
      }
    }
    if (segmentKind === "run" && !NEUTRAL_PROGRAMS.has(program)) sawAction = true;
    if (KIND_STRENGTH[segmentKind] > KIND_STRENGTH[strongest]) strongest = segmentKind;
  }
  // An action with a small check attached (git init && git status) is a Run. A file read still counts.
  if (strongest === "explore" && sawAction) return { kind: "run" };

  if (!sawProgram || strongest === 'run') return { kind: 'run' };
  if (strongest === 'file') return fileResult(files, description);
  return { kind: 'explore', name: description, location: firstLine };
}
