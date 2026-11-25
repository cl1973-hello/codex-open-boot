'use strict';

const fs = require('fs');
const path = require('path');

let stream = null;
let logFile = null;

function init(dir) {
  try {
    logFile = path.join(dir, 'launcher.log');
    if (fs.existsSync(logFile) && fs.statSync(logFile).size > 1024 * 1024) {
      fs.renameSync(logFile, path.join(dir, 'launcher.prev.log'));
    }
    stream = fs.createWriteStream(logFile, { flags: 'a' });
    log('info', '--- session start ---');
  } catch {
    stream = null;
  }
}

function log(level, message) {
  const line = `${new Date().toISOString()} [${level}] ${message}`;
  if (level === 'error') console.error(line);
  else if (level === 'warn') console.warn(line);
  else console.log(line);
  if (stream) {
    try {
      stream.write(line + '\n');
    } catch {
      /* ignore */
    }
  }
}

module.exports = {
  init,
  info: (m) => log('info', m),
  warn: (m) => log('warn', m),
  error: (m) => log('error', m),
  get path() {
    return logFile;
  },
};
