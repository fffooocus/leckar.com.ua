const crypto = require('crypto');

const GRAPH_VERSION = 'v27.0';
const DEFAULT_PIXEL_ID = '1997557044152619';

function hash(value) {
  return crypto.createHash('sha256').update(String(value).trim().toLowerCase(), 'utf8').digest('hex');
}

function cookie(req, name) {
  const raw = String((req.headers && req.headers.cookie) || '');
  const part = raw.split(';').map(s => s.trim()).find(s => s.startsWith(name + '='));
  return part ? part.slice(name.length + 1) : undefined;
}

function browserContext(req) {
  const headers = req.headers || {};
  const forwarded = headers['x-forwarded-for'];
  const ip = Array.isArray(forwarded) ? forwarded[0] : String(forwarded || '').split(',')[0].trim();
  return {
    ip: ip || (req.socket && req.socket.remoteAddress) || undefined,
    userAgent: headers['user-agent'] || undefined,
    fbp: cookie(req, '_fbp'),
    fbc: cookie(req, '_fbc')
  };
}

function purchaseEvent({ orderId, total, items, name, phone, tracking }) {
  const parts = String(name || '').trim().split(/\s+/);
  const digits = String(phone || '').replace(/\D/g, '');
  const context = tracking || {};
  const userData = {};
  if (digits) userData.ph = [hash(digits)];
  if (parts[0]) userData.fn = [hash(parts[0])];
  if (parts.length > 1) userData.ln = [hash(parts.slice(1).join(' '))];
  if (context.ip) userData.client_ip_address = context.ip;
  if (context.userAgent) userData.client_user_agent = context.userAgent;
  if (context.fbp) userData.fbp = context.fbp;
  if (context.fbc) userData.fbc = context.fbc;

  return {
    event_name: 'Purchase',
    event_time: Math.floor(Date.now() / 1000),
    event_id: orderId,
    action_source: 'website',
    event_source_url: (process.env.SITE_URL || 'https://leckar.com.ua').replace(/\/$/, '') + '/',
    user_data: userData,
    custom_data: {
      currency: 'UAH',
      value: total,
      order_id: orderId,
      content_type: 'product',
      content_ids: items.map(it => it.key),
      contents: items.map(it => ({ id: it.key, quantity: it.qty, item_price: it.price }))
    }
  };
}

async function sendPurchase(details) {
  const token = process.env.META_ACCESS_TOKEN;
  if (!token) return { skipped: true };
  const pixelId = process.env.META_PIXEL_ID || DEFAULT_PIXEL_ID;
  if (!/^\d+$/.test(pixelId)) throw new Error('Invalid META_PIXEL_ID');

  const body = { data: [purchaseEvent(details)] };
  if (process.env.META_TEST_EVENT_CODE) body.test_event_code = process.env.META_TEST_EVENT_CODE;
  const response = await fetch('https://graph.facebook.com/' + GRAPH_VERSION + '/' + pixelId + '/events', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
    body: JSON.stringify(body)
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok || result.error) {
    throw new Error('Meta Conversions API error: HTTP ' + response.status +
      (result.error && result.error.code ? ', code ' + result.error.code : ''));
  }
  return result;
}

module.exports = { browserContext, purchaseEvent, sendPurchase };
