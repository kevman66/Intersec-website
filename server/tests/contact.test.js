// Tests for the contact form API. Uses Node's built-in test runner
// (node --test) and supertest for HTTP assertions. The global fetch used to
// call Brevo's API is swapped for a fake below so tests never send real email.

const test = require('node:test');
const assert = require('node:assert/strict');

// Fake env vars so server.js's startup guard passes.
process.env.BREVO_API_KEY = 'test-api-key';
process.env.FROM_EMAIL = 'forms@intersecug.com';
process.env.TO_EMAIL = 'info@intersecug.com';

const sentRequests = [];
const originalFetch = global.fetch;

function installFakeFetch(handler) {
  global.fetch = async (url, options) => {
    const body = JSON.parse(options.body);
    sentRequests.push({ url, headers: options.headers, body });
    return handler ? handler(body) : { ok: true, text: async () => '' };
  };
}

installFakeFetch();

const request = require('supertest');
const app = require('../server');

test.beforeEach(() => {
  sentRequests.length = 0;
  installFakeFetch();
});

test.after(() => {
  global.fetch = originalFetch;
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
  assert.equal(sentRequests.length, 0);
});

test('POST /api/contact rejects an invalid email address', async () => {
  const res = await request(app).post('/api/contact').send({
    name: 'Test', phone: '123', email: 'not-an-email', message: 'hi'
  });
  assert.equal(res.status, 400);
  assert.equal(sentRequests.length, 0);
});

test('POST /api/contact silently no-ops when the honeypot field is filled', async () => {
  const res = await request(app).post('/api/contact').send({
    name: 'Bot', phone: '123', email: 'bot@example.com', message: 'spam', _hp: 'filled'
  });
  assert.equal(res.status, 200);
  assert.deepEqual(res.body, { ok: true });
  assert.equal(sentRequests.length, 0, 'a filled honeypot must never trigger a real send');
});

test('POST /api/contact sends via the Brevo API for a valid submission', async () => {
  const res = await request(app).post('/api/contact').send({
    name: 'Kevin',
    phone: '+256700000000',
    email: 'kevin@example.com',
    service: 'Event Security',
    message: 'Need a quote for a wedding next month.'
  });

  assert.equal(res.status, 200);
  assert.deepEqual(res.body, { ok: true });
  assert.equal(sentRequests.length, 1);

  const req0 = sentRequests[0];
  assert.equal(req0.url, 'https://api.brevo.com/v3/smtp/email');
  assert.equal(req0.headers['api-key'], 'test-api-key');
  assert.equal(req0.body.sender.email, 'forms@intersecug.com');
  assert.equal(req0.body.to[0].email, 'info@intersecug.com');
  assert.equal(req0.body.replyTo.email, 'kevin@example.com');
  assert.match(req0.body.subject, /Kevin/);
  assert.match(req0.body.textContent, /Event Security/);
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
  assert.match(sentRequests[0].body.textContent, /Other \/ Not Sure/);
});

test('POST /api/contact escapes HTML in submitted fields', async () => {
  const res = await request(app).post('/api/contact').send({
    name: '<script>alert(1)</script>',
    phone: '123',
    email: 'x@example.com',
    message: 'hello <b>world</b>'
  });

  assert.equal(res.status, 200);
  const html = sentRequests[0].body.htmlContent;
  assert.ok(!html.includes('<script>'), 'raw <script> tag must not reach the HTML email body');
  assert.ok(html.includes('&lt;script&gt;'), 'the tag should be escaped instead');
});

test('POST /api/contact returns 500 and does not crash when the Brevo API errors', async () => {
  installFakeFetch(() => ({ ok: false, status: 401, text: async () => '{"message":"Unauthorized"}' }));

  const res = await request(app).post('/api/contact').send({
    name: 'Kevin', phone: '123', email: 'kevin@example.com', message: 'test'
  });

  assert.equal(res.status, 500);
  assert.equal(res.body.ok, false);
});
