/* The public feed: a scrolling feed of posts with names, captions, songs and reactions. It ends after 20 photos. */
(function(){
  const api = window.rewind;
  if (!api) return;                                    // accounts are off, so the feed is off too
  const { sb, toast } = api;
  const B = 'rewind-photos';
  const open = id => { $(id).hidden = false; }, shut = id => { $(id).hidden = true; };
  const say = (id, t) => { $(id).textContent = t; };
  const svg = p => '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + p + '</svg>';
  const ICON = {
    mail: svg('<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 7l9 6 9-6"/>'),
    save: svg('<path d="M12 4v11M7 11l5 5 5-5"/><path d="M5 20h14"/>'),
    flag: svg('<path d="M5 21V4"/><path d="M5 4h11l-2 4 2 4H5"/>'),
    trash: svg('<path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/>'),
    sound: svg('<path d="M4 9v6h4l5 4V5L8 9z"/><path d="M16.5 8.5a5 5 0 0 1 0 7"/>'),
    mute: svg('<path d="M4 9v6h4l5 4V5L8 9z"/><path d="M17 9l5 6M22 9l-5 6"/>')
  };
  const KINDS = [
    ['love', 'Love this look', svg('<rect x="3" y="6" width="18" height="12" rx="2"/><circle cx="9" cy="12" r="2"/><circle cx="15" cy="12" r="2"/><path d="M8 18l1.5-3h5L16 18"/>')],
    ['shot', 'Great shot', svg('<path d="M12 3l2.2 5.6 5.8.9-4.4 3.7L17 19l-5-3.1L7 19l1.4-5.8L4 9.5l5.8-.9z"/>')],
    ['funny', 'Funny', svg('<circle cx="12" cy="12" r="9"/><path d="M8 14c1 1.6 2.4 2.4 4 2.4s3-.8 4-2.4M9 9.5h.01M15 9.5h.01"/>')],
    ['nostalgic', 'Nostalgic', svg('<path d="M11 6l-7 6 7 6zM20 6l-7 6 7 6z"/>')]
  ];
  const SILENT = 'data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEARKwAAIhYAQACABAAZGF0YQAAAAA=';
  let imgIO = null, viewIO = null, playing = null, active = null, armed = null, swept = false, posting = false, soundOn = true;
  try{ soundOn = localStorage.getItem('rewind-sound') !== '0'; }catch(e){}
  const ax = new Audio();
  const friendly = e => {
    const m = ((e && e.message) || '').toLowerCase();
    if (m.includes('daily')) return 'You can post 3 times a day to the public feed.';
    if (m.includes('no account')) return 'Make your nickname first.';
    return 'Something went wrong. Try again.';
  };
  const ago = d => {
    const m = Math.floor((Date.now() - new Date(d)) / 60000);
    return m < 1 ? 'just now' : m < 60 ? m + 'm ago' : m < 1440 ? Math.floor(m / 60) + 'h ago' : Math.floor(m / 1440) + 'd ago';
  };

  /* ----- songs: plays as a post scrolls into view (if the sound is on) ----- */
  const setPlayIcon = (card, on) => { if (card && card.btn) card.btn.innerHTML = on ? ICON_PAUSE : ICON_PLAY; };
  function stopCard(){ ax.pause(); setPlayIcon(playing, false); playing = null; }
  function playCard(card){
    if (!card || !card.preview) return;
    if (playing && playing !== card) setPlayIcon(playing, false);
    playing = card; ax.src = card.preview; setPlayIcon(card, true);
    ax.play().catch(() => { setPlayIcon(card, false); playing = null; });
  }
  ax.onended = () => { setPlayIcon(playing, false); playing = null; };
  function drawSound(){
    const b = $('feedSound'); b.innerHTML = soundOn ? ICON.sound : ICON.mute;
    b.setAttribute('aria-pressed', String(soundOn)); b.setAttribute('aria-label', soundOn ? 'Sound on' : 'Sound off');
  }
  $('feedSound').onclick = () => {
    soundOn = !soundOn; try{ localStorage.setItem('rewind-sound', soundOn ? '1' : '0'); }catch(e){}
    drawSound(); if (!soundOn) stopCard(); else if (active) playCard(active);
  };

  /* ----- reactions ----- */
  function drawReacts(r, box){
    box.replaceChildren(...KINDS.map(([k, label, icon]) => {
      const b = document.createElement('button');
      b.className = 'react' + ((r.mine_kinds || []).includes(k) ? ' on' : '');
      b.setAttribute('aria-label', label); b.title = label; b.innerHTML = icon;
      const n = document.createElement('span'); n.textContent = String(Number(r[k]) || 0); b.appendChild(n);
      const flip = () => {
        const has = (r.mine_kinds || []).includes(k);
        r.mine_kinds = has ? r.mine_kinds.filter(x => x !== k) : [...(r.mine_kinds || []), k];
        r[k] = Number(r[k] || 0) + (has ? -1 : 1); drawReacts(r, box);
      };
      b.onclick = async () => {
        flip();
        const { error } = await sb.rpc('react', { p_post: r.id, p_kind: k });
        if (error){ flip(); toast('Could not react.'); }
      };
      return b;
    }));
  }

  /* ----- one post ----- */
  function twoTap(btn, verb, action){                   // the first tap arms the button, the second does it
    btn.onclick = () => {
      if (armed === btn){ armed = null; btn.classList.remove('arm'); action(); return; }
      if (armed) armed.classList.remove('arm');
      armed = btn; btn.classList.add('arm'); toast('Tap again to ' + verb);
      setTimeout(() => { if (armed === btn){ armed = null; btn.classList.remove('arm'); } }, 4000);
    };
  }
  const el = (tag, cls, text) => { const x = document.createElement(tag); if (cls) x.className = cls; if (text !== undefined) x.textContent = text; return x; };
  function buildCard(r, thumbs, fulls){
    const card = el('article', 'fcard'), c = { el: card, preview: r.song_preview || null, btn: null };
    card.__card = c;
    const who = el('div', 'fwho'); who.append(el('b', '', r.nickname || '?'), el('i', '', '#' + (r.tag || '')));
    const left = Math.max(0, Math.ceil((new Date(r.expires_at) - Date.now()) / 86400000));
    card.appendChild(Object.assign(el('div', 'fhead'), {})).append(who, el('span', 'fmeta', ago(r.created_at) + ' · ' + left + (left === 1 ? ' day left' : ' days left')));

    const ph = el('div', 'fphoto'), im = document.createElement('img');
    im.alt = 'Photo by ' + (r.nickname || 'someone'); im.src = thumbs[r.thumb_path] || ''; im.dataset.full = fulls[r.image_path] || '';
    ph.appendChild(im); card.appendChild(ph); imgIO.observe(im);

    const row = el('div', 'frow'), reacts = el('div', 'freacts'), acts = el('div', 'fact');
    drawReacts(r, reacts);
    const save = el('button', 'ico'); save.innerHTML = ICON.save; save.setAttribute('aria-label', 'Save to camera roll'); save.title = 'Save to camera roll';
    save.onclick = async () => {                          // photos disappear after 2 weeks, so make saving easy
      const { data: blob, error } = await sb.storage.from(B).download(r.image_path);
      if (error || !blob) return toast('Could not save this photo.');
      window.rewindSaveBlob(blob, 'rewind-' + Date.now() + '.jpg');
    };
    acts.appendChild(save);
    if (r.mine){
      const del = el('button', 'ico'); del.innerHTML = ICON.trash; del.setAttribute('aria-label', 'Delete this photo'); del.title = 'Delete';
      twoTap(del, 'delete', async () => {
        const { error } = await sb.rpc('delete_public_post', { p_post: r.id });
        if (error) return toast('Could not delete.');
        await sb.storage.from(B).remove([r.image_path, r.thumb_path]); removeCard(c); toast('Deleted');
      });
      acts.appendChild(del);
    } else {
      const mail = el('button', 'ico'); mail.innerHTML = ICON.mail; mail.setAttribute('aria-label', 'Send a postcard'); mail.title = 'Send a postcard';
      mail.onclick = () => window.openPostcard && window.openPostcard({ kind: 'public', id: r.id, name: r.nickname });
      acts.appendChild(mail);
      const rep = el('button', 'ico'); rep.innerHTML = ICON.flag; rep.setAttribute('aria-label', 'Report this photo'); rep.title = 'Report';
      twoTap(rep, 'report', async () => {
        const { error } = await sb.rpc('report_post', { p_post: r.id, p_reason: 'reported' });
        if (error) return toast('Could not send the report.');
        removeCard(c); toast('Thanks. That photo is hidden for you.');
      });
      acts.appendChild(rep);
    }
    row.append(reacts, acts); card.appendChild(row);

    if (r.caption || r.prompt || r.song_title){
      const body = el('div', 'fbody');
      if (r.caption){ const cap = el('p', 'fcap'); cap.append(el('b', '', r.nickname || ''), ' ' + r.caption); body.appendChild(cap); }
      if (r.prompt) body.appendChild(el('p', 'promptlabel', 'Prompt: ' + r.prompt));
      if (r.song_title){
        const chip = el('div', 'songchip');
        if (r.song_art){ const a = document.createElement('img'); a.src = r.song_art; a.alt = ''; chip.appendChild(a); }
        const meta = el('div', 'meta'); meta.append(el('b', '', r.song_title), el('span', '', r.song_artist || '')); chip.appendChild(meta);
        if (r.song_preview){
          const p = el('button', 'mini'); p.innerHTML = ICON_PLAY; p.setAttribute('aria-label', 'Play or pause the song');
          p.onclick = () => { if (playing === c) stopCard(); else playCard(c); };
          c.btn = p; chip.appendChild(p);
        }
        body.appendChild(chip);
      }
      card.appendChild(body);
    }
    viewIO.observe(card);
    return c;
  }
  function removeCard(c){
    if (playing === c) stopCard(); if (active === c) active = null;
    viewIO.unobserve(c.el); c.el.remove();
    if (!$('feedList').children.length){ $('feedEnd').hidden = true; $('feedMsg').hidden = false; }
  }

  /* ----- the feed ----- */
  async function loadFeed(){
    if (imgIO) imgIO.disconnect(); if (viewIO) viewIO.disconnect(); stopCard(); active = null;
    $('feedList').replaceChildren(); ['feedMsg', 'feedEnd', 'feedGate'].forEach(i => { $(i).hidden = true; });
    sizeCards(); $('feedScroll').scrollTop = 0;
    imgIO = new IntersectionObserver(es => es.forEach(e => {
      if (!e.isIntersecting) return;
      const im = e.target; if (im.dataset.full) im.src = im.dataset.full; imgIO.unobserve(im);       // swap in the sharp photo as it nears the screen
    }), { root: $('feedScroll'), rootMargin: '600px 0px' });
    viewIO = new IntersectionObserver(es => es.forEach(e => {
      const c = e.target.__card;
      if (e.intersectionRatio >= .6){ active = c; if (soundOn) playCard(c); }
      else if (playing === c) stopCard();
    }), { root: $('feedScroll'), threshold: [0, .6] });
    const { data, error } = await sb.rpc('public_feed');
    if (error){
      if (((error.message) || '').toLowerCase().includes('post to peek')){ $('feedGate').hidden = false; return; }
      return toast('Could not load the feed.');
    }
    const rows = data || [];
    if (!rows.length){ $('feedMsg').hidden = false; return; }
    const [t, f] = await Promise.all([
      sb.storage.from(B).createSignedUrls(rows.map(r => r.thumb_path), 3600),
      sb.storage.from(B).createSignedUrls(rows.map(r => r.image_path), 3600)
    ]);
    const thumbs = {}, fulls = {};
    (t.data || []).forEach(u => { if (u.signedUrl) thumbs[u.path] = u.signedUrl; });
    (f.data || []).forEach(u => { if (u.signedUrl) fulls[u.path] = u.signedUrl; });
    $('feedList').replaceChildren(...rows.map(r => buildCard(r, thumbs, fulls).el));
    $('feedEnd').hidden = false;                         // the feed has an end on purpose
  }
  function sizeCards(){                                  // each post is as tall as the feed window
    const h = $('feedScroll').clientHeight;
    if (h) $('feedList').style.setProperty('--ph', h + 'px');
  }
  window.addEventListener('resize', sizeCards);
  $('feedBtn').onclick = () => {
    try{ ax.src = SILENT; ax.play().catch(() => {}); }catch(e){}     // a tap unlocks sound, so songs can start by themselves later
    drawSound(); open('feedSheet'); sizeCards(); loadFeed();
  };
  $('feedClose').onclick = () => { stopCard(); shut('feedSheet'); };
  $('feedTake').onclick = () => { stopCard(); shut('feedSheet'); toast('Take a photo and post it to unlock the feed.'); };

  /* ----- post to the public feed (called from the "Where to post" list) ----- */
  window.rewindPostPublic = async () => {
    if (posting || !lastBlob) return;
    posting = true; say('postSub', 'Posting…'); let step = 'preparing the photo';
    try{
      const shrink = window.rewindShrink;
      let img = await shrink(lastBlob, 960, .68); if (img.size > 900000) img = await shrink(lastBlob, 800, .55);
      const thumb = await shrink(lastBlob, 360, .7);
      step = 'checking your login'; const { data: s } = await sb.auth.getSession();
      const base = 'public/' + s.session.user.id + '/' + crypto.randomUUID(), p1 = base + '.jpg', p2 = base + '_t.jpg';
      step = 'uploading the photo'; let r = await sb.storage.from(B).upload(p1, img, { contentType: 'image/jpeg' }); if (r.error) throw r.error;
      step = 'uploading the thumbnail'; r = await sb.storage.from(B).upload(p2, thumb, { contentType: 'image/jpeg' });
      if (r.error){ await sb.storage.from(B).remove([p1]); throw r.error; }
      step = 'saving the post'; const sg = song || {};
      const { error } = await sb.rpc('create_public_post', { p_image: p1, p_thumb: p2, p_title: sg.title || null, p_artist: sg.artist || null,
        p_art: sg.art || null, p_preview: sg.preview || null, p_link: sg.link || null,
        p_caption: $('caption').value.trim() || null, p_prompt: $('forPrompt').checked ? (window.dailyPrompt || null) : null });
      if (error){ await sb.storage.from(B).remove([p1, p2]); throw error; }
      shut('postSheet'); toast('Posted to the public feed'); $('again').click();
    }catch(e){ console.warn(e); say('postSub', friendly(e) + ' [' + step + ': ' + ((e && e.message) || e) + ']'); }
    finally{ posting = false; }
  };

  /* ----- start up: show the button, and sweep out expired photos once ----- */
  async function sweep(){
    try{
      const { data } = await sb.rpc('expired_public_paths');
      if (data && data.length){ await window.rewindRemoveAll(data); await sb.rpc('purge_expired_public'); }
    }catch(e){ console.warn('feed clean-up', e); }
  }
  function ready(){ $('feedBtn').hidden = false; if (!swept){ swept = true; sweep(); } }
  document.addEventListener('rewind-profile', ready);
  if (api.getProfile()) ready();
})();
