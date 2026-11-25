'use strict';

const path = require('path');
const fs = require('fs');
const { pathToFileURL } = require('url');

/** Where the bundled media lives, dev vs. packaged (extraResources -> resources/media). */
function mediaDir(app) {
  return app.isPackaged
    ? path.join(process.resourcesPath, 'media')
    : path.join(__dirname, '..', '..', 'assets', 'media');
}

function userDataDir(app) {
  return app.getPath('userData');
}

function backgroundsDir(app) {
  const dir = path.join(userDataDir(app), 'backgrounds');
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function logsDir(app) {
  const dir = path.join(userDataDir(app), 'logs');
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function fileUrl(filePath) {
  if (!filePath) return null;
  try {
    return pathToFileURL(filePath).href;
  } catch {
    return null;
  }
}

/** Resolve a theme-relative media file, refusing anything that escapes the media dir. */
function resolveMedia(app, relativeName) {
  if (typeof relativeName !== 'string' || !relativeName) return null;
  const root = mediaDir(app);
  const target = path.resolve(root, relativeName);
  if (!target.startsWith(path.resolve(root) + path.sep) && path.resolve(target) !== path.resolve(root)) {
    return null;
  }
  return fs.existsSync(target) ? target : null;
}

/** Pick the first existing file among candidates (theme says video.mp4, users may keep the old name). */
function resolveFirstExisting(app, candidates) {
  for (const name of candidates) {
    const hit = resolveMedia(app, name);
    if (hit) return hit;
  }
  return null;
}

module.exports = {
  mediaDir,
  userDataDir,
  backgroundsDir,
  logsDir,
  fileUrl,
  resolveMedia,
  resolveFirstExisting,
};
