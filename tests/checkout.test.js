const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const vm = require('node:vm');
const { calculateCart } = require('../api/_catalog');
const { purchaseEvent } = require('../api/_meta');
const codCheckout = require('../api/cod-checkout');

function response() {
  return {
    statusCode: 200,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; }
  };
}

test('homepage inline scripts parse', () => {
  const html = fs.readFileSync(require.resolve('../index.html'), 'utf8');
  for (const match of html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/gi)) {
    if (match[1].trim()) new vm.Script(match[1]);
  }
});

test('server calculates product discounts only for individual teas', () => {
  const order = calculateCart([{ key: 'sleep', qty: 2 }, { key: 'bundle', qty: 1 }], 'regina');
  assert.equal(order.subtotal, 2080);
  assert.equal(order.discount, 176);
  assert.equal(order.total, 1904);
  assert.throws(() => calculateCart([{ key: 'sleep', qty: 1 }, { key: 'sleep', qty: 1 }]));
  assert.throws(() => calculateCart([{ key: 'sleep', qty: 1.5 }]));
});

test('Meta event uses order ID and hashes personal identifiers', () => {
  const event = purchaseEvent({ orderId: 'LK1234567890123', total: 440,
    items: [{ key: 'sleep', qty: 1, price: 440 }], name: 'Іван Петренко',
    phone: '+380 99 123 45 67', tracking: { ip: '1.2.3.4', userAgent: 'browser', fbp: 'fb.1.1.1' } });
  assert.equal(event.event_name, 'Purchase');
  assert.equal(event.event_id, 'LK1234567890123');
  assert.equal(event.custom_data.value, 440);
  assert.equal(event.user_data.ph[0], crypto.createHash('sha256').update('380991234567').digest('hex'));
  assert.equal(event.user_data.client_user_agent, 'browser');
  assert.equal(event.user_data.fbp, 'fb.1.1.1');
  assert.equal(JSON.stringify(event).includes('+380'), false);
});

test('COD checkout saves server-priced order then sends same event ID to Meta', async () => {
  const oldFetch = global.fetch;
  const oldToken = process.env.META_ACCESS_TOKEN;
  process.env.META_ACCESS_TOKEN = 'test-token';
  const calls = [];
  global.fetch = async (url, options) => {
    calls.push({ url, options });
    return { ok: true, status: 200, json: async () => ({ events_received: 1 }) };
  };
  try {
    const req = { method: 'POST', headers: { cookie: '_fbp=fb.1.1.1', 'user-agent': 'browser' },
      body: { name: 'Іван Петренко', phone: '+380991234567', city: 'Київ', delivery: 'НП 1',
        items: [{ key: 'sleep', qty: 1, price: 1 }], promo: null } };
    const res = response();
    await codCheckout(req, res);
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.total, 440);
    assert.equal(calls.length, 2);
    const sheet = JSON.parse(calls[0].options.body);
    const meta = JSON.parse(calls[1].options.body).data[0];
    assert.ok(sheet.product.includes(res.body.order_id));
    assert.equal(meta.event_id, res.body.order_id);
    assert.equal(meta.custom_data.value, res.body.total);
  } finally {
    global.fetch = oldFetch;
    if (oldToken === undefined) delete process.env.META_ACCESS_TOKEN;
    else process.env.META_ACCESS_TOKEN = oldToken;
  }
});

test('COD checkout rejects invalid cart without creating an order', async () => {
  const res = response();
  await codCheckout({ method: 'POST', body: { name: 'Іван', phone: '+380991234567', city: 'Київ',
    delivery: 'НП 1', items: [{ key: 'unknown', qty: 1 }] } }, res);
  assert.equal(res.statusCode, 400);
});

test('NovaPay callback sends Purchase only for verified paid session', async () => {
  const modulePath = require.resolve('../api/_novapay');
  const callbackPath = require.resolve('../api/novapay-callback');
  const originalModule = require.cache[modulePath];
  const oldFetch = global.fetch;
  const oldToken = process.env.META_ACCESS_TOKEN;
  const oldMerchant = process.env.NOVAPAY_MERCHANT_ID;
  const oldSheet = process.env.APPS_SCRIPT_URL;
  const oldTg = process.env.TELEGRAM_TOKEN;
  const sessionId = '123e4567-e89b-12d3-a456-426614174000';
  const calls = [];
  let paid = false;
  require.cache[modulePath] = { exports: { novaPayRequest: async () => ({
    id: sessionId, status: paid ? 'paid' : 'pending', amount: 440,
    metadata: { order_id: 'LK1234567890123456', total: 440, summary: 'Sleep Aid Tea x1',
      name: 'Іван Петренко', phone: '+380991234567',
      items: [{ key: 'sleep', qty: 1, price: 440 }], tracking: { userAgent: 'browser' } }
  }) } };
  delete require.cache[callbackPath];
  const callback = require('../api/novapay-callback');
  process.env.META_ACCESS_TOKEN = 'test-token';
  process.env.NOVAPAY_MERCHANT_ID = 'test-merchant';
  delete process.env.APPS_SCRIPT_URL;
  delete process.env.TELEGRAM_TOKEN;
  global.fetch = async (url, options) => {
    calls.push({ url, options });
    return { ok: true, status: 200, json: async () => ({ events_received: 1 }) };
  };
  try {
    const req = { method: 'POST', body: { id: sessionId } };
    const pendingRes = response();
    await callback(req, pendingRes);
    assert.equal(pendingRes.body.ignored, true);
    assert.equal(calls.length, 0);

    paid = true;
    const paidRes = response();
    await callback(req, paidRes);
    assert.equal(paidRes.statusCode, 200);
    assert.equal(calls.length, 1);
    assert.equal(JSON.parse(calls[0].options.body).data[0].event_id, 'LK1234567890123456');
  } finally {
    global.fetch = oldFetch;
    if (oldToken === undefined) delete process.env.META_ACCESS_TOKEN; else process.env.META_ACCESS_TOKEN = oldToken;
    if (oldMerchant === undefined) delete process.env.NOVAPAY_MERCHANT_ID; else process.env.NOVAPAY_MERCHANT_ID = oldMerchant;
    if (oldSheet === undefined) delete process.env.APPS_SCRIPT_URL; else process.env.APPS_SCRIPT_URL = oldSheet;
    if (oldTg === undefined) delete process.env.TELEGRAM_TOKEN; else process.env.TELEGRAM_TOKEN = oldTg;
    if (originalModule) require.cache[modulePath] = originalModule; else delete require.cache[modulePath];
    delete require.cache[callbackPath];
  }
});
