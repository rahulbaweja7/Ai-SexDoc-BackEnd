/**
 * tools.js — deterministic helpers used by the SERA agent graph.
 *
 * These are intentionally NOT LLM calls: triage rules and a structured fact
 * lookup give the agent reliable, testable behaviour for the parts that must
 * not be left to generative guessing (emergencies, specific numbers).
 */

// ── Emergency triage ────────────────────────────────────────────────────────
// Signals that a message needs real, immediate help — not a chatbot answer.
const EMERGENCY_PATTERNS = [
  /heart attack|cardiac arrest/,
  /chest pain|chest tightness|pain in my chest|tight chest/,
  /can'?t breathe|cannot breathe|trouble breathing|difficulty breathing|struggling to breathe/,
  /stroke|numb (arm|face|side)|slurred speech|face drooping/,
  /seizure|seizing|convulsion/,
  /chok(e|ing)/,
  /suicid|kill myself|end my life|want to die|harm myself|hurt myself|take my (own )?life/,
  /overdose|overdosed|poison(ed|ing)?/,
  /unconscious|passed out|won'?t wake up|unresponsive/,
  /bleeding heavily|heavy bleeding|won'?t stop bleeding|lots? of blood|severe bleeding/,
  /severe (pain|allergic)|anaphyla|allergic reaction/,
  /call (911|999|112|an ambulance)|need an ambulance|emergency room/,
];

function isEmergency(text) {
  // Normalize curly/smart apostrophes to straight so "can’t" matches "can'?t".
  const t = (text || '').toLowerCase().replace(/[’‘]/g, "'");
  return EMERGENCY_PATTERNS.some((re) => re.test(t));
}

// ── Multi-part detection + split (heuristic, no LLM) ─────────────────────────
// Catches "..., and how often...?" style two-part questions.
function isMultiPart(text) {
  const t = (text || '').trim();
  if (/,\s+and\s+/i.test(t)) return true;
  if ((t.match(/\?/g) || []).length >= 2) return true;
  return false;
}

function splitParts(text) {
  const parts = text
    .split(/,\s+and\s+|\?\s+/i)
    .map((p) => p.trim().replace(/\?+$/, '').trim())
    .filter((p) => p.length > 3);
  return parts.length >= 2 ? parts : [text];
}

// ── Structured fact lookup ("tool use beyond retrieval") ─────────────────────
// A tiny verified table of the numbers that must be exact. The agent consults
// this deterministically instead of trusting the LLM to recall a percentage.
const FACT_TABLE = [
  { keys: [/combined (oral )?(contraceptive )?pill/, /the pill\b/], fact: 'Combined pill: more than 99% effective with perfect use (must be taken at the same time daily).' },
  { keys: [/mini[- ]?pill|progest/], fact: 'Progestogen-only (mini) pill: over 99% effective with perfect use; contains no oestrogen.' },
  { keys: [/condom/], fact: 'Male condoms: 98% effective with perfect use. Female condoms: 95%. Only method that also protects against STIs.' },
  { keys: [/implant/], fact: 'Contraceptive implant: more than 99% effective, lasts up to 3 years.' },
  { keys: [/morning[- ]?after|emergency contracep/], fact: 'Morning-after pill: works up to 72 hours after unprotected sex (sooner is better). Copper IUD: up to 5 days, more than 99% effective.' },
  { keys: [/prep\b|pre[- ]?exposure/], fact: 'PrEP: reduces the risk of getting HIV from sex by about 99% when taken as prescribed; does not protect against other STIs.' },
  { keys: [/\bhiv\b.*undetectable|undetectable.*\bhiv\b|u=u/], fact: 'HIV with an undetectable viral load on treatment cannot be passed on to sexual partners (U=U).' },
];

function factLookup(text) {
  const t = (text || '').toLowerCase();
  const hits = [];
  for (const row of FACT_TABLE) {
    if (row.keys.some((re) => re.test(t))) hits.push(row.fact);
  }
  return hits;
}

// ── Canned safe replies (shared by the agent graph and the /ask route) ───────
const EMERGENCY_REPLY =
  "This sounds like it may be a medical emergency, and that's beyond what I can safely help with. " +
  'Please contact emergency services right now — 911 in the US, 999 or 111 in the UK. ' +
  "If you're in crisis or thinking about harming yourself, you can call or text 988 (US Suicide & Crisis Lifeline) any time. " +
  "You deserve real help, and people who can give it are available right now.";

const DECLINE_REPLY =
  "That's a bit outside what I can help with — I focus on sexual health, relationships, contraception, " +
  "STIs, anatomy, and intimacy. If you have anything in those areas on your mind, I'm here for it, no judgment.";

module.exports = { isEmergency, isMultiPart, splitParts, factLookup, EMERGENCY_PATTERNS, EMERGENCY_REPLY, DECLINE_REPLY };
