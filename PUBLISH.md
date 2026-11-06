# Publish CorvusZK to GitHub (Cory)

Cursor cannot create a GitHub repository for you. Do this once:

1. Connect GitHub in Cursor when the connect card appears (or create an empty public repo named `corvuszk` on github.com under your account).
2. From a machine with `gh` logged in as you:

```bash
cd /path/to/corvuszk-public   # this tree
git init
git add .
git commit -m "Initial public CorvusZK toolkit"
# create empty public repo on GitHub first, then:
git branch -M main
git remote add origin git@github.com:YOUR_USER/corvuszk.git
git push -u origin main
```

3. Enable GitHub Pages (Settings → Pages). Easiest: set source to `/docs` and move or copy `docs/site/*` up into `docs/` as `docs/index.html`, **or** serve `docs/site` via a Pages action / `gh-pages` branch that uses that folder as root.
4. Point corvuszk.com DNS at GitHub Pages (Porkbun Quick DNS → Github). Free. Guide: https://kb.porkbun.com/article/64-how-to-connect-your-domain-to-github-pages

## Secrets check before every push

Never add: `.wallets*`, `.wallet-state*`, `.contract-secrets*`, `.keys*`, Blockfrost tokens, `.env`, `midnight-level-db/`.
