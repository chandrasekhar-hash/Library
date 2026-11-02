/**
 * Database Safety Guard for Aks (अक्स) Test Infrastructure
 *
 * Prevents accidental destructive setup, broad deletions, or test pollution
 * against development ('aks_db') or production databases.
 */

export class DatabaseSafetyError extends Error {
  constructor(message) {
    super(message);
    this.name = 'DatabaseSafetyError';
    this.code = 'DATABASE_SAFETY_VIOLATION';
  }
}

/**
 * Extracts database name from PostgreSQL connection URL.
 *
 * @param {string} url
 * @returns {string} Database name or empty string
 */
export function extractDatabaseName(url) {
  if (!url || typeof url !== 'string') return '';
  try {
    // Format: postgresql://[user[:password]@][netloc][:port][/dbname][?param1=value1&...]
    const parsed = new URL(url);
    const pathname = parsed.pathname.replace(/^\//, '');
    return pathname.split('?')[0].trim();
  } catch {
    // Fallback regex if URL parsing fails on custom protocols
    const match = url.match(/\/([a-zA-Z0-9_\-]+)(\?.*)?$/);
    return match ? match[1].trim() : '';
  }
}

/**
 * Asserts that the provided connection URL points to a dedicated test database.
 * Throws DatabaseSafetyError if the database is not explicitly a test database.
 *
 * Accepted test database naming conventions:
 * - Ends with '_test' (e.g. 'aks_test', 'aks_db_test')
 * - Starts with 'test_' (e.g. 'test_aks_db')
 * - Contains '_test_'
 *
 * Explicitly refused:
 * - 'aks_db' (Default development DB)
 * - 'postgres'
 * - 'production'
 * - Any database without an explicit 'test' identifier
 *
 * @param {string} [databaseUrl] - Connection string (defaults to process.env.DATABASE_URL)
 * @param {string} [operation='Destructive test setup']
 */
export function assertTestDatabase(databaseUrl = process.env.DATABASE_URL, operation = 'Destructive test setup') {
  if (!databaseUrl) {
    throw new DatabaseSafetyError(
      `[DATABASE SAFETY VIOLATION] ${operation} refused: DATABASE_URL is undefined or empty.`
    );
  }

  const dbName = extractDatabaseName(databaseUrl);

  if (!dbName) {
    throw new DatabaseSafetyError(
      `[DATABASE SAFETY VIOLATION] ${operation} refused: Unable to extract database name from DATABASE_URL.`
    );
  }

  // Strictly reject development and production database names
  const blockedNames = ['aks_db', 'postgres', 'production', 'aks_prod', 'aks_production', 'main'];
  if (blockedNames.includes(dbName.toLowerCase())) {
    throw new DatabaseSafetyError(
      `[DATABASE SAFETY VIOLATION] ${operation} refused against protected database "${dbName}". Destructive operations are strictly prohibited on non-test environments.`
    );
  }

  // Must match safe test database naming conventions
  const isTestDb =
    dbName.toLowerCase().endsWith('_test') ||
    dbName.toLowerCase().startsWith('test_') ||
    dbName.toLowerCase().includes('_test_');

  if (!isTestDb) {
    throw new DatabaseSafetyError(
      `[DATABASE SAFETY VIOLATION] ${operation} refused against database "${dbName}". Test suites must target an isolated test database (e.g., aks_db_test or test_aks).`
    );
  }

  return true;
}

/**
 * Validates that an entity being targeted for deletion/cleanup in a test
 * belongs strictly to a tracked test entity (e.g. test prefix or test registry).
 *
 * @param {string} entityId - ID of entity to clean up
 * @param {Set<string>|Array<string>} allowedTestIds - Registered test IDs
 * @param {string} [entityName='resource']
 */
export function assertTestResource(entityId, allowedTestIds, entityName = 'resource') {
  if (!entityId) {
    throw new DatabaseSafetyError(`[DATABASE SAFETY VIOLATION] Cannot delete unverified ${entityName}: entityId is missing.`);
  }

  const isAllowed = allowedTestIds instanceof Set
    ? allowedTestIds.has(entityId)
    : Array.isArray(allowedTestIds) && allowedTestIds.includes(entityId);

  if (!isAllowed) {
    throw new DatabaseSafetyError(
      `[DATABASE SAFETY VIOLATION] Refusing to delete non-test ${entityName} with ID "${entityId}". Only explicitly registered test entities may be modified or deleted by test harnesses.`
    );
  }

  return true;
}

