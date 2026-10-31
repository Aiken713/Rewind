/* Version 7: postcards. Short private notes about a photo. They arrive a few hours after they are sent. */
(function(){
  const api = window.rewind;
  if (!api) return;                                    // accounts are off, so postcards are off too
  const { sb, toast } = api;
  const B = 'rewind-photos';
  const open = id => { $(id).hidden = false; }, shut = id => { $(id).hidden = true; };
  const say = (id, t) => { $(id).textContent = t; };
  const el = (tag, cls, text) => { const x = document.createElement(tag); if (cls) x.className = cls; if (text !== undefined) x.textContent = text; return x; };
  const svg = p => '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + p + '</svg>';
  const ICON = {
    save: svg('<path d="M12 4v11M7 11l5 5 5-5"/><path d="M5 20h14"/>'),
    flag: svg('<path d="M5 21V4"/><path d="M5 4h11l-2 4 2 4H5"/>'),
    trash: svg('<path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/>')
  };
  const STAMPS = [
    ['#DFA00E', '#C4520F', '#7B0C06'], ['#3F98B0', '#0873A8', '#7B0C06'], ['#D9A57E', '#D1846B', '#C73227'],
    ['#C73227', '#B52707', '#7B0C06'], ['#0873A8', '#3F98B0', '#DFA00E'], ['#7B0C06', '#C4520F', '#DFA00E']
  ];
  const stampEl = i => {
    const s = el('div', 'stamp sv'); (STAMPS[i] || STAMPS[0]).forEach((c, n) => s.style.setProperty('--s' + (n + 1), c));
    s.appendChild(document.createElement('i')); return s;
  };
  const nice = e => {
    const m = ((e && e.message) || '').toLowerCase();
    if (m.includes('not accepting')) return "They aren't taking postcards from you right now.";
    if (m.includes('daily')) return 'You can send 3 postcards a day.';
    if (m.includes('already')) return 'You already sent a postcard about this photo.';
    if (m.includes('links')) return "Postcards can't have links.";
    if (m.includes('yourself')) return "You can't send a postcard to yourself.";
    if (m.includes('gone')) return "That photo isn't there any more.";
    return 'Something went wrong. Try again.';
  };

  /* ----- write a postcard ----- */
  let target = null, stamp = 0, sending = false;
  function drawStamps(){
    $('stamps').replaceChildren(...STAMPS.map((_, i) => {
      const b = el('button', 'stampbtn'); b.setAttribute('aria-pressed', String(i === stamp)); b.setAttribute('aria-label', 'Stamp ' + (i + 1));
      b.appendChild(stampEl(i)); b.onclick = () => { stamp = i; drawStamps(); }; return b;
    }));
  }
  window.openPostcard = info => {                      // called from the feed and from group photos
    target = info; stamp = 0; $('pcNote').value = ''; say('pcErr', ''); say('pcCount', '0 / 100');
    say('pcTo', 'To ' + (info.name || 'this person') + '. It arrives in a few hours, like real mail.');
    drawStamps(); open('pcSheet'); setTimeout(() => $('pcNote').focus(), 60);
  };
  $('pcNote').addEventListener('input', () => say('pcCount', $('pcNote').value.length + ' / 100'));
  $('pcCancel').onclick = () => shut('pcSheet');
  $('pcSend').onclick = async () => {
    if (sending || !target) return;
    const note = $('pcNote').value.trim();
    if (!note) return say('pcErr', 'Write a short note first.');
    if (/(https?:\/\/|www\.)/i.test(note)) return say('pcErr', "Postcards can't have links.");
    sending = true; say('pcErr', '');
    const { error } = await sb.rpc('send_postcard', { p_kind: target.kind, p_post: target.id, p_note: note, p_stamp: stamp });
    sending = false;
    if (error) return say('pcErr', nice(error));
    shut('pcSheet'); toast('Postcard on its way. It arrives in a few hours.');
  };

  /* ----- the mailbox ----- */
  let armed = null;
  function twoTap(btn, verb, action){
    btn.onclick = () => {
      if (armed === btn){ armed = null; btn.classList.remove('arm'); action(); return; }
      if (armed) armed.classList.remove('arm');
      armed = btn; btn.classList.add('arm'); toast('Tap again to ' + verb);
      setTimeout(() => { if (armed === btn){ armed = null; btn.classList.remove('arm'); } }, 4000);
    };
  }
  const loadImg = blob => new Promise((res, rej) => { const im = new Image(); im.onload = () => res(im); im.onerror = rej; im.src = URL.createObjectURL(blob); });

  async function saveCardImage(r){                     // a postcard you can keep in your camera roll
    const W = 1080, H = 720, c = document.createElement('canvas'); c.width = W; c.height = H;
    const x = c.getContext('2d'); x.fillStyle = '#FBF4E4'; x.fillRect(0, 0, W, H);
    const cols = ['#C73227', '#FBF4E4', '#0873A8', '#FBF4E4'];
    for (let i = 0; i * 40 < W; i++){ x.fillStyle = cols[i % 4]; x.fillRect(i * 40, 0, 40, 28); x.fillRect(i * 40, H - 28, 40, 28); }
    for (let j = 0; j * 40 < H; j++){ x.fillStyle = cols[j % 4]; x.fillRect(0, j * 40, 28, 40); x.fillRect(W - 28, j * 40, 28, 40); }
    let left = 70;
    if (r.thumb_path){
      const { data } = await sb.storage.from(B).download(r.thumb_path);
      if (data){
        const im = await loadImg(data), w = 260, h = 346, s = Math.max(w / im.width, h / im.height);
        x.save(); x.beginPath(); x.rect(70, 130, w, h); x.clip();
        x.drawImage(im, 70 + (w - im.width * s) / 2, 130 + (h - im.height * s) / 2, im.width * s, im.height * s); x.restore(); left = 390;
      }
    }
    x.fillStyle = '#EEE2CF'; x.fillRect(W - 190, 60, 120, 150);
    (STAMPS[r.stamp] || STAMPS[0]).forEach((col, i) => {
      x.strokeStyle = col; x.lineWidth = 12; x.beginPath(); x.arc(W - 130, 200, 18 + i * 12, Math.PI, 2 * Math.PI); x.stroke();
    });
    x.textAlign = 'left'; x.fillStyle = '#B52707'; x.font = '700 26px "DM Sans", sans-serif';
    x.fillText('FROM ' + (r.nickname || '?').toUpperCase() + '#' + (r.tag || ''), left, 110);
    x.fillStyle = '#7B0C06'; x.font = '700 48px Fraunces, Georgia, serif';
    let line = '', y = 190; const maxW = W - 220 - left;
    r.note.split(' ').forEach(word => {
      const test = line ? line + ' ' + word : word;
      if (x.measureText(test).width > maxW && line){ x.fillText(line, left, y); y += 62; line = word; } else line = test;
    });
    x.fillText(line, left, y);
    x.fillStyle = '#6B4A3A'; x.font = '26px "DM Sans", sans-serif';
    x.fillText(new Date(r.deliver_at).toLocaleDateString(undefined, { month: 'long', day: 'numeric', year: 'numeric' }) + '  ·  Rewind', 70, H - 60);
    c.toBlob(b => { if (b) window.rewindSaveBlob(b, 'rewind-postcard.png'); }, 'image/png');
  }

  function buildMail(r, map){
    const m = el('article', 'mcard'), inn = el('div', 'in');
    const top = el('div', 'mtop'), from = el('span', 'mfrom');
    from.append('From ', el('b', '', (r.nickname || '?') + '#' + (r.tag || '')));
    if (!r.read_at) from.appendChild(el('span', 'mnew', 'New'));
    top.append(from, stampEl(r.stamp));
    const body = el('div', 'mbody');
    if (map[r.thumb_path]){ const im = el('img', 'mthumb'); im.alt = 'The photo this postcard is about'; im.src = map[r.thumb_path]; body.appendChild(im); }
    body.appendChild(el('p', 'mnote', r.note));
    const foot = el('div', 'mfoot'), acts = el('div', 'fact');
    foot.append(el('span', 'mdate', new Date(r.deliver_at).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })), acts);
    const save = el('button', 'ico'); save.innerHTML = ICON.save; save.setAttribute('aria-label', 'Save this postcard as an image'); save.title = 'Save as image';
    save.onclick = () => saveCardImage(r);
    const del = el('button', 'ico'); del.innerHTML = ICON.trash; del.setAttribute('aria-label', 'Delete this postcard'); del.title = 'Delete';
    twoTap(del, 'delete', async () => {
      const { error } = await sb.rpc('delete_postcard', { p_id: r.id });
      if (error) return toast('Could not delete.'); drop(m);
    });
    const flag = el('button', 'ico'); flag.innerHTML = ICON.flag; flag.setAttribute('aria-label', 'Report and block this sender'); flag.title = 'Report and block';
    twoTap(flag, 'report and block this sender', async () => {
      const { error } = await sb.rpc('report_and_block', { p_id: r.id });
      if (error) return toast('Could not send the report.'); drop(m); toast('Reported. You will not get postcards from them again.');
    });
    acts.append(save, del, flag);
    inn.append(top, body, foot); m.appendChild(inn); return m;
  }
  function drop(m){ m.remove(); if (!$('mailList').children.length) $('mailEmpty').hidden = false; }

  const OPTS = [['groups', 'Group members'], ['everyone', 'Everyone'], ['nobody', 'Nobody']];
  async function drawPrefs(){
    const { data } = await sb.rpc('my_postcard_setting'); const cur = data || 'groups';
    $('seg').replaceChildren(...OPTS.map(([v, label]) => {
      const b = el('button', 'segbtn', label); b.setAttribute('aria-pressed', String(v === cur));
      b.onclick = async () => {
        const { error } = await sb.rpc('set_postcard_setting', { p_value: v });
        if (error) return toast('Could not save that.'); toast('Saved'); drawPrefs();
      };
      return b;
    }));
  }
  async function loadMail(){
    await sb.rpc('purge_old_postcards');
    const { data, error } = await sb.rpc('my_mailbox');
    if (error) return toast('Could not open your mailbox.');
    const rows = data || []; $('mailEmpty').hidden = rows.length > 0;
    const paths = rows.map(r => r.thumb_path).filter(Boolean), map = {};
    if (paths.length){ const { data: urls } = await sb.storage.from(B).createSignedUrls(paths, 3600); (urls || []).forEach(u => { if (u.signedUrl) map[u.path] = u.signedUrl; }); }
    $('mailList').replaceChildren(...rows.map(r => buildMail(r, map)));
    drawPrefs();
    await sb.rpc('mark_postcards_read'); $('mailDot').hidden = true;
  }
  $('mailBtn').onclick = () => { open('mailSheet'); loadMail(); };
  $('mailClose').onclick = () => shut('mailSheet');

  /* ----- the little red dot when new mail has arrived ----- */
  async function refreshDot(){
    const { data } = await sb.rpc('mailbox_count');
    $('mailDot').hidden = !(Number(data) > 0);
  }
  function ready(){ $('mailBtn').hidden = false; refreshDot(); }
  document.addEventListener('rewind-profile', ready);
  document.addEventListener('visibilitychange', () => { if (!document.hidden && !$('mailBtn').hidden) refreshDot(); });
  setInterval(() => { if (!document.hidden && !$('mailBtn').hidden) refreshDot(); }, 90000);
  if (api.getProfile()) ready();
})();
