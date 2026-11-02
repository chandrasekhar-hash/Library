import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  assertTestDatabase,
  assertTestResource,
  extractDatabaseName,
  DatabaseSafetyError,
} from '../src/utils/testDatabaseGuard.js';

describe('Aks — Test Database Safety Guard', () => {
  test('extractDatabaseName correctly extracts db name from various connection formats', () => {
    assert.equal(
      extractDatabaseName('postgresql://cs@localhost:5432/aks_db?schema=public'),
      'aks_db'
    );
    assert.equal(
      extractDatabaseName('postgresql://user:pass@127.0.0.1:5432/aks_db_test'),
      'aks_db_test'
    );
    assert.equal(
      extractDatabaseName('postgres://postgres:secret@db.internal:5432/test_aks?sslmode=disable'),
      'test_aks'
    );
  });

  test('assertTestDatabase throws DatabaseSafetyError for default dev database "aks_db"', () => {
    assert.throws(
      () => assertTestDatabase('postgresql://cs@localhost:5432/aks_db?schema=public'),
      (err) => {
        assert(err instanceof DatabaseSafetyError);
        assert(err.message.includes('aks_db'));
        assert(err.message.includes('protected database'));
        return true;
      }
    );
  });

  test('assertTestDatabase throws DatabaseSafetyError for "postgres" or "production"', () => {
    assert.throws(
      () => assertTestDatabase('postgresql://admin@prod-host:5432/production'),
      (err) => {
        assert(err instanceof DatabaseSafetyError);
        assert(err.message.includes('production'));
        return true;
      }
    );

    assert.throws(
      () => assertTestDatabase('postgresql://admin@prod-host:5432/postgres'),
      (err) => {
        assert(err instanceof DatabaseSafetyError);
        return true;
      }
    );
  });

  test('assertTestDatabase throws DatabaseSafetyError when URL is undefined or unparseable', () => {
    assert.throws(
      () => assertTestDatabase(''),
      (err) => err instanceof DatabaseSafetyError
    );
    assert.throws(
      () => assertTestDatabase(null),
      (err) => err instanceof DatabaseSafetyError
    );
  });

  test('assertTestDatabase approves dedicated test databases', () => {
    assert.equal(
      assertTestDatabase('postgresql://cs@localhost:5432/aks_db_test?schema=public'),
      true
    );
    assert.equal(
      assertTestDatabase('postgresql://cs@localhost:5432/test_aks'),
      true
    );
    assert.equal(
      assertTestDatabase('postgresql://cs@localhost:5432/aks_test_suite'),
      true
    );
  });

  test('assertTestResource allows registered test IDs and rejects arbitrary user IDs', () => {
    const testIds = new Set(['test-book-uuid-1', 'test-book-uuid-2']);

    assert.equal(assertTestResource('test-book-uuid-1', testIds, 'Book'), true);

    assert.throws(
      () => assertTestResource('2fc57cbc-d02a-4d85-bd8f-104edd8d4e63', testIds, 'Book'),
      (err) => {
        assert(err instanceof DatabaseSafetyError);
        assert(err.message.includes('Refusing to delete non-test Book'));
        assert(err.message.includes('2fc57cbc-d02a-4d85-bd8f-104edd8d4e63'));
        return true;
      }
    );
  });
});

