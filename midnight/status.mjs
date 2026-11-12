// Prints the throwaway Preprod test wallet's public status (no seeds, no token). Usage: node status.mjs [walletName]
import { openWallet9, redactErr } from './wallet9.mjs';
try {
  const t0 = Date.now();
  const w = await openWallet9({ walletName: process.argv[2] || 'deployer', registerDust: false, syncTimeoutMs: Number(process.env.MN_SYNC_TIMEOUT_MS ?? 3_600_000) });
  console.log(JSON.stringify({ ...w.status, address: w.provider.unshieldedKeystore.getBech32Address().asString(), syncSec: (Date.now() - t0) / 1000 }, null, 1));
  await w.stop(); process.exit(0);
} catch (e) { console.error(redactErr(e)); process.exit(1); }
