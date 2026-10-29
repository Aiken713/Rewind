/* Accounts: nickname sign-up and recovery link, powered by Supabase.
   Needs config.js filled in. If it isn't, the app still works without accounts. */
(function(){
  const cfg = window.FLASHBACK_CONFIG || {};
  if (!window.supabase || !cfg.SUPABASE_URL || cfg.SUPABASE_URL.includes('PASTE')){
    console.info('Accounts are off. Add your Supabase details to config.js.'); return;
  }
  const sb = window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_KEY);
  const RK = 'flashback-rk', SAVED = 'flashback-saved', ASKED = 'flashback-asked';
  let profile = null;

  const get = k => { try{ return localStorage.getItem(k); }catch(e){ return null; } };
  const put = (k, v) => { try{ v === null ? localStorage.removeItem(k) : localStorage.setItem(k, v); }catch(e){} };
  const open = id => { $(id).hidden = false; }, shut = id => { $(id).hidden = true; };
  const linkFor = s => location.origin + location.pathname + '#recover=' + s;
  function newSecret(){                      // 24 random bytes, written as 32 safe characters
    const b = crypto.getRandomValues(new Uint8Array(24));
    return btoa(String.fromCharCode(...b)).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
  }
  let toastTimer;
  function toast(t){ const el = $('toast'); el.textContent = t; el.hidden = false; clearTimeout(toastTimer); toastTimer = setTimeout(() => { el.hidden = true; }, 3500); }
  function refresh(){
    if (profile){ $('acct').textContent = profile.nickname + '#' + profile.tag; $('acct').hidden = false; }
    $('saveBanner').hidden = !(profile && !get(SAVED));
  }

  async function session(){
    const { data } = await sb.auth.getSession();
    if (!data.session){ const r = await sb.auth.signInAnonymously(); if (r.error) throw r.error; }
  }
  async function loadProfile(){
    const { data, error } = await sb.from('profiles').select('nickname,tag').maybeSingle();
    if (error) throw error; profile = data; refresh();
  }
  async function recover(secret){
    const { data, error } = await sb.rpc('recover_profile', { p_secret: secret });
    if (error) return false;
    put(RK, secret); put(SAVED, '1'); profile = data; refresh(); return true;
  }

  /* ----- nickname screen ----- */
  const err = t => { $('nickErr').textContent = t; };
  $('createBtn').onclick = async () => {
    const nick = $('nick').value.trim(); err('');
    if (!/^[A-Za-z0-9 _-]{2,20}$/.test(nick)) return err('Use 2 to 20 letters, numbers, spaces, _ or -.');
    const secret = newSecret();
    const { data, error } = await sb.rpc('create_profile', { p_nickname: nick, p_secret: secret });
    if (error) return err('Could not create your account. Try again.');
    put(RK, secret); put(SAVED, null); profile = data; refresh(); shut('nameSheet');
  };
  $('haveAcct').onclick = () => { $('recoverBox').hidden = false; $('haveAcct').hidden = true; };
  $('recBtn').onclick = async () => {
    err(''); const v = $('recIn').value.trim(), m = v.match(/recover=([\w-]+)/);
    if (await recover(m ? m[1] : v)){ shut('nameSheet'); toast('Welcome back, ' + profile.nickname); }
    else err('That recovery link did not work.');
  };

  /* ----- recovery link screen ----- */
  function openRec(){
    $('recName').textContent = profile.nickname + '#' + profile.tag;
    $('recLink').value = get(RK) ? linkFor(get(RK)) : '';
    open('recSheet');
  }
  $('acct').onclick = openRec; $('saveBanner').onclick = openRec;
  $('closeRec').onclick = () => shut('recSheet');
  $('copyLink').onclick = async () => {
    try{ await navigator.clipboard.writeText($('recLink').value); toast('Link copied'); }
    catch(e){ $('recLink').select(); toast('Press and hold to copy'); }
  };
  $('textLink').onclick = () => {
    const msg = "DON'T DELETE THIS TEXT. It's the recovery link for your Rewind account " + $('recName').textContent + ': ' + $('recLink').value;
    location.href = 'sms:?&body=' + encodeURIComponent(msg);
  };
  $('savedBtn').onclick = () => { put(SAVED, '1'); refresh(); shut('recSheet'); };
  $('regen').onclick = async () => {
    const s = newSecret(), { error } = await sb.rpc('regenerate_recovery', { p_secret: s });
    if (error) return toast('Could not make a new link.');
    put(RK, s); put(SAVED, null); $('recLink').value = linkFor(s); refresh(); toast('New link made. Save it now.');
  };

  async function saveBlob(blob, name){
    const f = new File([blob], name, { type: blob.type });
    if (navigator.canShare && navigator.canShare({ files: [f] })){
      try{ await navigator.share({ files: [f] }); return; }catch(e){ if (e.name === 'AbortError') return; }
    }
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; a.click();
  }
  $('cardBtn').onclick = () => {                 // a retro recovery card you can keep in your camera roll
    const W = 1080, H = 1350, c = document.createElement('canvas'); c.width = W; c.height = H;
    const x = c.getContext('2d');
    x.fillStyle = '#EEE2CF'; x.fillRect(0, 0, W, H);
    ['#C73227','#D9A57E','#D1846B','#3F98B0','#0873A8','#7B0C06','#B52707','#C4520F','#DFA00E'].forEach((col, i) => {
      const r = 420 - i*40;
      x.strokeStyle = col; x.lineWidth = 40; x.beginPath();
      x.arc(W/2, 560, r, Math.PI, 2*Math.PI);
      x.moveTo(W/2 - r, 560); x.lineTo(W/2 - r, 700); x.moveTo(W/2 + r, 560); x.lineTo(W/2 + r, 700);
      x.stroke();
    });
    x.textAlign = 'center'; x.fillStyle = '#7B0C06';
    x.font = '700 64px Fraunces, Georgia, serif'; x.fillText('Rewind recovery card', W/2, 840);
    x.font = '700 52px "DM Sans", sans-serif'; x.fillText($('recName').textContent, W/2, 920);
    x.font = '32px "DM Sans", sans-serif'; x.fillStyle = '#3A1A12';
    x.fillText('Keep this private.', W/2, 985); x.fillText('Anyone with this link can open your account.', W/2, 1030);
    x.font = '28px ui-monospace, Menlo, monospace';
    const link = $('recLink').value;
    for (let i = 0; i * 44 < link.length; i++) x.fillText(link.slice(i*44, i*44 + 44), W/2, 1110 + i*40);
    c.toBlob(b => saveBlob(b, 'rewind-recovery-card.png'), 'image/png');
  };

  /* ----- after the first photo, ask them to save the link once ----- */
  const origShow = show;
  show = c => {
    origShow(c);
    if (profile && !get(SAVED) && !get(ASKED)){ put(ASKED, '1'); setTimeout(openRec, 700); }
  };

  /* ----- start up ----- */
  const afterWelcome = f => {
    const w = $('welcome'); if (w.hidden) return f();
    new MutationObserver((_, o) => { if (w.hidden){ o.disconnect(); f(); } }).observe(w, { attributes:true, attributeFilter:['hidden'] });
  };
  (async () => {
    try{
      await session();
      const m = location.hash.match(/recover=([\w-]+)/);
      if (m){                                     // opened from a recovery link
        history.replaceState(null, '', location.pathname + location.search);
        const ok = await recover(m[1]);
        toast(ok ? 'Welcome back, ' + profile.nickname : 'That recovery link did not work.');
      }
      await loadProfile();
      if (!profile) afterWelcome(() => open('nameSheet'));
    }catch(e){ console.warn('Accounts not available:', e); }
  })();
})();
