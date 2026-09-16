// Tests for the contact form API. Uses Node's built-in test runner
// (node --test) and supertest for HTTP assertions. Nodemailer is swapped
// for a fake transporter below so tests never send real email.

const test = require('node:test');
const assert = require('node:assert/strict');

// Fake env vars so server.js's startup guard passes and it doesn't try to
// talk to real Brevo servers.
process.env.BREVO_SMTP_USER = 'test-smtp-user';
process.env.BREVO_SMTP_KEY = 'test-smtp-key';
process.env.FROM_EMAIL = 'forms@intersecug.com';
process.env.TO_EMAIL = 'info@intersecug.com';

const nodemailer = require('nodemailer');
const sentMails = [];
// Replace createTransport BEFORE requiring server.js, so the transporter
// server.js builds at module load time is this fake one.
nodemailer.createTransport = () => ({
  sendMail: async (opts) => {
    sentMails.push(opts);
    return { messageId: 'fake-message-id' };
  }
});

const request = require('supertest');
const app = require('../server');

test.beforeEach(() => {
  sentMails.length = 0;
});

test('GET /api/health returns ok', async () => {
  const res = await request(app).get('/api/health');
  assert.equal(res.status, 200);
  assert.deepEqual(res.body, { ok: true });
});

test('POST /api/contact rejects missing required fields', async () => {
  const res = await request(app).post('/api/contact').send({ name: 'Test' });
  assert.equal(res.status, 400);
  assert.equal(res.body.ok, false);
  assert.equal(sentMails.length, 0);
});

test('POST /api/contact rejects an invalid email address', async () => {
  const res = await request(app).post('/api/contact').send({
    name: 'Test', phone: '123', email: 'not-an-email', message: 'hi'
  });
  assert.equal(res.status, 400);
  assert.equal(sentMails.length, 0);
});

test('POST /api/contact silently no-ops when the honeypot field is filled', async () => {
  const res = await request(app).post('/api/contact').send({
    name: 'Bot', phone: '123', email: 'bot@example.com', message: 'spam', _hp: 'filled'
  });
  assert.equal(res.status, 200);
  assert.deepEqual(res.body, { ok: true });
  assert.equal(sentMails.length, 0, 'a filled honeypot must never trigger a real send');
});

test('POST /api/contact sends an email for a valid submission', async () => {
  const res = await request(app).post('/api/contact').send({
    name: 'Kevin',
    phone: '+256700000000',
    email: 'kevin@example.com',
    service: 'Event Security',
    message: 'Need a quote for a wedding next month.'
  });

  assert.equal(res.status, 200);
  assert.deepEqual(res.body, { ok: true });
  assert.equal(sentMails.length, 1);

  const mail = sentMails[0];
  assert.equal(mail.to, 'info@intersecug.com');
  assert.equal(mail.replyTo, 'kevin@example.com');
  assert.match(mail.from, /forms@intersecug\.com/);
  assert.match(mail.subject, /Kevin/);
  assert.match(mail.text, /Event Security/);
  assert.match(mail.text, /Need a quote for a wedding next month\./);
});

test('POST /api/contact falls back to "Other / Not Sure" for an unrecognized service value', async () => {
  const res = await request(app).post('/api/contact').send({
    name: 'Kevin',
    phone: '+256700000000',
    email: 'kevin@example.com',
    service: 'Something made up',
    message: 'Need a quote.'
  });

  assert.equal(res.status, 200);
  assert.match(sentMails[0].text, /Other \/ Not Sure/);
});

test('POST /api/contact escapes HTML in submitted fields', async () => {
  const res = await request(app).post('/api/contact').send({
    name: '<script>alert(1)</script>',
    phone: '123',
    email: 'x@example.com',
    message: 'hello <b>world</b>'
  });

  assert.equal(res.status, 200);
  const mail = sentMails[0];
  assert.ok(!mail.html.includes('<script>'), 'raw <script> tag must not reach the HTML email body');
  assert.ok(mail.html.includes('&lt;script&gt;'), 'the tag should be escaped instead');
});

test('POST /api/contact returns 500 and does not crash when sending fails', async () => {
  const original = nodemailer.createTransport;
  // Force the next require of a fresh app instance to use a throwing transporter.
  nodemailer.createTransport = () => ({
    sendMail: async () => { throw new Error('SMTP is down'); }
  });
  delete require.cache[require.resolve('../server')];
  const failingApp = require('../server');

  const res = await request(failingApp).post('/api/contact').send({
    name: 'Kevin', phone: '123', email: 'kevin@example.com', message: 'test'
  });

  assert.equal(res.status, 500);
  assert.equal(res.body.ok, false);

  // restore for any tests that might run after this one
  nodemailer.createTransport = original;
  delete require.cache[require.resolve('../server')];
});
