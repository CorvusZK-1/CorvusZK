import { buildWallet, synced, summarize, redactErr } from './wallet.mjs';
try { const t0 = Date.now(); const ctx = await buildWallet(process.argv[2] || 'deployer'); const s = await synced(ctx.wallet);
  console.log(JSON.stringify({ ...summarize(s), address: ctx.unshieldedKeystore.getBech32Address().asString(), syncSec: (Date.now() - t0) / 1000 }, null, 1));
  await ctx.wallet.stop(); process.exit(0);
} catch (e) { console.error(redactErr(e)); process.exit(1); }
