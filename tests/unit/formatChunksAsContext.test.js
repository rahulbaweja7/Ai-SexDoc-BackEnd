const { formatChunksAsContext } = require('../../utils/retrieve');

describe('formatChunksAsContext', () => {
  test('returns empty string for empty array', () => {
    expect(formatChunksAsContext([])).toBe('');
  });

  test('includes chunk text in output', () => {
    const chunks = [{ text: 'Condoms are 98% effective', source: 'NHS', url: '', topic: 'contraception' }];
    expect(formatChunksAsContext(chunks)).toContain('Condoms are 98% effective');
  });

  test('includes source attribution', () => {
    const chunks = [{ text: 'Some fact', source: 'Planned Parenthood', url: '', topic: 'STIs' }];
    expect(formatChunksAsContext(chunks)).toContain('Planned Parenthood');
  });

  test('includes header for trusted sources', () => {
    const chunks = [{ text: 'Some fact', source: 'NHS', url: '', topic: 'general' }];
    expect(formatChunksAsContext(chunks)).toContain('Verified health information');
  });

  test('formats multiple chunks as separate lines', () => {
    const chunks = [
      { text: 'Fact A', source: 'NHS', url: '', topic: 'contraception' },
      { text: 'Fact B', source: 'Planned Parenthood', url: '', topic: 'STIs' },
    ];
    const result = formatChunksAsContext(chunks);
    expect(result).toContain('Fact A');
    expect(result).toContain('Fact B');
    const lines = result.split('\n').filter(l => l.startsWith('-'));
    expect(lines).toHaveLength(2);
  });
});
