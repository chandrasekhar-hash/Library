#!/usr/bin/env node
/**
 * bootstrapOwner.js
 * Controlled one-time Owner bootstrap procedure for Aks (अक्स)
 * Phase: ACCOUNT-1A
 *
 * Usage:
 *   node backend/src/scripts/bootstrapOwner.js --email user@example.com
 *   npm run bootstrap:owner -- --email user@example.com
 */

import { prisma } from '../services/prisma.js';
import { AccountRelationshipService } from '../services/accountRelationshipService.js';

async function main() {
  const args = process.argv.slice(2);
  let emailArg = null;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--email' || args[i] === '-e') {
      emailArg = args[i + 1];
      break;
    } else if (!args[i].startsWith('-') && !emailArg) {
      emailArg = args[i];
    }
  }

  if (!emailArg) {
    console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('  Aks (अक्स) — Controlled Owner Account Bootstrap');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

    const users = await prisma.user.findMany({
      select: { id: true, name: true, email: true, role: true, createdAt: true },
      orderBy: { createdAt: 'asc' },
    });

    if (users.length === 0) {
      console.log('ℹ No registered accounts exist in the database.');
      console.log('  Register an account first via the UI or API, then run this bootstrap script.\n');
      process.exit(1);
    }

    const currentOwner = users.find((u) => u.role === 'OWNER');
    if (currentOwner) {
      console.log(`✓ Active Owner already established: ${currentOwner.name} (${currentOwner.email})`);
      console.log('  Only one Owner account is permitted.\n');
      process.exit(0);
    }

    console.log('Existing registered accounts:');
    users.forEach((u, idx) => {
      console.log(`  [${idx + 1}] ${u.name} — ${u.email} (Current Role: ${u.role})`);
    });

    console.log('\nTo establish an Owner account, run:');
    console.log('  npm run bootstrap:owner -- --email <email>\n');
    process.exit(1);
  }

  try {
    const result = await AccountRelationshipService.bootstrapOwnerAccount(emailArg);
    console.log(`\n✓ ${result.message}`);
    console.log(`  User ID: ${result.user.id}`);
    console.log(`  Role   : ${result.user.role}\n`);
    process.exit(0);
  } catch (err) {
    console.error(`\n✖ Error during Owner bootstrap: ${err.message}\n`);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

main();

