/**
 * Credential scanner for content safety.
 *
 * Scans text for credential-like patterns (API keys, tokens, private keys, passwords).
 * Used before writing skills, lessons, or memory content to disk.
 */

export type CredentialMatch = {
  type: string
  /** Byte offset where the match starts. */
  offset: number
  /** Length of the matched substring. */
  length: number
  /** Redacted preview (first/last 4 chars visible). */
  preview: string
}

export type ScanResult = {
  safe: boolean
  matches: CredentialMatch[]
}

/**
 * Credential patterns to detect.
 *
 * Each pattern has:
 * - type: human-readable label
 * - regex: pattern to match
 * - minLength: minimum match length to consider a real credential (avoids false positives on short strings)
 */
const CREDENTIAL_PATTERNS: Array<{ type: string; regex: RegExp; minLength?: number }> = [
  // PEM private key blocks
  { type: 'private-key', regex: /-----BEGIN\s+(?:RSA\s+)?PRIVATE\s+KEY-----[\s\S]*?-----END\s+(?:RSA\s+)?PRIVATE\s+KEY-----/gi },
  { type: 'private-key', regex: /-----BEGIN\s+EC\s+PRIVATE\s+KEY-----[\s\S]*?-----END\s+EC\s+PRIVATE\s+KEY-----/gi },
  { type: 'private-key', regex: /-----BEGIN\s+OPENSSH\s+PRIVATE\s+KEY-----[\s\S]*?-----END\s+OPENSSH\s+PRIVATE\s+KEY-----/gi },

  // Common API key patterns (provider prefixes)
  { type: 'api-key', regex: /\bsk-[a-zA-Z0-9-]{20,}/g, minLength: 25 },
  { type: 'api-key', regex: /\bAIza[a-zA-Z0-9_-]{30,}/g },
  { type: 'api-key', regex: /\bghp_[a-zA-Z0-9]{36,}/g },
  { type: 'api-key', regex: /\bgho_[a-zA-Z0-9]{36,}/g },
  { type: 'api-key', regex: /\bghr_[a-zA-Z0-9]{36,}/g },
  { type: 'api-key', regex: /\bghs_[a-zA-Z0-9]{36,}/g },
  { type: 'api-key', regex: /\bxox[baprs]-[a-zA-Z0-9-]{10,}/gi },
  { type: 'api-key', regex: /\bAKIA[A-Z0-9]{16,}/g },
  { type: 'api-key', regex: /\bnpm_[a-zA-Z0-9]{36,}/g },
  { type: 'api-key', regex: /\bpypi-[a-zA-Z0-9_-]{60,}/g },

  // Generic bearer/auth tokens with quoted values (likely config)
  { type: 'token', regex: /(?:bearer|token|auth(?:orization)?|api[_-]?key|secret)['":\s]+[=:]\s*['"]?([a-zA-Z0-9_\-/.+=]{20,})['"]?/gi, minLength: 30 },

  // Password patterns in config/env style
  { type: 'password', regex: /(?:password|passwd|pwd|secret)['":\s]*[=:]\s*['"]?([^\s'"]{8,})['"]?/gi, minLength: 15 },

  // JWT tokens (three base64 segments)
  { type: 'jwt', regex: /\beyJ[a-zA-Z0-9_-]{10,}\.[a-zA-Z0-9_-]{10,}\.[a-zA-Z0-9_-]{10,}/g },

  // Base64-encoded secrets (long base64 strings that don't look like code)
  { type: 'encoded-secret', regex: /\b[A-Za-z0-9+/]{64,}={0,2}\b/g, minLength: 64 },
]

/**
 * Known test/fixture patterns that should be ignored.
 *
 * These patterns match strings that look like credentials but are clearly
 * fixtures (e.g., "test-api-key-12345", "sk-test-...", placeholder values).
 */
const FIXTURE_PATTERNS: RegExp[] = [
  /\btest[-_]?api[-_]?key\b/i,
  /\bsk-test[-_]/i,
  /\bsk-fake[-_]/i,
  /\bsk-mock[-_]/i,
  /\b(?:fake|test|mock|dummy|sample|example|placeholder|your[-_]?)(?:[-_]?(?:api)?[-_]?key|[-_]?token|[-_]?secret)\b/i,
  /\b(?:xxx|yyy|zzz)+\b/i,
  /\bAKIAIOSFODNN7EXAMPLE\b/i,
  /\bwJalrXUtnFEMI\/K7MDENG\/bPxRfiCYEXAMPLEKEY\b/i,
  /\b0{16,}\b/,
  /\b1{16,}\b/,
  /\ba{16,}\b/i,
  // Placeholder patterns like "YOUR_API_KEY_HERE"
  /\bYOUR[-_]?[A-Z_]+[-_]?(?:HERE|KEY|TOKEN|SECRET)\b/i,
]

/** Check if a match looks like a fixture/test value. Also check for "test" within key. */
function containsTestMarker(match: string): boolean {
  return /[-_]test[-_]|[-_]fake[-_]|[-_]mock[-_]|[-_]dummy[-_]/i.test(match)
}

/**
 * Create a redacted preview of a credential.
 */
function redact(value: string): string {
  if (value.length <= 12) return '****'
  const prefix = value.slice(0, 4)
  const suffix = value.slice(-4)
  return `${prefix}...${suffix}`
}

/**
 * Check if a match looks like a fixture/test value.
 */
function isFixture(match: string): boolean {
  return FIXTURE_PATTERNS.some(pattern => pattern.test(match)) || containsTestMarker(match)
}

/**
 * Scan content for credential-like patterns.
 *
 * @param content - Text to scan
 * @returns ScanResult with safety status and any matches found
 */
export function scanForCredentials(content: string): ScanResult {
  const matches: CredentialMatch[] = []

  for (const { type, regex, minLength } of CREDENTIAL_PATTERNS) {
    const re = new RegExp(regex.source, regex.flags)
    let match: RegExpExecArray | null

    while ((match = re.exec(content)) !== null) {
      const value = match[0]

      if (minLength && value.length < minLength) continue

      if (isFixture(value)) continue

      matches.push({
        type,
        offset: match.index,
        length: value.length,
        preview: redact(value),
      })
    }
  }

  const deduped = deduplicateOverlapping(matches)

  return {
    safe: deduped.length === 0,
    matches: deduped,
  }
}

/**
 * Remove overlapping matches, keeping the longest one.
 */
function deduplicateOverlapping(matches: CredentialMatch[]): CredentialMatch[] {
  if (matches.length <= 1) return matches

  const sorted = [...matches].sort((a, b) => a.offset - b.offset || b.length - a.length)
  const result: CredentialMatch[] = []
  let lastEnd = -1

  for (const match of sorted) {
    const end = match.offset + match.length
    if (match.offset >= lastEnd) {
      result.push(match)
      lastEnd = end
    } else if (end > lastEnd) {
      const last = result[result.length - 1]
      if (last && match.length > last.length) {
        result[result.length - 1] = match
        lastEnd = end
      }
    }
  }

  return result
}

/**
 * Combined scan of multiple text fields.
 *
 * Useful for scanning all parts of a skill body or memory at once.
 */
export function scanMultiple(texts: string[]): ScanResult {
  const allMatches: CredentialMatch[] = []
  let offset = 0

  for (const text of texts) {
    const result = scanForCredentials(text)
    for (const match of result.matches) {
      allMatches.push({ ...match, offset: offset + match.offset })
    }
    offset += text.length + 1
  }

  return {
    safe: allMatches.length === 0,
    matches: allMatches,
  }
}
