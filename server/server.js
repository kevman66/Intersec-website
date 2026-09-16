require('dotenv').config();
const express = require('express');

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 3001;
const BREVO_API_KEY = process.env.BREVO_API_KEY;
const FROM_EMAIL = process.env.FROM_EMAIL || 'forms@intersecug.com';
const TO_EMAIL = process.env.TO_EMAIL || 'info@intersecug.com';

if (!BREVO_API_KEY) {
  console.error('Missing BREVO_API_KEY environment variable.');
  process.exit(1);
}

const SERVICE_OPTIONS = new Set([
  'Armed & Unarmed Guarding',
  'Electronic Surveillance & CCTV',
  'Private Investigations & Tracking',
  'Escort Services',
  'VIP Protection',
  'Event Security',
  'Asset Protection',
  'Other / Not Sure'
]);

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

async function sendViaBrevo({ toEmail, replyToEmail, subject, text, html }) {
  const res = await fetch('https://api.brevo.com/v3/smtp/email', {
    method: 'POST',
    headers: {
      accept: 'application/json',
      'content-type': 'application/json',
      'api-key': BREVO_API_KEY
    },
    body: JSON.stringify({
      sender: { name: 'Intersec Website', email: FROM_EMAIL },
      to: [{ email: toEmail }],
      replyTo: { email: replyToEmail },
      subject,
      textContent: text,
      htmlContent: html
    })
  });

  if (!res.ok) {
    const errorBody = await res.text().catch(() => '');
    throw new Error(`Brevo API responded ${res.status}: ${errorBody}`);
  }
}

app.post('/api/contact', async (req, res) => {
  try {
    const { name, phone, email, service, message, _hp } = req.body || {};

    // honeypot: real users never fill this hidden field, bots often do
    if (_hp) return res.json({ ok: true });

    if (!name || !phone || !email || !message) {
      return res.status(400).json({ ok: false, error: 'Missing required fields.' });
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return res.status(400).json({ ok: false, error: 'Invalid email address.' });
    }

    const safeService = SERVICE_OPTIONS.has(service) ? service : 'Other / Not Sure';

    await sendViaBrevo({
      toEmail: TO_EMAIL,
      replyToEmail: email,
      subject: `New enquiry from intersecug.com — ${name}`,
      text:
        `New contact form submission\n\n` +
        `Name: ${name}\n` +
        `Phone: ${phone}\n` +
        `Email: ${email}\n` +
        `Service: ${safeService}\n\n` +
        `Message:\n${message}\n`,
      html:
        `<h2>New contact form submission</h2>` +
        `<p><strong>Name:</strong> ${escapeHtml(name)}</p>` +
        `<p><strong>Phone:</strong> ${escapeHtml(phone)}</p>` +
        `<p><strong>Email:</strong> ${escapeHtml(email)}</p>` +
        `<p><strong>Service:</strong> ${escapeHtml(safeService)}</p>` +
        `<p><strong>Message:</strong><br>${escapeHtml(message).replace(/\n/g, '<br>')}</p>`
    });

    res.json({ ok: true });
  } catch (err) {
    console.error('Contact form error:', err);
    res.status(500).json({ ok: false, error: 'Failed to send message.' });
  }
});

app.get('/api/health', (req, res) => res.json({ ok: true }));

if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`Intersec contact API listening on port ${PORT}`);
  });
}

module.exports = app;
