// Disposable CRM acceptance stub for the container smoke test; no provider credentials.
import { createServer } from 'node:http';
const events = new Map();
const clients = new Set();
createServer(async (req, res) => {
  if (req.url === '/stats') {
    res.setHeader('Content-Type', 'application/json');
    return res.end(
      JSON.stringify({
        count: events.size,
        deliveries: [...events.values()].reduce((sum, count) => sum + count, 0),
        workers: [...clients],
      }),
    );
  }
  if (req.headers['x-micro-token'] !== 'test-shared-secret') {
    res.writeHead(401);
    return res.end();
  }
  let raw = '';
  for await (const chunk of req) raw += chunk;
  const event = JSON.parse(raw);
  if (req.url === '/chat/messages/ack') {
    res.writeHead(200);
    return res.end(JSON.stringify({ data: { accepted: true } }));
  }
  if (!event.eventId || !event.externalMessageId || !event.externalContactId) {
    res.writeHead(400);
    return res.end();
  }
  events.set(event.eventId, (events.get(event.eventId) || 0) + 1);
  clients.add(req.socket.remoteAddress);
  res.writeHead(202, { 'Content-Type': 'application/json' });
  res.end(
    JSON.stringify({
      statusCode: 202,
      data: { accepted: true, eventId: event.eventId },
    }),
  );
}).listen(3003, '0.0.0.0');
