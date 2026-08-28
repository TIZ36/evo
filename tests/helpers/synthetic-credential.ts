/**
 * Test helper for assembling credential fixtures at runtime.
 *
 * By splitting credential-shaped strings into fragments, repo secret scanners
 * (like GitGuardian) never see complete tokens in source. The assembled runtime
 * strings still match evo's credential scanner patterns for testing purposes.
 */

/** Join fragments at runtime so repo secret scanners never see a complete token in source. */
export function syntheticCredential(parts: readonly string[]): string {
  return parts.join('')
}

/** Join JWT segments at runtime (header.payload.signature). */
export function syntheticJwt(header: string, payload: string, signature: string): string {
  return `${header}.${payload}.${signature}`
}
