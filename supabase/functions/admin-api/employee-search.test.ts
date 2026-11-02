import assert from 'node:assert/strict'
import { parseEmployeeSearch } from './employee-search.ts'

const employeeId = 'a43e8190-16bb-472d-be9f-7789341447ce'

Deno.test('full employee IDs use exact UUID matching, including pasted whitespace and uppercase', () => {
  for (const value of [employeeId, employeeId.toUpperCase(), ` \n${employeeId}\t `]) {
    assert.deepEqual(parseEmployeeSearch(value), { employeeId, nameWords: [] })
  }
})

Deno.test('name search keeps case, independent words, and normalized whitespace', () => {
  assert.deepEqual(parseEmployeeSearch('  Jade\tCamden  Francisco  '), {
    employeeId: null, nameWords: ['Jade', 'Camden', 'Francisco'],
  })
  assert.deepEqual(parseEmployeeSearch('Anne-Marie O\'Connor'), {
    employeeId: null, nameWords: ['Anne-Marie', "O'Connor"],
  })
})

Deno.test('empty and omitted search values keep the unfiltered directory behavior', () => {
  for (const value of ['', ' \n\t ', undefined, null, 123]) {
    assert.deepEqual(parseEmployeeSearch(value), { employeeId: null, nameWords: [] })
  }
})

Deno.test('partial and malformed IDs cannot be used as UUID equality filters', () => {
  for (const value of [employeeId.slice(0, 8), employeeId.slice(0, 35), employeeId + 'x', employeeId.replace('a', 'z')]) {
    assert.deepEqual(parseEmployeeSearch(value), { employeeId: null, nameWords: [value] })
  }
})

Deno.test('search length and word limits remain enforced', () => {
  assert.notEqual(parseEmployeeSearch('a'.repeat(80)), null)
  assert.equal(parseEmployeeSearch('a'.repeat(81)), null)
  assert.notEqual(parseEmployeeSearch('one two three four five six seven eight'), null)
  assert.equal(parseEmployeeSearch('one two three four five six seven eight nine'), null)
})

Deno.test('filter syntax and wildcard input never becomes an employee-ID filter', () => {
  for (const value of ['id.eq.' + employeeId, '),is_active.eq.true', '%_*\\', employeeId + ',id.not.is.null']) {
    assert.equal(parseEmployeeSearch(value)?.employeeId, null)
  }
})
