const client = require('prom-client');

const register = new client.Registry();
client.collectDefaultMetrics({ register, prefix: 'cipher_chat_' });

const httpRequestsTotal = new client.Counter({
  name: 'cipher_chat_http_requests_total',
  help: 'Total HTTP requests by method, route, and status code.',
  labelNames: ['method', 'route', 'status'],
  registers: [register],
});

const httpRequestDurationSeconds = new client.Histogram({
  name: 'cipher_chat_http_request_duration_seconds',
  help: 'HTTP request duration in seconds by method, route, and status code.',
  labelNames: ['method', 'route', 'status'],
  buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2, 5],
  registers: [register],
});

const authEventsTotal = new client.Counter({
  name: 'cipher_chat_auth_events_total',
  help: 'Authentication endpoint outcomes.',
  labelNames: ['action', 'outcome'],
  registers: [register],
});

const wsActiveConnections = new client.Gauge({
  name: 'cipher_chat_ws_active_connections',
  help: 'Currently open WebSocket connections.',
  registers: [register],
});

const wsMessagesTotal = new client.Counter({
  name: 'cipher_chat_ws_messages_total',
  help: 'WebSocket messages by direction and type.',
  labelNames: ['direction', 'type'],
  registers: [register],
});

const wsErrorsTotal = new client.Counter({
  name: 'cipher_chat_ws_errors_total',
  help: 'WebSocket errors by event.',
  labelNames: ['event'],
  registers: [register],
});

function routeLabel(req) {
  if (req.route?.path) {
    return `${req.baseUrl || ''}${req.route.path}`;
  }
  if (req.path === '/metrics' || req.path === '/healthz') return req.path;
  return 'unmatched';
}

function recordHttpRequest(req, res, durationMs) {
  const labels = {
    method: req.method,
    route: routeLabel(req),
    status: String(res.statusCode),
  };
  httpRequestsTotal.inc(labels);
  httpRequestDurationSeconds.observe(labels, durationMs / 1000);

  if (req.baseUrl === '/auth' && req.route?.path) {
    const action = String(req.route.path).replace('/', '') || 'unknown';
    authEventsTotal.inc({ action, outcome: res.statusCode < 400 ? 'success' : 'error' });
  }
}

function recordWsMessage(direction, type = 'unknown') {
  wsMessagesTotal.inc({ direction, type });
}

function recordWsError(event) {
  wsErrorsTotal.inc({ event });
}

module.exports = {
  register,
  recordHttpRequest,
  recordWsError,
  recordWsMessage,
  wsActiveConnections,
};
