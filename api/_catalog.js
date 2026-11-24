const crypto = require('crypto');

const PRODUCTS = {
  sleep:  { name: 'Sleep Aid Tea', price: 440 },
  calm:   { name: 'Keep Calm Tea', price: 440 },
  women:  { name: 'Raw Herbs for Women', price: 440 },
  bundle: { name: 'Набір "Herbs for Health" (3 чаї)', price: 1200, set: true },
  duo:    { name: 'Набір "День і Ніч" (Sleep Aid + Keep Calm)', price: 790, set: true },
  course: { name: 'Курс "День і Ніч" 7 тижнів (2× Sleep Aid + 2× Keep Calm)', price: 1490, set: true }
};

const PROMOS = { REGINA: 20, YANA: 20, OKSANA: 20 };

function calculateCart(rawItems, promo) {
  if (!Array.isArray(rawItems) || rawItems.length < 1 || rawItems.length > Object.keys(PRODUCTS).length) {
    throw new Error('Invalid cart');
  }

  const seen = new Set();
  const items = rawItems.map(it => {
    const product = it && PRODUCTS[it.key];
    const qty = it && Number(it.qty);
    if (!product || seen.has(it.key) || !Number.isInteger(qty) || qty < 1 || qty > 20) {
      throw new Error('Invalid cart item');
    }
    seen.add(it.key);
    return { key: it.key, name: product.name, qty, price: product.price, set: !!product.set };
  });

  const subtotal = items.reduce((sum, it) => sum + it.price * it.qty, 0);
  const promoCode = promo ? String(promo).trim().toUpperCase() : null;
  const promoPct = promoCode && PROMOS[promoCode] ? PROMOS[promoCode] : 0;
  const promoBase = items.filter(it => !it.set).reduce((sum, it) => sum + it.price * it.qty, 0);
  const discount = Math.round(promoBase * promoPct / 100);
  const total = subtotal - discount;
  const summary = items.map(it => it.name + ' x' + it.qty).join(', ') +
    (promoPct ? ' | Промокод ' + promoCode + ' -' + promoPct + '%' : '');

  return { items, subtotal, discount, total, promoCode, promoPct, summary };
}

function makeOrderId() {
  return 'LK' + Date.now() + crypto.randomInt(1000, 10000);
}

module.exports = { PRODUCTS, PROMOS, calculateCart, makeOrderId };
