// Run only against the disposable containers described in README, never against a real account.
import assert from 'node:assert/strict';
const apps = ['http://127.0.0.1:56005', 'http://127.0.0.1:56006'];
const storeId = '458d3b15-66b8-48e0-85d6-01fca78c8fd8';
const headers = {
  'x-micro-token': 'test-shared-secret',
  'Content-Type': 'application/json',
};
for (const app of apps) {
  for (const path of ['/health', '/health/ready', '/docs']) {
    const response = await fetch(app + path);
    assert.equal(response.status, 200, `${app}${path}`);
  }
  assert.equal((await fetch(app + '/integrations')).status, 401);
}
const qr = await fetch(apps[0] + `/integrations/whatsapp/qrcode/${storeId}`, {
  headers,
});
const qrBody = await qr.json();
assert.equal(qr.status, 200, JSON.stringify(qrBody));
assert.equal(typeof qrBody.data.qrCode.base64, 'string');
console.log(
  JSON.stringify({
    qrRoute: 'ok',
    qrLength: qrBody.data.qrCode.base64.length,
    status: qrBody.data.status,
  }),
);
const webhookHeaders = {
  'x-evolution-token': 'test-webhook-secret',
  'Content-Type': 'application/json',
};
const prefix = `smoke-${Date.now()}`;
for (let n = 0; n < 25; n++) {
  const body = {
    event: 'messages.upsert',
    instance: storeId,
    data: {
      key: {
        id: `${prefix}-${n}`,
        remoteJid: '555000000000@s.whatsapp.net',
        fromMe: false,
      },
      messageTimestamp: Math.floor(Date.now() / 1000),
      message: { conversation: `Test message ${n}` },
      pushName: 'Test Buyer',
    },
  };
  const response = await fetch(
    apps[n % apps.length] + '/whatsapp/webhook/evolution',
    { method: 'POST', headers: webhookHeaders, body: JSON.stringify(body) },
  );
  assert.equal(response.status, 200);
  // Exact duplicate provider callbacks must not create a second CRM event.
  const duplicate = await fetch(
    apps[(n + 1) % apps.length] + '/whatsapp/webhook/evolution',
    { method: 'POST', headers: webhookHeaders, body: JSON.stringify(body) },
  );
  assert.equal(duplicate.status, 200);
}
let stats;
for (let n = 0; n < 35; n++) {
  stats = await (await fetch('http://127.0.0.1:56103/stats')).json();
  if (stats.count === 25) break;
  await new Promise((resolve) => setTimeout(resolve, 1000));
}
assert.equal(stats.count, 25);
assert.equal(stats.deliveries, 25);
assert.equal(
  stats.workers.length,
  2,
  'Both gateway processes must deliver jobs',
);
console.log(
  JSON.stringify({
    normalizedEvents: stats.count,
    deliveries: stats.deliveries,
    processes: stats.workers.length,
  }),
);
