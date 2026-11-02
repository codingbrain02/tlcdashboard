type EmployeeSearch = { employeeId: string | null; nameWords: string[] }

const employeeIdPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

// UUID equality uses the existing primary-key index; name searches keep their
// multi-word substring matching. No raw PostgREST filter expressions are built.
export function parseEmployeeSearch(value: unknown): EmployeeSearch | null {
  if (typeof value !== 'string') return { employeeId: null, nameWords: [] }
  const normalized = value.trim().replace(/\s+/g, ' ')
  if (normalized.length > 80) return null
  if (employeeIdPattern.test(normalized)) {
    return { employeeId: normalized.toLowerCase(), nameWords: [] }
  }
  const nameWords = normalized ? normalized.split(' ') : []
  return nameWords.length <= 8 ? { employeeId: null, nameWords } : null
}
