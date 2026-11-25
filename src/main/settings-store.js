'use strict';

const fs = require('fs');
const path = require('path');
const { sanitizeSettings, deepMerge } = require('../shared/defaults');

/**
 * settings.json lives in %APPDATA%/CodexOpenBoot and never inside the install dir,
 * so a portable exe / reinstall keeps the user's theme, background and window size.
 */
class SettingsStore {
  constructor(dir) {
    this.dir = dir;
    this.file = path.join(dir, 'settings.json');
    this.data = sanitizeSettings({});
    this.timer = null;
    this.lastError = null;
  }

  load() {
    try {
      if (fs.existsSync(this.file)) {
        const raw = JSON.parse(fs.readFileSync(this.file, 'utf8'));
        this.data = sanitizeSettings(raw);
      } else {
        this.data = sanitizeSettings({});
        this.saveNow();
      }
    } catch (error) {
      this.lastError = String(error && error.message);
      try {
        fs.renameSync(this.file, `${this.file}.broken`);
      } catch {
        /* ignore */
      }
      this.data = sanitizeSettings({});
    }
    return this.data;
  }

  get() {
    return this.data;
  }

  /** Shallow-deep patch; returns the sanitised result. */
  patch(patch) {
    this.data = sanitizeSettings(deepMerge(this.data, patch || {}));
    this.scheduleSave();
    return this.data;
  }

  replace(next) {
    this.data = sanitizeSettings(next || {});
    this.scheduleSave();
    return this.data;
  }

  reset() {
    this.data = sanitizeSettings({});
    this.saveNow();
    return this.data;
  }

  scheduleSave() {
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => this.saveNow(), 150);
    if (this.timer.unref) this.timer.unref();
  }

  saveNow() {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    try {
      fs.mkdirSync(this.dir, { recursive: true });
      const tmp = `${this.file}.tmp`;
      if (fs.existsSync(this.file)) {
        try {
          fs.copyFileSync(this.file, `${this.file}.bak`);
        } catch {
          /* ignore */
        }
      }
      fs.writeFileSync(tmp, JSON.stringify(this.data, null, 2), 'utf8');
      fs.renameSync(tmp, this.file);
    } catch (error) {
      this.lastError = String(error && error.message);
    }
  }
}

module.exports = { SettingsStore };
