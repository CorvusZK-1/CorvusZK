# Exact steps for Cory (GitHub + domain)

## Blocker right now
GitHub is **not connected** in Cursor (`gh` has no login; `cursor-github` needsAuth). A connect card should appear in chat. After you connect:

## Create and push
1. On github.com, create a new **public** empty repository named `corvuszk` (no README/license — this tree already has them).
2. On the box (or your machine), with `gh` authenticated as you:

```bash
cd /workspace/dapps/corvuszk-public
git init
git add .
git status   # confirm no .wallets / .keys / .env
git commit -m "Public CorvusZK toolkit + landing"
git branch -M main
git remote add origin https://github.com/YOUR_GITHUB_USER/corvuszk.git
git push -u origin main
```

3. GitHub → Settings → Pages → Source: Deploy from branch `main` / folder `/docs`.
4. Pages custom domain: `corvuszk.com` (CNAME file already in `docs/`).
5. Porkbun → Domain Management → corvuszk.com → DNS → Quick DNS Config → **Github**, set www → `YOUR_GITHUB_USER.github.io`. Free. No hosting purchase.
6. After DNS propagates, turn on Enforce HTTPS in GitHub Pages.

## Interim (optional, free)
Porkbun URL Forward can redirect corvuszk.com to the existing Cursor Page until Pages is live:
https://cursor.com/canvas/store-96962297-1e4b-4f38-9782-e0c2630522d2/fdb66595-4e1e-4f8d-816e-ad87cf746017
Guide: https://kb.porkbun.com/article/39-how-to-set-up-url-forwarding
