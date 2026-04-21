/**
 * Integration tests for POST /ask
 * Mocks: Groq (openai), Cohere (embed), MongoDB (mongoose)
 * so no real network calls are made.
 */

// Must set env vars before any module is loaded (getClient() guards on GROQ_API_KEY)
process.env.GROQ_API_KEY = 'test-groq-key';
process.env.JWT_SECRET = 'test-jwt-secret';

// Must mock before requiring the app
jest.mock('openai', () => {
  const mockStream = {
    [Symbol.asyncIterator]: async function* () {
      yield { choices: [{ delta: { content: 'Hello' } }] };
      yield { choices: [{ delta: { content: ' there' } }] };
    },
  };
  return {
    OpenAI: jest.fn().mockImplementation(() => ({
      chat: {
        completions: {
          create: jest.fn().mockResolvedValue(mockStream),
        },
      },
    })),
  };
});

jest.mock('../../utils/retrieve', () => ({
  retrieveRelevantChunks: jest.fn().mockResolvedValue([
    { text: 'Condoms are 98% effective', source: 'NHS', url: '', topic: 'contraception', score: 0.92 },
  ]),
  formatChunksAsContext: jest.fn().mockReturnValue('\n\nVerified health information from trusted sources:\n- "Condoms are 98% effective" (NHS)'),
}));

jest.mock('../../utils/mongodb', () => jest.fn().mockResolvedValue(undefined));

const request = require('supertest');
const express = require('express');
const askRoute = require('../../routes/ask');

const app = express();
app.use(express.json());
app.use('/ask', askRoute);

describe('POST /ask', () => {
  test('returns 400 when userMessage is missing', async () => {
    const res = await request(app).post('/ask').send({});
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/userMessage is required/i);
  });

  test('returns 400 when userMessage is blank', async () => {
    const res = await request(app).post('/ask').send({ userMessage: '   ' });
    expect(res.status).toBe(400);
  });

  test('streams SSE response with tokens for valid message', async () => {
    const res = await request(app)
      .post('/ask')
      .send({ userMessage: 'What is a condom?' })
      .buffer(true)
      .parse((res, callback) => {
        let data = '';
        res.on('data', chunk => { data += chunk.toString(); });
        res.on('end', () => callback(null, data));
      });

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/text\/event-stream/);
    expect(res.body).toContain('data:');
    expect(res.body).toContain('[DONE]');
  });

  test('includes token content in SSE stream', async () => {
    const res = await request(app)
      .post('/ask')
      .send({ userMessage: 'Tell me about STIs' })
      .buffer(true)
      .parse((res, callback) => {
        let data = '';
        res.on('data', chunk => { data += chunk.toString(); });
        res.on('end', () => callback(null, data));
      });

    const lines = res.body.split('\n').filter(l => l.startsWith('data:') && !l.includes('[DONE]'));
    const tokens = lines.map(l => JSON.parse(l.replace('data: ', '')).token);
    expect(tokens.join('')).toBe('Hello there');
  });

  test('accepts history array and does not crash', async () => {
    const history = [
      { sender: 'You', content: 'Hi' },
      { sender: 'SERA', content: 'Hello! How can I help?' },
    ];
    const res = await request(app)
      .post('/ask')
      .send({ userMessage: 'What about condoms?', history })
      .buffer(true)
      .parse((res, callback) => {
        let data = '';
        res.on('data', chunk => { data += chunk.toString(); });
        res.on('end', () => callback(null, data));
      });

    expect(res.status).toBe(200);
  });

  test('accepts profile and does not crash', async () => {
    const res = await request(app)
      .post('/ask')
      .send({ userMessage: 'Am I normal?', profile: { name: 'Alex', age: '22', identity: 'queer' } })
      .buffer(true)
      .parse((res, callback) => {
        let data = '';
        res.on('data', chunk => { data += chunk.toString(); });
        res.on('end', () => callback(null, data));
      });

    expect(res.status).toBe(200);
    expect(res.body).toContain('[DONE]');
  });
});
