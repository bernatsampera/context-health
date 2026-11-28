import assert from 'node:assert/strict';

// Equivalent fixture runs can use separate output and cache folders.
export const withoutRunFolders = html => html.replace(
  /(<code id="(?:rerun|old-path-cmd|fix-cmd[^"]*)">)([^<]*)(<\/code>)/g,
  (_, start, command, end) => start + command.replace(/ (--out|--cache) (?:'[^']*'|\S+)/g, ' $1 FOLDER') + end
);

// Some fixtures leave model answers missing on purpose. On the cached rerun, only those checks run.
export function assertReportExit(result, report, expected) {
  assert.equal(result.status, expected, result.stderr);
  if (expected === 2) {
    assert.ok(report.analysis.failures.length, 'the partial report includes the failed model checks');
    assert.match(result.stderr, /analysis checks? failed/);
  }
}
