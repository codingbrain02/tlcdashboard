export type AccessSnapshot = { generation: number; pending: boolean; blocked: boolean }
export type AccessStore = {
  read: () => Promise<AccessSnapshot>
  setBlocked: (blocked: boolean) => Promise<void>
  markSynced: (generation: number) => Promise<boolean>
  markPending: () => Promise<void>
}

// An older request may finish its Auth call after a newer reversal/rehire.
// Reconcile against the latest generation even if the newer request already
// marked itself synchronized. Otherwise a stale ban could undo a rehire.
export async function synchronizeEmployeeAccess(store: AccessStore): Promise<boolean> {
  let force = false
  try {
    for (let attempt = 0; attempt < 4; attempt++) {
      const current = await store.read()
      if (!current.pending && !force) return true
      await store.setBlocked(current.blocked)
      if (await store.markSynced(current.generation)) return true
      force = true
    }
  } catch { /* Preserve the database's access restriction and offer a retry. */ }
  try { await store.markPending() } catch { /* The caller still reports failure. */ }
  return false
}
