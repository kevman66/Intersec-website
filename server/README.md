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

## 2. Get the code onto the droplet (one-time)

This only needs to happen once. SSH into the droplet and clone the whole
repo into wherever you want it to live — Nginx's `root` will point here
too, so both the static site and this API live in the same place:

```bash
cd /var/www   # or wherever you keep sites on this droplet
git clone https://github.com/kevman66/Intersec-website.git intersec
```

## 3. Install dependencies and configure

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

## 7. Running the tests

```bash
cd server
npm install   # installs supertest too, not just production deps
npm test
```

Tests use a fake mail transporter (no real email is ever sent while testing)
and cover: validation, the spam honeypot, a successful send, the HTML-escaping
of submitted fields, and a failed-send case.

## 8. Automatic deploys on push (optional, but set up already)

`.github/workflows/ci-cd.yml` runs the tests on every push/PR, and on a push
to `main` that passes, SSHs into the droplet and does `git pull` + restarts
the API — so after the one-time setup above, you never need to manually
SSH in for a code update again (Nginx serves the updated static files
immediately since they're just files on disk; the API needs the restart
because it's a running process).

For that to work, add these as **repo secrets** (GitHub repo → Settings →
Secrets and variables → Actions → New repository secret):

| Secret | Value |
|---|---|
| `DROPLET_HOST` | The droplet's IP address |
| `DROPLET_USER` | The SSH user to log in as (e.g. `root` or a deploy user) |
| `DROPLET_SSH_KEY` | A **private** SSH key GitHub Actions will authenticate with (see below) |
| `DROPLET_PORT` | Only needed if SSH isn't on the default port 22 |
| `DROPLET_DEPLOY_PATH` | Where you cloned the repo, e.g. `/var/www/intersec` |

To create a dedicated key pair for GitHub Actions (don't reuse your personal
SSH key):

```bash
ssh-keygen -t ed25519 -C "github-actions-deploy" -f gh_deploy_key -N ""
```

That makes two files: `gh_deploy_key` (private) and `gh_deploy_key.pub`
(public). Add the **public** key to the droplet so it's allowed to log in:

```bash
ssh-copy-id -i gh_deploy_key.pub your_user@your_droplet_ip
# or manually append gh_deploy_key.pub's contents to ~/.ssh/authorized_keys on the droplet
```

Then paste the entire contents of the **private** key file (`gh_deploy_key`,
including the `-----BEGIN...-----` / `-----END...-----` lines) as the
`DROPLET_SSH_KEY` secret. Delete `gh_deploy_key` and `gh_deploy_key.pub`
from your local machine afterward — the private key only needs to exist in
GitHub's encrypted secrets store and the droplet's `authorized_keys`.

Also make sure the deploy user can run `git pull`, `npm`, and `pm2` without
a password prompt (i.e. it owns the cloned directory and `pm2` is on its
PATH) — the SSH action runs non-interactively, so anything requiring a
prompt will hang or fail.
