/**
 * In-memory per-user serialization lock.
 * Serializes mutating operations involving user assets and preferences (e.g. asset deletion
 * and preference updates attaching/detaching assets) to eliminate race conditions and
 * prevent orphan assets or broken references during concurrent requests.
 */
const userLocks = new Map();

export async function withUserLock(userId, fn) {
  const currentLock = userLocks.get(userId) || Promise.resolve();
  let releaseLock;
  const newLock = new Promise((resolve) => {
    releaseLock = resolve;
  });
  userLocks.set(userId, currentLock.then(() => newLock, () => newLock));

  try {
    await currentLock;
    return await fn();
  } finally {
    releaseLock();
    if (userLocks.get(userId) === newLock) {
      userLocks.delete(userId);
    }
  }
}
