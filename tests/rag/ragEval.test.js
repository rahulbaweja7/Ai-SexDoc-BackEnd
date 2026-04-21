/**
 * RAG evaluation set — verifies that the right topics are retrieved
 * for representative user questions.
 *
 * These tests hit real MongoDB + Cohere — skip them in CI unless
 * COHERE_API_KEY and MONGODB_URI are set.
 */

const dotenv = require('dotenv');
dotenv.config();

const SKIP = !process.env.COHERE_API_KEY || !process.env.MONGODB_URI;

const connectDatabase = require('../../utils/mongodb');
const { retrieveRelevantChunks } = require('../../utils/retrieve');

// Helper: returns true if any retrieved chunk's topic matches expected
function topicRetrieved(chunks, expectedTopic) {
  return chunks.some(c => c.topic === expectedTopic || c.text.toLowerCase().includes(expectedTopic.toLowerCase()));
}

const evalSet = [
  { question: 'How effective are condoms?',              expectedTopic: 'contraception' },
  { question: 'What are the symptoms of chlamydia?',     expectedTopic: 'STIs'          },
  { question: 'How does the pill work?',                 expectedTopic: 'contraception' },
  { question: 'Can you get an STI from oral sex?',       expectedTopic: 'STIs'          },
  { question: 'What is the morning after pill?',         expectedTopic: 'contraception' },
  { question: 'How do I know if I have an STI?',         expectedTopic: 'STIs'          },
  { question: 'What is consent in a relationship?',      expectedTopic: 'relationships' },
  { question: 'How can I get tested for HIV?',           expectedTopic: 'STIs'          },
  { question: 'What is a normal vaginal discharge?',     expectedTopic: 'anatomy'       },
  { question: 'How do I talk to my partner about sex?',  expectedTopic: 'relationships' },
];

(SKIP ? describe.skip : describe)('RAG evaluation set (requires real Cohere + MongoDB)', () => {
  beforeAll(async () => {
    await connectDatabase();
  }, 30000);

  test.each(evalSet)('retrieves $expectedTopic chunk for: "$question"', async ({ question, expectedTopic }) => {
    const chunks = await retrieveRelevantChunks(question, 3);
    expect(chunks.length).toBeGreaterThan(0);
    const hit = topicRetrieved(chunks, expectedTopic);
    if (!hit) {
      console.warn(`[RAG MISS] "${question}" — got topics: ${chunks.map(c => c.topic).join(', ')}`);
    }
    expect(hit).toBe(true);
  }, 15000);
});
