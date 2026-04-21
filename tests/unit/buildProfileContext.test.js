const { buildProfileContext } = require('../../routes/ask');

describe('buildProfileContext', () => {
  test('returns empty string for null profile', () => {
    expect(buildProfileContext(null)).toBe('');
  });

  test('returns empty string for empty object', () => {
    expect(buildProfileContext({})).toBe('');
  });

  test('includes name when provided', () => {
    const result = buildProfileContext({ name: 'Alex' });
    expect(result).toContain('Alex');
  });

  test('omits identity when prefer not to say', () => {
    const result = buildProfileContext({ identity: 'prefer not to say' });
    expect(result).toBe('');
  });

  test('includes identity when set', () => {
    const result = buildProfileContext({ identity: 'bisexual' });
    expect(result).toContain('bisexual');
  });

  test('omits age when prefer not to say', () => {
    const result = buildProfileContext({ age: 'prefer not to say' });
    expect(result).toBe('');
  });

  test('includes age when set', () => {
    const result = buildProfileContext({ age: '24' });
    expect(result).toContain('24');
  });

  test('includes topic when set', () => {
    const result = buildProfileContext({ topic: 'contraception' });
    expect(result).toContain('contraception');
  });

  test('combines multiple fields', () => {
    const result = buildProfileContext({ name: 'Sam', age: '22', identity: 'queer', topic: 'STIs' });
    expect(result).toContain('Sam');
    expect(result).toContain('22');
    expect(result).toContain('queer');
    expect(result).toContain('STIs');
  });

  test('starts with User profile prefix when data present', () => {
    const result = buildProfileContext({ name: 'Jordan' });
    expect(result).toMatch(/User profile:/);
  });
});
