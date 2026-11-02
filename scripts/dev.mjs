#!/usr/bin/env node
/**
 * scripts/dev.mjs
 * Aks (अक्स) — Development Server Orchestration
 *
 * Concurrently spawns both backend (Express/Prisma) and frontend (Vite)
 * development processes with unified output and graceful signal forwarding.
 */

import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

const isWindows = process.platform === 'win32';
const npmCmd = isWindows ? 'npm.cmd' : 'npm';

// ANSI escape codes for clean terminal output
const colors = {
  reset: '\x1b[0m',
  cyan: '\x1b[36m',
  magenta: '\x1b[35m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  red: '\x1b[31m',
  gray: '\x1b[90m',
};

console.log(`${colors.green}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${colors.reset}`);
console.log(`${colors.green}  Aks (अक्स) — Starting Development Environment  ${colors.reset}`);
console.log(`${colors.gray}  Backend : http://localhost:5050${colors.reset}`);
console.log(`${colors.gray}  Frontend: http://localhost:5173${colors.reset}`);
console.log(`${colors.green}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${colors.reset}\n`);

const procs = [];

function startProcess(name, color, cwd, args) {
  const child = spawn(npmCmd, args, {
    cwd,
    stdio: ['inherit', 'pipe', 'pipe'],
    shell: isWindows,
  });

  const prefix = `${color}[${name}]${colors.reset} `;

  child.stdout.on('data', (chunk) => {
    const lines = chunk.toString().split('\n');
    for (let i = 0; i < lines.length; i++) {
      if (i === lines.length - 1 && lines[i] === '') continue;
      process.stdout.write(prefix + lines[i] + '\n');
    }
  });

  child.stderr.on('data', (chunk) => {
    const lines = chunk.toString().split('\n');
    for (let i = 0; i < lines.length; i++) {
      if (i === lines.length - 1 && lines[i] === '') continue;
      process.stderr.write(prefix + lines[i] + '\n');
    }
  });

  child.on('close', (code, signal) => {
    if (signal) {
      console.log(`${prefix}Terminated with signal ${signal}`);
    } else if (code !== 0 && code !== null) {
      console.log(`${prefix}Exited with code ${code}`);
      shutdown();
    }
  });

  procs.push({ name, child });
  return child;
}

let isShuttingDown = false;
function shutdown() {
  if (isShuttingDown) return;
  isShuttingDown = true;
  console.log(`\n${colors.yellow}Shutting down Aks development servers...${colors.reset}`);

  for (const { child } of procs) {
    if (child && !child.killed) {
      if (isWindows) {
        spawn('taskkill', ['/pid', child.pid, '/f', '/t']);
      } else {
        child.kill('SIGINT');
      }
    }
  }

  setTimeout(() => {
    process.exit(0);
  }, 500);
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

// Start backend and frontend
startProcess('backend', colors.cyan, path.join(rootDir, 'backend'), ['run', 'dev']);
startProcess('frontend', colors.magenta, path.join(rootDir, 'frontend'), ['run', 'dev']);
