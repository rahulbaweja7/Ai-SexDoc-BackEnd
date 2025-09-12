# Ai-SexDoc-BackEnd

## Backend compatibility notes

- **Endpoint**: `POST /ask`

  - Body: `{ "userMessage": "..." }`
  - Response: `{ "reply": "..." }`

- **CORS**:

  - Supports multiple origins via `FRONTEND_ORIGINS` (comma-separated), e.g.
    - `FRONTEND_ORIGINS=http://localhost:3000,http://localhost:5173`
  - If not set, defaults to `http://localhost:3000` and `http://localhost:5173`.

- **Auth**:
  - No authentication required. Do not send `Authorization` headers.

## Environment variables

Create a `.env` with:

```
PORT=3001
OPENAI_API_KEY=your_openai_key
# Optional for DB; leave unset to run without DB
MONGODB_URI=<redacted>@cluster.mongodb.net/aisexdoc
MONGODB_DB=aisexdoc
# Comma-separated allowed frontend origins
FRONTEND_ORIGINS=http://localhost:3000,http://localhost:5173
```

## Run locally

```
npm install
npm start
```

Test:

```
curl -X POST http://localhost:3001/ask \
  -H 'Content-Type: application/json' \
  -d '{"userMessage":"Hello!"}'
```
