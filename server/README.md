# Intersec contact form API

A small Express server with one job: receive the contact form on the website
and email it to info@intersecug.com (which forwards to Gmail via Cloudflare
Email Routing) via Brevo SMTP. Runs alongside the static site on your
existing droplet.

## 1. Get your Brevo SMTP credentials

In Brevo, go to **Settings → SMTP & API → SMTP tab**. You'll see:
- An SMTP login (your Brevo account email) → this is `BREVO_SMTP_USER`
- A button to generate/reveal an SMTP key → this is `BREVO_SMTP_KEY` (not
  your Brevo account password — a separate generated key, revocable anytime)

Also confirm `info@intersecug.com` (or the whole `intersecug.com` domain) is
verified as a sender in Brevo — **Settings → Senders, Domains & Dedicated
IPs**. Brevo will reject sends from an unverified "from" address.

## 2. Get the code onto the droplet

From your local machine, copy the `server` folder to the droplet (adjust the
path to wherever the site's files live there, e.g. `/var/www/intersec`):

```bash
scp -r server your_user@your_droplet_ip:/var/www/intersec/server
```

Or if you're pulling from git on the droplet instead, just `git pull` as usual.

## 3. Install dependencies and configure

SSH into the droplet, then:

```bash
cd /var/www/intersec/server
npm install --production
cp .env.example .env
nano .env   # fill in BREVO_SMTP_USER and BREVO_SMTP_KEY
```

## 4. Run it with PM2 (keeps it alive, restarts on crash/reboot)

If PM2 isn't already installed on the droplet:
```bash
npm install -g pm2
```

Start the API:
```bash
pm2 start server.js --name intersec-contact-api
pm2 save
pm2 startup   # follow the one-time instructions it prints, so it survives a reboot
```

Useful commands: `pm2 logs intersec-contact-api`, `pm2 restart intersec-contact-api`.

## 5. Point Nginx at it

The site's static files and this API need to be reachable on the same
domain so the form's `fetch('/api/contact')` call works without CORS
headaches. In whatever Nginx server block already serves this site's
static files (or the one you create for it), add a proxy for `/api/`
pointing at the port this app listens on (`3001` by default):

```nginx
server {
    listen 80;
    server_name yourdomain.com;

    root /var/www/intersec;   # wherever the static site files are
    index index.html;

    location /api/ {
        proxy_pass http://127.0.0.1:3001;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

Since you already have other sites/apps on this droplet, merge just the
`location /api/ { ... }` block into whichever existing server block will
serve this site — don't overwrite your existing Nginx config wholesale.

Then test and reload:
```bash
sudo nginx -t
sudo systemctl reload nginx
```

## 6. Test it for real

Open the live site's Contact page and submit the form. A message should
land in info@intersecug.com (forwarded to Gmail) within a few seconds. You
can also check directly from the droplet:

```bash
curl -X POST http://localhost:3001/api/contact \
  -H "Content-Type: application/json" \
  -d '{"name":"Test","phone":"+256700000000","email":"you@example.com","message":"Testing"}'
```

If PORT 3001 is already used by something else on this droplet, change
`PORT` in `.env` and update the `proxy_pass` line in the Nginx config to match.
