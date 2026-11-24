const { calculateCart, makeOrderId } = require('./_catalog');
const { browserContext, sendPurchase } = require('./_meta');

const DEFAULT_APPS_SCRIPT_URL = 'https://script.google.com/macros/s/AKfycbx4b37HLa7KMuend8LwVxu4pcWbtAwu3WJdW7V6GI_VKsjdI0udjpl2U1MdhE1MzWo/exec';

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { name, phone, city, delivery, items, promo } = req.body || {};
  if (typeof name !== 'string' || !name.trim() || typeof phone !== 'string' ||
      !/^380\d{9}$/.test(phone.replace(/\D/g, '')) ||
      typeof city !== 'string' || !city.trim() ||
      typeof delivery !== 'string' || !delivery.trim()) {
    return res.status(400).json({ error: 'Missing required fields' });
  }

  let order;
  try { order = calculateCart(items, promo); }
  catch (e) { return res.status(400).json({ error: e.message }); }

  const orderId = makeOrderId();
  const scriptUrl = process.env.APPS_SCRIPT_URL || DEFAULT_APPS_SCRIPT_URL;
  const product = order.summary + ' | Разом: ' + order.total + ' ₴ | Накладений платіж (' + orderId + ')';

  try {
    const response = await fetch(scriptUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: name.trim(), phone: "'" + phone.trim(), city: city.trim(),
        delivery: delivery.trim(), product,
        promo: order.promoPct ? order.promoCode + ' (-' + order.promoPct + '%)' : '—',
        payment: 'Накладений платіж'
      })
    });
    if (!response.ok) throw new Error('Apps Script HTTP ' + response.status);
  } catch (error) {
    console.error('cod-checkout order logging failed:', error.message);
    return res.status(502).json({ error: 'Order could not be saved' });
  }

  try {
    await sendPurchase({ orderId, total: order.total, items: order.items,
      name, phone, tracking: browserContext(req) });
  } catch (error) {
    console.error('cod-checkout Meta event failed:', error.message);
  }

  return res.status(200).json({ order_id: orderId, total: order.total });
};
