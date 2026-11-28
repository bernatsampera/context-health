// Map collection and scoring are synchronous. Keep the HTTP loop available
// for status and requests for other projects while a local operation runs.
import { parentPort, workerData } from 'node:worker_threads';
import {
  cancelRefactor, createChildVersion, createVersion, inspectVersion, readVersionReport, reviewRefactor, saveRefactor, startRefactor, updateVersion
} from './map-versions.mjs';
import { renderVersionReport } from './version-report.mjs';

const operations = {
  capture: createVersion, update: updateVersion, investigate: inspectVersion, child: createChildVersion,
  'refactor-start': startRefactor, 'refactor-review': reviewRefactor, 'refactor-save': saveRefactor,
  'refactor-cancel': cancelRefactor,
  'version-report': options => {
    const report = readVersionReport(options);
    return { html: renderVersionReport(report), cacheKey: report.cacheKey };
  }
};
try {
  const value = operations[workerData.kind](workerData.options);
  parentPort.postMessage({ value });
} catch (error) {
  parentPort.postMessage({ error: error.message, status: error.status });
}
