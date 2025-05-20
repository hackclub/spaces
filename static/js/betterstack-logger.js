
// BetterStack Logger
const BETTERSTACK_CONFIG = {
  token: '5d1y4HBT11qEa7sp3YL69oEB',
  endpoint: 'https://s1315397.eu-nbg-2.betterstackdata.com/',
  enabled: true,
  sourceId: 'spaces_prod'
};

function logToBetterStack(data) {
  if (!BETTERSTACK_CONFIG.enabled) return;

  const payload = {
    dt: new Date().toISOString(),
    ...data
  };

  fetch(BETTERSTACK_CONFIG.endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${BETTERSTACK_CONFIG.token}`
    },
    body: JSON.stringify(payload)
  }).catch(err => {
    console.warn('Failed to send log to BetterStack:', err);
  });
}

// Log all uncaught errors to BetterStack
window.addEventListener('error', function(event) {
  const errorInfo = {
    message: event.message || 'Unknown error',
    source: event.filename || 'Unknown source',
    line: event.lineno || 0,
    column: event.colno || 0,
    stack: event.error ? event.error.stack : null,
    type: 'javascript_error',
    url: window.location.href,
    user_agent: navigator.userAgent
  };

  logToBetterStack({
    message: `JavaScript Error: ${errorInfo.message} at ${errorInfo.source}:${errorInfo.line}`,
    level: 'error',
    error: errorInfo
  });
});

// Log all unhandled promise rejections
window.addEventListener('unhandledrejection', function(event) {
  const errorInfo = {
    message: event.reason ? (event.reason.message || String(event.reason)) : 'Unknown promise rejection',
    stack: event.reason && event.reason.stack ? event.reason.stack : null,
    type: 'unhandled_promise',
    url: window.location.href,
    user_agent: navigator.userAgent
  };

  logToBetterStack({
    message: `Unhandled Promise Rejection: ${errorInfo.message}`,
    level: 'error',
    error: errorInfo
  });
});

// Export a global logger for manual logging if needed
window.betterStackLogger = {
  info: (message, data = {}) => logToBetterStack({ message, level: 'info', ...data }),
  warn: (message, data = {}) => logToBetterStack({ message, level: 'warn', ...data }),
  error: (message, data = {}) => logToBetterStack({ message, level: 'error', ...data }),
  debug: (message, data = {}) => logToBetterStack({ message, level: 'debug', ...data })
};

console.log('BetterStack logger initialized');
