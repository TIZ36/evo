import { describe, expect, it } from 'vitest'
import { scanForCredentials, scanMultiple, type ScanResult } from '../../src/core/credential-scan.js'
import { syntheticCredential, syntheticJwt } from '../helpers/synthetic-credential.js'

describe('credential scanner', () => {
  describe('scanForCredentials', () => {
    it('detects PEM private key blocks', () => {
      const content = `
Here is my key:
-----BEGIN PRIVATE KEY-----
MIIEvgIBADANBgkqhkiG9w0BAQEFAASCBKgwggSkAgEAAoIBAQDZ
...more base64...
-----END PRIVATE KEY-----
Do not share this.
`
      const result = scanForCredentials(content)
      expect(result.safe).toBe(false)
      expect(result.matches).toHaveLength(1)
      expect(result.matches[0]?.type).toBe('private-key')
    })

    it('detects RSA private key blocks', () => {
      const content = `-----BEGIN RSA PRIVATE KEY-----
MIIEowIBAAKCAQEA0Z3VS5JJcds3xfn
-----END RSA PRIVATE KEY-----`
      const result = scanForCredentials(content)
      expect(result.safe).toBe(false)
      expect(result.matches[0]?.type).toBe('private-key')
    })

    it('detects OpenSSH private keys', () => {
      const content = `-----BEGIN OPENSSH PRIVATE KEY-----
b3BlbnNzaC1rZXktdjEAAAAABG5vbmUAAAA
-----END OPENSSH PRIVATE KEY-----`
      const result = scanForCredentials(content)
      expect(result.safe).toBe(false)
      expect(result.matches[0]?.type).toBe('private-key')
    })

    it('detects API keys with common prefixes', () => {
      const apiKeys = [
        syntheticCredential(['sk-proj-', 'abc123def456ghi789jkl012mno345pqr678stu901vwx234']),
        syntheticCredential(['AIza', 'SyDaGmWKa4JsXZ-HjGw7ISLn_3namBGewQe']),
        syntheticCredential(['ghp_', '1234567890abcdefghijklmnopqrstuvwxyzAB']),
        syntheticCredential(['gho_', '1234567890abcdefghijklmnopqrstuvwxyzAB']),
        syntheticCredential(['AKIA', 'IOSFODNN7REALKEY1']),
        syntheticCredential(['npm_', '1234567890abcdefghijklmnopqrstuvwxyzAB']),
      ]

      for (const key of apiKeys) {
        const result = scanForCredentials(`Config: API_KEY=${key}`)
        expect(result.safe).toBe(false)
        expect(result.matches[0]?.type).toBe('api-key')
      }
    })

    it('detects JWT tokens', () => {
      const jwt = syntheticJwt(
        'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9',
        'eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkpvaG4gRG9lIn0',
        'Gfx6VO9tcxwk6xqx9yYzSfebfeakZp5JYIgP_edcw_A'
      )
      const result = scanForCredentials(`Bearer ${jwt}`)
      expect(result.safe).toBe(false)
      expect(result.matches[0]?.type).toBe('jwt')
    })

    it('detects password patterns', () => {
      const patterns = [
        syntheticCredential(['password', '=', '"', 'SuperSecret123!', '"']),
        syntheticCredential(['passwd', ': ', 'verysecretpassword']),
        syntheticCredential(['pwd', '=', 'my_secure_password_here']),
      ]

      for (const pattern of patterns) {
        const result = scanForCredentials(pattern)
        expect(result.safe).toBe(false)
        expect(result.matches[0]?.type).toBe('password')
      }
    })

    it('returns safe=true for clean content', () => {
      const clean = `
# Git Commit Workflow

## Purpose
Help users commit code properly.

## Steps
1. Stage changes with git add
2. Write a descriptive commit message
3. Run git commit
`
      const result = scanForCredentials(clean)
      expect(result.safe).toBe(true)
      expect(result.matches).toHaveLength(0)
    })

    it('allows fixture/test patterns', () => {
      const fixtures = [
        'test-api-key-12345',
        'sk-test-abcdefghijklmnopqrstuvwxyz1234567890',
        'sk-fake-abcdefghijklmnopqrstuvwxyz1234567890',
        'sk-mock-abcdefghijklmnopqrstuvwxyz1234567890',
        'fake-token-for-testing',
        'YOUR_API_KEY_HERE',
        'dummy_secret_placeholder',
        'AKIAIOSFODNN7EXAMPLE',
        'xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx',
        'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        '0000000000000000000000000000000000000000',
      ]

      for (const fixture of fixtures) {
        const result = scanForCredentials(`Config: ${fixture}`)
        expect(result.safe).toBe(true)
      }
    })

    it('provides redacted preview in matches', () => {
      const key = syntheticCredential(['sk-proj-', 'abc123def456ghi789jkl012mno345pqr678stu901vwx234'])
      const content = `key=${key}`
      const result = scanForCredentials(content)
      expect(result.safe).toBe(false)
      expect(result.matches[0]?.preview).toMatch(/^sk-p\.\.\.x234$/)
    })

    it('handles empty content', () => {
      const result = scanForCredentials('')
      expect(result.safe).toBe(true)
      expect(result.matches).toHaveLength(0)
    })

    it('handles content with only whitespace', () => {
      const result = scanForCredentials('   \n\t  ')
      expect(result.safe).toBe(true)
      expect(result.matches).toHaveLength(0)
    })
  })

  describe('scanMultiple', () => {
    it('scans multiple text fields', () => {
      const texts = [
        'Normal purpose text',
        syntheticCredential(['Steps: 1. Do something\n2. sk-real-', 'abc123def456ghi789jkl012mno345pqr678']),
        'Verification looks good',
      ]
      const result = scanMultiple(texts)
      expect(result.safe).toBe(false)
      expect(result.matches).toHaveLength(1)
    })

    it('returns safe for all clean texts', () => {
      const texts = [
        'Clean purpose',
        'Clean steps',
        'Clean verification',
      ]
      const result = scanMultiple(texts)
      expect(result.safe).toBe(true)
      expect(result.matches).toHaveLength(0)
    })

    it('detects credentials across multiple fields', () => {
      const texts = [
        syntheticCredential(['password', ': ', 'myActualPassword123']),
        syntheticCredential(['Also contains ghp_', '1234567890abcdefghijklmnopqrstuvwxyzAB']),
      ]
      const result = scanMultiple(texts)
      expect(result.safe).toBe(false)
      expect(result.matches.length).toBeGreaterThanOrEqual(2)
    })
  })

  describe('edge cases', () => {
    it('does not flag short random strings', () => {
      const result = scanForCredentials('sk-abc123')
      expect(result.safe).toBe(true)
    })

    it('does not flag code examples with fake keys', () => {
      const codeExample = `
\`\`\`typescript
const apiKey = process.env.API_KEY // Never hardcode: sk-test-xxx
\`\`\`
`
      const result = scanForCredentials(codeExample)
      expect(result.safe).toBe(true)
    })

    it('handles overlapping patterns', () => {
      const content = syntheticCredential(['sk-proj-', 'abc123def456ghi789jkl012mno345pqr678stu901vwx234'])
      const result = scanForCredentials(content)
      expect(result.matches).toHaveLength(1)
    })

    it('detects base64 encoded secrets', () => {
      const longBase64 = syntheticCredential([
        'QWxhZGRpbjpvcGVuIHNlc2FtZQ',
        'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAQI='
      ])
      const result = scanForCredentials(longBase64)
      expect(result.safe).toBe(false)
      expect(result.matches[0]?.type).toBe('encoded-secret')
    })

    it('does not flag normal code that looks base64-ish', () => {
      const normalCode = 'function handleClick(event) { return event.target.value }'
      const result = scanForCredentials(normalCode)
      expect(result.safe).toBe(true)
    })
  })
})
