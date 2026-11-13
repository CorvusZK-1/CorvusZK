// CorvusZK /demo: replay of a real testnet run (12 Nov 2026, 2:55 AM PT). Static, no tracking, no wallets.
(function () {
  'use strict';
  var MN = 'https://preprod.midnightexplorer.com';
  var SUB = 'https://midnight-preprod.subscan.io/extrinsic/0x';
  var XR = 'https://testnet.xrpl.org/transactions/';
  var CONTRACT = 'b8a7935e586c31800fc0b424c4f7e83d274c62d8dab3b63b77708d569ba0c1f2';

  // Receipts copied from the run log (eligibility-live-3679, `npm run live:eligibility`). Checked on the explorers.
  var STEPS = [
    { net: 'xrpl', title: 'Lock 20 test XRP in a native XRPL escrow',
      text: 'The payer\'s own wallet creates an XRPL EscrowCreate with a crypto-condition. The XRP can only ever go to the escrow\'s fixed destination, and only with the matching release key, which the payer never receives. CorvusZK never holds the funds.',
      tx: { type: 'EscrowCreate', hash: '593F1F56ED7AD8FB7C4C4DF7D78EF2DE41AC3DE085DC476BC30B348F350FAB41', where: 'ledger 22,265,838', result: 'tesSUCCESS', link: XR } },
    { net: 'midnight', title: 'Deploy the eligibility contract on Midnight',
      text: 'One small contract per escrow. It publicly fixes which issuer and credential type count, which XRPL escrow it guards, and a commitment (hash) of the release key, never the key itself.',
      tx: { type: 'deploy', hash: '9de06ad93e116ffc249a4665702a07c0b316809604a5ceb154f78671f94f54c3', where: 'block 3,389,151', result: 'Success', link: MN + '/transactions/', fee: '3.61 tDUST (test token)' },
      contract: true },
    { net: 'midnight', title: 'Prove eligibility privately (zero-knowledge proof)',
      text: 'The holder proves they have a valid signed credential from the issuer, without showing it. The proof server builds a zk-SNARK; Midnight checks it and records only "proven" plus a one-time nullifier so the same proof cannot be reused.',
      tx: { type: 'prove', hash: '88a89d1df54979f400b991cf4b7e152dccacd18950cef3539af7d7f1611a3859', where: 'block 3,389,155', result: 'Success', link: MN + '/transactions/', fee: '0.26 tDUST' },
      privacy: [['Stays private', 'the holder secret, the credential\'s expiry and the issuer\'s signature'], ['Public on chain', 'issuer public key, credential type, as-of date, which escrow, proven = true, a nullifier']] },
    { net: 'midnight', title: 'Reveal the release key, only because the proof passed',
      text: 'The contract only accepts the reveal after a successful proof, and only for the key that matches the commitment from step 2. The Midnight indexer then shows: found, proven, key revealed.',
      tx: { type: 'reveal', hash: '0cb52d18a22d6c2dccc588f7668c732efa96eb18316e4425363a71a7e382d586', where: 'block 3,389,158', result: 'Success', link: MN + '/transactions/', fee: '0.26 tDUST' } },
    { net: 'xrpl', title: 'Release the escrow on XRPL',
      text: 'The destination submits EscrowFinish with the key read from Midnight. XRPL checks it against the condition from step 1 and pays out the 20 test XRP. About 88 seconds after step 1.',
      tx: { type: 'EscrowFinish', hash: '194F5D8FD89AFF3E95ACC7A140D2ED2AB6129EA7E6A73A2C7A2A0BAE6634354C', where: 'ledger 22,265,859', result: 'tesSUCCESS', link: XR } }
  ];
  var NEXT_LABELS = ['Start: lock the XRP →', 'Next: deploy on Midnight →', 'Next: prove privately →', 'Next: reveal the key →', 'Next: release the escrow →', 'Done ✓'];

  var $ = function (id) { return document.getElementById(id); };
  var esc = function (s) { return String(s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); };
  var short = function (h) { return h.slice(0, 10) + '…' + h.slice(-6); };
  var netName = { xrpl: 'XRPL testnet', midnight: 'Midnight Preprod' };

  function receiptHtml(s) {
    var t = s.tx, rows = [];
    rows.push('<div class="row"><span class="k">Transaction</span><span class="v">' + esc(t.type) + '</span></div>');
    rows.push('<div class="row"><span class="k">Hash</span><a class="v" target="_blank" rel="noopener" href="' + t.link + t.hash + '" title="' + t.hash + '">' + short(t.hash) + ' ↗</a></div>');
    rows.push('<div class="row"><span class="k">Included in</span><span class="v">' + esc(t.where) + '</span></div>');
    rows.push('<div class="row"><span class="k">Result</span><span class="v ok">' + esc(t.result) + '</span></div>');
    if (t.fee) rows.push('<div class="row"><span class="k">Network fee</span><span class="v">' + esc(t.fee) + '</span></div>');
    if (s.net === 'midnight') rows.push('<div class="row"><span class="k">Also on</span><a class="v" target="_blank" rel="noopener" href="' + SUB + t.hash + '">Subscan ↗</a></div>');
    if (s.contract) rows.push('<div class="row"><span class="k">Contract</span><a class="v" target="_blank" rel="noopener" href="' + MN + '/contracts/' + CONTRACT + '">' + short(CONTRACT) + ' ↗</a></div>');
    var priv = s.privacy ? '<div class="privacy">' + s.privacy.map(function (p) { return '<div><b>' + esc(p[0]) + '</b>' + esc(p[1]) + '</div>'; }).join('') + '</div>' : '';
    return '<div class="receipt">' + rows.join('') + priv + '</div>';
  }

  var list = $('steps');
  list.innerHTML = STEPS.map(function (s, i) {
    return '<li id="step' + i + '"><h3>' + esc(s.title) + '<span class="net ' + s.net + '">' + netName[s.net] + '</span></h3><p>' + esc(s.text) + '</p>' + receiptHtml(s) + '</li>';
  }).join('');

  var at = -1, busy = false;
  function paint() {
    STEPS.forEach(function (_, i) {
      var li = $('step' + i);
      li.classList.toggle('done', i < at || (at === STEPS.length - 1 && i === at));
      li.classList.toggle('active', i === at && at < STEPS.length - 1);
    });
    $('progressBar').style.width = ((at + 1) / STEPS.length * 100) + '%';
    var finished = at >= STEPS.length - 1;
    $('nextBtn').textContent = NEXT_LABELS[at + 1];
    $('nextBtn').disabled = finished;
    $('allBtn').hidden = finished;
    $('resetBtn').hidden = at < 0;
    $('doneNote').hidden = !finished;
  }
  function advance() {
    if (busy || at >= STEPS.length - 1) return;
    busy = true;
    var btn = $('nextBtn'), label = NEXT_LABELS[at + 1].replace(/^(Start|Next): /, '').replace(' →', '');
    btn.innerHTML = '<span class="spin"></span>' + esc(label.charAt(0).toUpperCase() + label.slice(1)) + '…';
    btn.disabled = true;
    setTimeout(function () {
      at++; busy = false; paint();
      var li = $('step' + at); if (li.scrollIntoView) li.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }, 650);
  }
  $('nextBtn').addEventListener('click', advance);
  $('allBtn').addEventListener('click', function () { at = STEPS.length - 1; paint(); });
  $('resetBtn').addEventListener('click', function () { at = -1; paint(); window.scrollTo({ top: list.offsetTop - 140, behavior: 'smooth' }); });
  paint();

  // Receipt table
  $('receiptRows').innerHTML = STEPS.map(function (s, i) {
    return '<tr><td>' + (i + 1) + '. ' + esc(s.tx.type) + '</td><td>' + netName[s.net] + '</td><td class="mono"><a target="_blank" rel="noopener" href="' + s.tx.link + s.tx.hash + '" title="' + s.tx.hash + '">' + short(s.tx.hash) + ' ↗</a></td><td>' + esc(s.tx.where) + '</td><td class="ok">' + esc(s.tx.result) + '</td></tr>';
  }).join('');

  // In-browser illustration of the age_over rule: birthYear + minAge <= asOfYear, with a salted commitment.
  function hex(buf) { return Array.prototype.map.call(new Uint8Array(buf), function (b) { return ('0' + b.toString(16)).slice(-2); }).join(''); }
  $('tryForm').addEventListener('submit', function (ev) {
    ev.preventDefault();
    var by = parseInt($('birthYear').value, 10), min = parseInt($('minAge').value, 10), asOf = parseInt($('asOf').value, 10);
    if (!(by > 0 && min > 0 && asOf > 0)) return;
    var salt = new Uint8Array(32); crypto.getRandomValues(salt);
    var data = new Uint8Array(34); data.set(salt, 0); data[32] = (by >> 8) & 255; data[33] = by & 255;
    var done = function (commit) {
      var pass = by + min <= asOf;
      $('privOut').innerHTML = '<dt>Birth year</dt><dd>' + by + '</dd><dt>Salt</dt><dd>' + hex(salt).slice(0, 24) + '…</dd>';
      $('pubOut').innerHTML = '<dt>Claim</dt><dd>born ≥ ' + min + ' years before ' + asOf + '</dd><dt>Commitment</dt><dd>' + commit.slice(0, 24) + '…</dd><dt>proven</dt><dd class="' + (pass ? 'ok' : 'bad') + '">' + (pass ? 'true' : 'false (no proof exists)') + '</dd>';
      var v = $('verdict');
      v.className = 'verdict ' + (pass ? 'pass' : 'fail');
      v.textContent = pass
        ? 'Accepted. A verifier learns only that the rule holds for the committed birth year, not the year itself. On Midnight this is a zk-SNARK checked by the network; here it is a plain in-browser check for illustration.'
        : 'Refused. The rule does not hold, so the real circuit\'s assertion fails and no proof can be made: nothing goes on chain and the escrow stays locked.';
      $('tryOut').hidden = false;
    };
    if (window.crypto && crypto.subtle) crypto.subtle.digest('SHA-256', data).then(function (d) { done(hex(d)); });
    else done('(needs a secure https page)');
  });

  // Live XRPL check from the visitor's browser (public JSON-RPC, CORS). Testnet servers prune old ledgers, so
  // a "not found" here does not mean the transaction is gone; the explorer link keeps full history.
  var RPCS = ['https://s.altnet.rippletest.net:51234/', 'https://clio.altnet.rippletest.net:51234/', 'https://testnet.xrpl-labs.com/'];
  function rpcTx(url, hash) {
    var ctl = window.AbortController ? new AbortController() : null;
    var timer = setTimeout(function () { if (ctl) ctl.abort(); }, 8000);
    return fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, signal: ctl ? ctl.signal : undefined,
      body: JSON.stringify({ method: 'tx', params: [{ transaction: hash, binary: false }] }) })
      .then(function (r) { return r.json(); })
      .then(function (j) { clearTimeout(timer); return j.result || {}; }, function (e) { clearTimeout(timer); throw e; });
  }
  function checkOne(hash) {
    var i = 0, notFound = false;
    function next() {
      if (i >= RPCS.length) return Promise.resolve({ ok: false, notFound: notFound });
      var url = RPCS[i++];
      return rpcTx(url, hash).then(function (r) {
        if (r.error === 'txnNotFound') { notFound = true; return next(); }
        if (r.error) return next();
        var tx = r.tx_json || r;
        return { ok: true, server: url.replace(/^https:\/\//, '').replace(/\/$/, ''), type: tx.TransactionType, result: r.meta && r.meta.TransactionResult, validated: r.validated, ledger: r.ledger_index, when: r.close_time_iso };
      }, function () { return next(); });
    }
    return next();
  }
  $('liveBtn').addEventListener('click', function () {
    var btn = $('liveBtn'); btn.disabled = true; btn.innerHTML = '<span class="spin"></span>Asking XRPL testnet…';
    var targets = STEPS.filter(function (s) { return s.net === 'xrpl'; });
    $('liveOut').innerHTML = '';
    Promise.all(targets.map(function (s) { return checkOne(s.tx.hash); })).then(function (res) {
      $('liveOut').innerHTML = res.map(function (r, k) {
        var s = targets[k], link = '<a target="_blank" rel="noopener" href="' + XR + s.tx.hash + '">open in the XRPL testnet explorer ↗</a>';
        if (r.ok) {
          var when = r.when ? new Date(r.when).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' }) : '';
          return '<div class="item"><b>' + esc(r.type || s.tx.type) + '</b>: <span class="' + (r.result === 'tesSUCCESS' ? 'ok' : 'bad') + '">' + esc(r.result || 'unknown') + '</span>' +
            (r.validated ? ', validated' : '') + ' in ledger ' + esc(r.ledger) + (when ? ' (' + esc(when) + ', your time)' : '') + '. Checked just now via ' + esc(r.server) + '. ' + link + '</div>';
        }
        return '<div class="item"><b>' + esc(s.tx.type) + '</b>: ' + (r.notFound
          ? 'the public testnet servers your browser reached no longer keep this ledger (testnet nodes prune old history).'
          : 'your browser could not reach a public XRPL testnet server (some networks block it).') + ' The full record is still public: ' + link + '</div>';
      }).join('') + (res.every(function (r) { return r.ok && r.result === 'tesSUCCESS'; }) ? '<div class="item ok">Both checks passed: the escrow was created and later released with the key revealed on Midnight.</div>' : '');
      btn.disabled = false; btn.textContent = 'Check again';
    });
  });
})();
