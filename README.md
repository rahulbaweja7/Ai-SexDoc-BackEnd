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
  - Optional. Logged-in requests send a `Bearer <JWT>`; logged-out users can still chat.

## Environment variables

Copy `.env.example` to `.env` and fill in real values:

```
PORT=3001
# Required — server refuses to start without it
JWT_SECRET=your_long_random_secret
# LLM (chat) via Groq, RAG embeddings via Cohere
GROQ_API_KEY=your_groq_key
COHERE_API_KEY=your_cohere_key
# Optional — text-to-speech
ELEVENLABS_API_KEY=your_elevenlabs_key
# Google OAuth (client ID is public)
GOOGLE_CLIENT_ID=your_google_client_id
# Optional for DB; leave unset to run without DB
MONGODB_URI=mongodb+srv://<user>:<password>@cluster.mongodb.net/aisexdoc
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
