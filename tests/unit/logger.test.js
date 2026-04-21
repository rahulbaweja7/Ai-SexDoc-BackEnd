const logger = require('../../utils/logger');

describe('logger', () => {
  let stdoutSpy, stderrSpy;

  beforeEach(() => {
    stdoutSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
    stderrSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test('info writes to console.log as JSON', () => {
    logger.info('/ask', { userId: 'abc', ragChunks: 3 });
    expect(stdoutSpy).toHaveBeenCalledTimes(1);
    const entry = JSON.parse(stdoutSpy.mock.calls[0][0]);
    expect(entry.level).toBe('info');
    expect(entry.route).toBe('/ask');
    expect(entry.userId).toBe('abc');
    expect(entry.ragChunks).toBe(3);
    expect(entry.timestamp).toBeDefined();
  });

  test('error writes to console.error as JSON', () => {
    logger.error('/ask', { error: 'boom' });
    expect(stderrSpy).toHaveBeenCalledTimes(1);
    const entry = JSON.parse(stderrSpy.mock.calls[0][0]);
    expect(entry.level).toBe('error');
    expect(entry.error).toBe('boom');
  });

  test('warn writes to console.log as JSON', () => {
    logger.warn('/tts', { note: 'slow' });
    expect(stdoutSpy).toHaveBeenCalledTimes(1);
    const entry = JSON.parse(stdoutSpy.mock.calls[0][0]);
    expect(entry.level).toBe('warn');
    expect(entry.route).toBe('/tts');
  });

  test('log entry is valid JSON', () => {
    logger.info('/test', { foo: 'bar' });
    expect(() => JSON.parse(stdoutSpy.mock.calls[0][0])).not.toThrow();
  });
});
