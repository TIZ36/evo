# HTTP API

The Cordis plugin registers HTTP endpoints on the DSH web server when the `webServer` service is present. These endpoints are the integration surface for external tools and the web panel.

## Base Path

All endpoints are served under `/evo/`. The pre-rename path `/evo-memory/` is still mounted as an alias for backward compatibility.

The web server binds to loopback by default. All responses are JSON.

## Endpoints

### GET /evo/status

Returns service status.

**Response:**

```json
{
  "ok": true,
  "databasePath": "~/Library/Application Support/evo/memory.db",
  "busy": false
}
```

| Field | Type | Description |
| --- | --- | --- |
| `ok` | boolean | Service is operational |
| `databasePath` | string | Path to SQLite database |
| `busy` | boolean | Reflection or consolidation in progress |

### GET /evo/memories

Lists memory items with optional filtering.

**Query Parameters:**

| Parameter | Type | Description |
| --- | --- | --- |
| `scopeType` | string | Filter by scope type: `global`, `project`, etc. |
| `scopeId` | string | Filter by scope identifier |
| `scopeKey` | string | Combined scope filter |
| `kind` | string | Comma-separated list of kinds: `fact,constraint` |
| `text` | string | Full-text search |
| `tags` | string | Tag filter |
| `limit` | number | Maximum items to return |

**Response:**

```json
{
  "items": [
    {
      "id": "abc123",
      "scope": { "type": "project", "id": "~/projects/myapp" },
      "kind": "fact",
      "title": "Database uses PostgreSQL",
      "content": "The project uses PostgreSQL 15 with...",
      "tags": ["database", "infrastructure"],
      "source": { "session": "sess_xyz", "turn": 5 },
      "createdAt": "2026-08-01T10:00:00Z",
      "updatedAt": "2026-08-15T14:30:00Z",
      "uses": 12
    }
  ]
}
```

### GET /evo/memories/:id

Returns a single memory item.

**Response:** Same structure as items in the list, or 404 if not found.

### GET /evo/scopes

Returns the scope tree with item counts.

**Response:**

```json
{
  "scopes": [
    {
      "type": "global",
      "id": null,
      "count": 15
    },
    {
      "type": "project",
      "id": "~/projects/myapp",
      "count": 43
    }
  ]
}
```

### GET /evo/events

Returns recent activity log (reflects, consolidations, imports).

**Query Parameters:**

| Parameter | Type | Description |
| --- | --- | --- |
| `limit` | number | Maximum events to return (newest first) |

**Response:**

```json
{
  "events": [
    {
      "type": "reflect",
      "timestamp": "2026-08-15T14:30:00Z",
      "scope": { "type": "project", "id": "~/projects/myapp" },
      "added": 2,
      "updated": 1,
      "evicted": 0
    }
  ]
}
```

### POST /evo/consolidate

Triggers consolidation for a scope. Consolidation merges related memories, removes duplicates, and enforces capacity limits.

**Request Body:**

```json
{
  "scope": {
    "type": "project",
    "id": "~/projects/myapp"
  }
}
```

**Response:**

```json
{
  "ok": true,
  "before": 45,
  "after": 32,
  "merged": 8,
  "evicted": 5
}
```

### POST /evo/import-workspace

Triggers workspace file import for a directory.

**Request Body:**

```json
{
  "cwd": "~/projects/myapp",
  "force": false
}
```

| Field | Type | Description |
| --- | --- | --- |
| `cwd` | string | Working directory to import |
| `force` | boolean | Re-import even if already imported |

**Response:**

```json
{
  "ok": true,
  "imported": 5,
  "updated": 2,
  "skipped": 1
}
```

## Error Responses

Errors return appropriate HTTP status codes with a JSON body:

```json
{
  "error": "Scope not found",
  "code": "SCOPE_NOT_FOUND"
}
```

## Usage Example

```bash
# Check status
curl http://localhost:3000/evo/status

# List project memories
curl "http://localhost:3000/evo/memories?scopeType=project&scopeId=~/projects/myapp"

# Search for constraints
curl "http://localhost:3000/evo/memories?kind=constraint&text=test"

# Trigger consolidation
curl -X POST http://localhost:3000/evo/consolidate \
  -H "Content-Type: application/json" \
  -d '{"scope": {"type": "project", "id": "~/projects/myapp"}}'
```
