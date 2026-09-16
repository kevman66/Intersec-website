require('dotenv').config();
const express = require('express');
const nodemailer = require('nodemailer');

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 3001;
const BREVO_SMTP_USER = process.env.BREVO_SMTP_USER;
const BREVO_SMTP_KEY = process.env.BREVO_SMTP_KEY;
const FROM_EMAIL = process.env.FROM_EMAIL || 'forms@intersecug.com';
const TO_EMAIL = process.env.TO_EMAIL || 'info@intersecug.com';

if (!BREVO_SMTP_USER || !BREVO_SMTP_KEY) {
  console.error('Missing BREVO_SMTP_USER or BREVO_SMTP_KEY environment variables.');
  process.exit(1);
}

const transporter = nodemailer.createTransport({
  host: 'smtp-relay.brevo.com',
  port: 587,
  secure: false, // STARTTLS on port 587
  auth: { user: BREVO_SMTP_USER, pass: BREVO_SMTP_KEY }
});

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

    await transporter.sendMail({
      from: `"Intersec Website" <${FROM_EMAIL}>`,
      to: TO_EMAIL,
      replyTo: email,
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
