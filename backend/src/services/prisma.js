import { PrismaClient } from '@prisma/client';
import { env } from '../config/env.js';

let prisma;

if (process.env.NODE_ENV === 'production') {
  prisma = new PrismaClient({
    log: ['error', 'warn'],
  });
} else {
  // Prevent multiple PrismaClient instances during hot-reloads in development
  if (!global.__prisma) {
    global.__prisma = new PrismaClient({
      log: ['error', 'warn'],
    });
  }
  prisma = global.__prisma;
}

export { prisma };
