/**
 * Structured logger — emits JSON lines so logs are parseable by
 * monitoring tools (CloudWatch, Datadog, Render log drains).
 *
 * Every log line has: timestamp, level, route, and any extra fields.
 * This makes it possible to filter, alert, and build dashboards on top.
 */

function log(level, route, data = {}) {
  const entry = {
    timestamp: new Date().toISOString(),
    level,
    route,
    ...data,
  };
  if (level === 'error') {
    console.error(JSON.stringify(entry));
  } else {
    console.log(JSON.stringify(entry));
  }
}

const logger = {
  info:  (route, data) => log('info',  route, data),
  warn:  (route, data) => log('warn',  route, data),
  error: (route, data) => log('error', route, data),
};

module.exports = logger;
