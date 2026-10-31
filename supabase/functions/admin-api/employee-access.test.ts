import { synchronizeEmployeeAccess, type AccessStore } from './employee-access.ts'

Deno.test('a late termination ban cannot overwrite a completed rehire', async () => {
  let reads = 0
  const changes: boolean[] = []
  const store: AccessStore = {
    read: async () => ++reads === 1
      ? { generation: 1, pending: true, blocked: true }
      : { generation: 2, pending: false, blocked: false },
    setBlocked: async blocked => { changes.push(blocked) },
    markSynced: async generation => generation === 2,
    markPending: async () => { throw new Error('Unexpected pending state') },
  }
  if (!await synchronizeEmployeeAccess(store) || JSON.stringify(changes) !== '[true,false]') throw new Error('Latest account state was not restored')
})

Deno.test('an Auth outage leaves an explicit retry instead of false success', async () => {
  let pending = false
  const result = await synchronizeEmployeeAccess({
    read: async () => ({ generation: 3, pending: true, blocked: true }),
    setBlocked: async () => { throw new Error('Auth unavailable') },
    markSynced: async () => { throw new Error('Must not mark a failed call complete') },
    markPending: async () => { pending = true },
  })
  if (result || !pending) throw new Error('Auth failure was hidden')
})

Deno.test('continuous competing changes leave synchronization pending', async () => {
  let pending = false
  let changes = 0
  const result = await synchronizeEmployeeAccess({
    read: async () => ({ generation: changes, pending: true, blocked: true }),
    setBlocked: async () => { changes++ },
    markSynced: async () => false,
    markPending: async () => { pending = true },
  })
  if (result || !pending || changes !== 4) throw new Error('Retry bound or pending state is incorrect')
})
