// Read-only report from Meta Dataset Quality API.
const fs = require('fs');
const path = require('path');

const envPath = path.join(__dirname, '..', '.env.local');
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const match = line.match(/^([A-Z][A-Z0-9_]*)=(.*)$/);
    if (match && !process.env[match[1]]) process.env[match[1]] = match[2].replace(/^['"]|['"]$/g, '');
  }
}

const pixelId = process.env.META_PIXEL_ID || '1997557044152619';
const token = process.env.META_ACCESS_TOKEN;
if (!token || !/^\d+$/.test(pixelId)) {
  console.error('Set META_ACCESS_TOKEN and a numeric META_PIXEL_ID in .env.local');
  process.exitCode = 1;
} else {
  const url = new URL('https://graph.facebook.com/v27.0/dataset_quality');
  url.searchParams.set('dataset_id', pixelId);
  url.searchParams.set('fields', 'web{event_match_quality,acr,event_coverage,event_name}');
  fetch(url, { headers: { Authorization: 'Bearer ' + token } })
    .then(async response => {
      const body = await response.json();
      if (!response.ok || body.error) {
        throw new Error('Meta Dataset Quality API returned HTTP ' + response.status +
          (body.error && body.error.code ? ', code ' + body.error.code : ''));
      }
      const events = body.web || [];
      console.log('Dataset ' + pixelId + ': ' + events.length + ' web event types');
      for (const event of events) {
        const quality = event.event_match_quality || {};
        const score = quality.composite_score ?? quality.score ?? '—';
        console.log([event.event_name || 'Unknown', 'match quality: ' + score,
          'coverage: ' + JSON.stringify(event.event_coverage ?? '—'),
          'ACR: ' + JSON.stringify(event.acr ?? '—')].join(' | '));
      }
    })
    .catch(error => { console.error(error.message); process.exitCode = 1; });
}
