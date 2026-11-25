'use strict';

const { execFile } = require('child_process');
const { shell } = require('electron');
const { isValidAppId } = require('../shared/validate');
const logger = require('./logger');

/**
 * Launch the real Codex client through its AppsFolder identity.
 * We never hard-code a versioned WindowsApps path: AppUserModel IDs are stable across
 * updates while the executable path is not.
 */
function launchCodex(appId) {
  if (!isValidAppId(appId)) {
    return Promise.resolve({ ok: false, reason: 'invalid-app-id' });
  }
  const uri = `shell:AppsFolder\\${appId}`;

  return new Promise((resolve) => {
    execFile('explorer.exe', [uri], { windowsHide: true, timeout: 8000 }, (error) => {
      // explorer.exe returns a non-zero exit code even when the protocol handler works,
      // so we treat "no spawn error" as success and let the UI phrase it as a request.
      if (!error || error.code !== 'ENOENT') {
        logger.info(`launch requested via explorer: ${uri}`);
        resolve({ ok: true, method: 'explorer' });
        return;
      }
      shell
        .openExternal(uri)
        .then(() => resolve({ ok: true, method: 'openExternal' }))
        .catch((err) => {
          logger.error(`launch failed: ${err && err.message}`);
          resolve({ ok: false, reason: 'open-failed', message: String((err && err.message) || err) });
        });
    });
  });
}

async function openPath(target) {
  if (typeof target !== 'string' || !target) return { ok: false, reason: 'invalid-path' };
  const error = await shell.openPath(target);
  if (error) {
    logger.warn(`openPath failed: ${error}`);
    return { ok: false, reason: 'open-failed', message: error };
  }
  return { ok: true };
}

function openExternal(url) {
  if (typeof url !== 'string' || !/^https?:\/\//i.test(url)) return { ok: false, reason: 'invalid-url' };
  shell.openExternal(url).catch((err) => logger.warn(`openExternal failed: ${err && err.message}`));
  return { ok: true };
}

module.exports = { launchCodex, openPath, openExternal };
