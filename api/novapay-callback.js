// api/novapay-callback.js
// NovaPay calls this after a session changes status. Callback bodies are not
// trusted: look up the session through the signed merchant API before recording
// an order or sending a notification.

const { novaPayRequest } = require('./_novapay');
const { sendPurchase } = require('./_meta');

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  try {
    const callback = req.body || {};
    const sessionId = callback.id || callback.session_id;
    if (typeof sessionId !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(sessionId)) {
      res.status(400).json({ error: 'Invalid session ID' });
      return;
    }

    const merchantId = process.env.NOVAPAY_MERCHANT_ID;
    if (!merchantId) throw new Error('NOVAPAY_MERCHANT_ID env var is not set');
    const data = await novaPayRequest('/get-status', {
      merchant_id: merchantId,
      session_id: sessionId
    });
    if (data.id !== sessionId) {
      res.status(400).json({ error: 'Session ID mismatch' });
      return;
    }

    // Only a paid session is an order. Ignore intermediate and failed statuses.
    if (String(data.status).toLowerCase() !== 'paid' ||
        (data.transaction_status && String(data.transaction_status).toUpperCase() !== 'APPROVED')) {
      res.status(200).json({ ok: true, ignored: true });
      return;
    }

    const meta = data.metadata || {};
    const total = Number(meta.total);
    const paidAmount = Number(data.amount);
    if (!/^LK\d{13,}$/.test(String(meta.order_id || '')) ||
        !meta.summary || !Number.isFinite(total) || total <= 0 ||
        !Number.isFinite(paidAmount) || Math.round(total * 100) !== Math.round(paidAmount * 100)) {
      res.status(400).json({ error: 'Verified order data mismatch' });
      return;
    }

    const telegramToken = process.env.TELEGRAM_TOKEN;
    const telegramChat = process.env.TELEGRAM_CHAT_ID;
    const appsScriptUrl = process.env.APPS_SCRIPT_URL;

    const orderId = meta.order_id;
    const summary = meta.summary;
    const name = meta.name || (data.client_first_name || '') + ' ' + (data.client_last_name || '');
    const phone = meta.phone || data.client_phone || '—';
    const city = meta.city || '—';
    const delivery = meta.delivery || '—';

    const tgMessage =
      '✅ ОПЛАЧЕНО КАРТКОЮ\n' +
      '━━━━━━━━━━━━━━━━━\n' +
      '🧾 Замовлення: ' + orderId + '\n' +
      '👤 Ім\'я: ' + name + '\n' +
      '📞 Телефон: ' + phone + '\n' +
      '📍 Місто: ' + city + '\n' +
      '🚚 Доставка: ' + delivery + '\n' +
      '📦 Товар: ' + summary + '\n' +
      '💰 Сума: ' + total + ' \u20B4\n' +
      '━━━━━━━━━━━━━━━━━\n' +
      '⏰ ' + new Date().toLocaleString('uk-UA', { timeZone: 'Europe/Kiev' });

    if (telegramToken && telegramChat) {
      await fetch('https://api.telegram.org/bot' + telegramToken + '/sendMessage', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: telegramChat, text: tgMessage })
      });
    }

    // Also log into the same Google Sheet as cash orders, if configured
    if (appsScriptUrl) {
      try {
        await fetch(appsScriptUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name: name,
            phone: "'" + phone,
            city: city,
            delivery: delivery,
            product: summary + ' | Разом: ' + total + ' \u20B4 | Оплачено карткою (NovaPay, ' + orderId + ')'
          })
        });
      } catch (e) {
        console.error('Apps Script logging failed:', e.message);
      }
    }

    if (Array.isArray(meta.items) && meta.items.length) {
      try {
        await sendPurchase({
          orderId, total, items: meta.items, name, phone,
          tracking: meta.tracking || {}
        });
      } catch (e) {
        console.error('novapay-callback Meta event failed:', e.message);
      }
    }

    res.status(200).json({ ok: true });
  } catch (err) {
    console.error('novapay-callback error:', err.message);
    res.status(502).json({ ok: false });
  }
};
