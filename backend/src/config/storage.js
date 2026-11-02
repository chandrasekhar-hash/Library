import fs from 'fs';
import path from 'path';
import { env } from './env.js';

export const storagePaths = {
  root: env.STORAGE_ROOT,
  pdfs: path.join(env.STORAGE_ROOT, 'pdfs'),
  backgrounds: path.join(env.STORAGE_ROOT, 'backgrounds'),
  covers: path.join(env.STORAGE_ROOT, 'covers'),
  temp: path.join(env.STORAGE_ROOT, 'temp'),
};

/**
 * Initializes private storage directories on server boot.
 * Files in these directories are never exposed as static web assets.
 * Enforces restrictive 0700 permissions (owner-only rwx).
 */
export function initStorage() {
  Object.values(storagePaths).forEach((dirPath) => {
    if (!fs.existsSync(dirPath)) {
      fs.mkdirSync(dirPath, { recursive: true, mode: 0o700 });
    }
    try {
      fs.chmodSync(dirPath, 0o700);
    } catch {
      // ignore in environments without POSIX chmod support
    }
  });
}
