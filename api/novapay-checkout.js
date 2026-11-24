// api/novapay-checkout.js
// Called from the frontend checkout modal when the customer chooses "Оплатити карткою".
// Creates a NovaPay session, then a payment, and returns the redirect URL.

const { novaPayRequest } = require('./_novapay');
const { calculateCart, makeOrderId } = require('./_catalog');
const { browserContext } = require('./_meta');

// Серверний прайс — джерело правди для суми оплати.
// Ціни з браузера ігноруються (їх можна підмінити). Тримати в синхроні з PRODUCTS в index.html.

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  try {
    const merchantId = process.env.NOVAPAY_MERCHANT_ID;
    if (!merchantId) throw new Error('NOVAPAY_MERCHANT_ID env var is not set');

    const siteUrl = process.env.SITE_URL || 'https://leckar.com.ua';

    const body = req.body || {};
    const {
      name,
      phone,
      city,
      delivery,
      items: rawItems, // [{ key, qty }] — name/price з клієнта ігноруються
      promo
    } = body;

    if (typeof name !== 'string' || !name.trim() || typeof phone !== 'string' ||
        !/^380\d{9}$/.test(phone.replace(/\D/g, '')) ||
        typeof city !== 'string' || !city.trim() ||
        typeof delivery !== 'string' || !delivery.trim()) {
      res.status(400).json({ error: 'Missing required fields' });
      return;
    }

    let order;
    try { order = calculateCart(rawItems, promo); }
    catch (e) { res.status(400).json({ error: e.message }); return; }
    const { items, discount, total, summary } = order;

    // Split name into first/last for NovaPay's fields (best effort)
    const parts = String(name).trim().split(/\s+/);
    const firstName = parts[0] || name;
    const lastName = parts.slice(1).join(' ') || '.';

    // Unique order reference
    const orderId = makeOrderId();

    // NovaPay expects a clean phone number, e.g. +380991234567 (no spaces)
    const cleanPhone = '+' + String(phone).replace(/\D/g, '');

    // 1) Create session
    const session = await novaPayRequest('/session', {
      merchant_id: merchantId,
      client_first_name: firstName,
      client_last_name: lastName,
      client_phone: cleanPhone,
      callback_url: siteUrl + '/api/novapay-callback',
      success_url: siteUrl + '/payment-success.html',
      fail_url: siteUrl + '/payment-fail.html',
      success_redirect_timeout: 5,
      metadata: {
        order_id: orderId,
        summary: summary,
        city: city || '',
        delivery: delivery || '',
        phone: phone,
        name: name,
        total: total,
        items: items.map(it => ({ key: it.key, qty: it.qty, price: it.price })),
        tracking: browserContext(req)
      }
    });

    const sessionId = session.id;

    // 2) Create payment against that session
    const payment = await novaPayRequest('/payment', {
      merchant_id: merchantId,
      session_id: sessionId,
      amount: total,
      external_id: orderId,
      use_hold: false,
      // Якщо є знижка — одна позиція на всю суму, щоб сума товарів = amount
      products: discount > 0
        ? [{ description: summary, count: 1, price: total }]
        : items.map(function (it) {
            return { description: it.name, count: it.qty, price: it.price };
          })
    });

    res.status(200).json({ url: payment.url, order_id: orderId, total: total });
  } catch (err) {
    console.error('novapay-checkout error:', err.message, err.body || '');
    res.status(500).json({ error: 'Payment session could not be created. Please try again or pay on delivery.' });
  }
};
