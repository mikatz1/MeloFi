'use strict';
// Worker thread: unpack the wanted files of one archive (see ./index.js).
const { parentPort, workerData } = require('node:worker_threads');
const { extractFiles } = require('./index');

try {
  const { archive, format, want } = workerData;
  const missing = extractFiles(archive, format, new Map(want));
  parentPort.postMessage({ done: true, missing });
} catch (err) {
  parentPort.postMessage({ error: String(err && err.message || err) });
}
