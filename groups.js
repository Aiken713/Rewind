/* Friend groups: join or create with a code, and post photos (with songs) to a shared film roll. */
(function(){
  const api = window.rewind;
  if (!api) return;                                   // accounts are off, so groups are off too
  const { sb, toast } = api;
  const B = 'rewind-photos', PENDING = 'rewind-join';
  const open = id => { $(id).hidden = false; }, shut = id => { $(id).hidden = true; };
  const say = (id, t) => { $(id).textContent = t; };
  let groups = [], current = null, posting = false, lastRows = [], albumBlob = null, swept = false;

  const nice = e => {
    const m = ((e && e.message) || '').toLowerCase();
    if (m.includes('no such')) return 'No group has that code.';
    if (m.includes('full')) return 'That group is full.';
    if (m.includes('too many')) return 'You can be in up to 5 groups.';
    if (m.includes('daily')) return 'You have posted a lot today. Try again tomorrow.';
    if (m.includes('no account')) return 'Make your nickname first.';
    return 'Something went wrong. Try again.';
  };
  const linkFor = c => location.origin + location.pathname + '#join=' + c;

  /* ----- the list of my groups ----- */
  function renderList(id, onPick){
    $(id).replaceChildren(...groups.map(g => {
      const li = document.createElement('li'), b = document.createElement('button');
      const n = document.createElement('b'); n.textContent = g.name;
      const s = document.createElement('span'); s.textContent = g.members + (Number(g.members) === 1 ? ' member' : ' members');
      b.append(n, s); b.onclick = () => onPick(g); li.appendChild(b); return li;
    }));
  }
  async function loadGroups(){
    const { data, error } = await sb.rpc('my_groups');
    if (error){ toast(nice(error)); return; }
    groups = data || []; renderList('grpList', openRoll);
  }
  $('grpBtn').onclick = async () => { open('grpSheet'); await loadGroups(); };
  $('grpClose').onclick = () => shut('grpSheet');

  /* ----- join or create ----- */
  $('jcBtn').onclick = () => { say('jcErr', ''); shut('grpSheet'); open('jcSheet'); };
  $('jcClose').onclick = () => { shut('jcSheet'); open('grpSheet'); };
  async function joinCode(code){
    const { data, error } = await sb.rpc('join_group', { p_code: code });
    return error ? { error } : { group: data };
  }
  $('joinBtn').onclick = async () => {
    say('jcErr', ''); const code = $('codeIn').value.trim().toUpperCase();
    if (code.length !== 6) return say('jcErr', 'Codes have 6 letters and numbers.');
    const r = await joinCode(code); if (r.error) return say('jcErr', nice(r.error));
    shut('jcSheet'); $('codeIn').value = ''; toast('Joined ' + r.group.name); await loadGroups(); openRoll(r.group);
  };
  $('makeBtn').onclick = async () => {
    say('jcErr', ''); const name = $('gname').value.trim();
    if (!name) return say('jcErr', 'Give your group a name.');
    const { data, error } = await sb.rpc('create_group', { p_name: name });
    if (error) return say('jcErr', nice(error));
    shut('jcSheet'); $('gname').value = ''; await loadGroups(); openRoll(data);
  };

  /* ----- clean up expired photos ----- */
  async function sweep(gid){
    try{
      const { data } = await sb.rpc('expired_paths', { p_group: gid });
      if (data && data.length){ await removeAll(data); await sb.rpc('purge_expired', { p_group: gid }); }
    }catch(e){ console.warn('clean-up', e); }
  }

  /* ----- one group's film roll ----- */
  $('copyCode').onclick = async () => {
    try{ await navigator.clipboard.writeText(linkFor(current.code)); toast('Invite link copied'); }
    catch(e){ toast('Code: ' + current.code); }
  };
  $('shareCode').onclick = async () => {
    const d = { title: 'Join my Rewind group', text: 'Join "' + current.name + '" on Rewind. Code: ' + current.code, url: linkFor(current.code) };
    if (navigator.share){ try{ await navigator.share(d); }catch(e){} } else $('copyCode').onclick();
  };
  async function openRoll(g){
    current = g; say('rollName', g.name); say('rollCode', g.code);
    $('grid').replaceChildren(); $('rollEmpty').hidden = true; open('rollSheet');
    await sweep(g.id);
    $('members').replaceChildren();
    sb.rpc('group_roster', { p_group: g.id }).then(({ data }) => {
      if (!data) return;
      const label = document.createElement('b'); label.className = 'mlabel'; label.textContent = 'Members (' + data.length + ')';
      $('members').replaceChildren(label, ...data.map(u => {
        const s = document.createElement('span'); s.className = 'mchip'; s.append(u.nickname);
        const t = document.createElement('i'); t.textContent = '#' + u.tag + (u.mine ? ' (you)' : ''); s.appendChild(t); return s;
      }));
    });
    const { data, error } = await sb.rpc('group_feed', { p_group: g.id });
    if (error) return toast(nice(error));
    const rows = data || []; lastRows = rows; $('rollEmpty').hidden = rows.length > 0;
    if (!rows.length) return;
    const { data: urls } = await sb.storage.from(B).createSignedUrls(rows.map(r => r.thumb_path), 3600);
    const map = {}; (urls || []).forEach(u => { if (u.signedUrl) map[u.path] = u.signedUrl; });
    $('grid').replaceChildren(...rows.map(r => {
      const b = document.createElement('button'), im = document.createElement('img');
      b.className = 'tile'; b.setAttribute('aria-label', 'Photo by ' + r.nickname);
      im.alt = ''; im.loading = 'lazy'; im.src = map[r.thumb_path] || '';
      const w = document.createElement('span'); w.className = 'who'; w.textContent = r.nickname || '?'; b.append(im, w);
      b.onclick = () => openPhoto(r); return b;
    }));
  }
  let sure = null;
  const resetLeave = () => { clearTimeout(sure); $('leaveBtn').dataset.sure = ''; $('leaveBtn').textContent = 'Leave group'; };
  $('leaveBtn').onclick = async () => {
    if ($('leaveBtn').dataset.sure !== '1'){
      $('leaveBtn').dataset.sure = '1'; $('leaveBtn').textContent = 'Tap again to leave'; sure = setTimeout(resetLeave, 4000); return;
    }
    resetLeave();
    await loadGroups();
    const mine = groups.find(x => x.id === current.id);
    if (mine && Number(mine.members) === 1){            // last one out: delete the photo files too
      const { data: paths } = await sb.rpc('group_paths', { p_group: current.id });
      const all = paths || [];
      for (let i = 0; i < all.length; i += 100) await sb.storage.from(B).remove(all.slice(i, i + 100));
    }
    const { error } = await sb.rpc('leave_group', { p_group: current.id });
    if (error) return toast('Could not leave.');
    shut('rollSheet'); toast('You left ' + current.name); loadGroups();
  };
  $('rollClose').onclick = () => { resetLeave(); shut('rollSheet'); };

  /* ----- one photo, big ----- */
  let viewAudio = null;
  const stopView = () => { if (viewAudio){ viewAudio.pause(); viewAudio = null; } };
  async function openPhoto(r){
    $('viewImg').removeAttribute('src'); say('viewName', r.nickname || '');
    const cap = $('viewCap'); cap.replaceChildren(); cap.hidden = !r.caption;
    if (r.caption){ const nm = document.createElement('b'); nm.textContent = r.nickname || ''; cap.append(nm, ' ' + r.caption); }
    const pl = $('viewPrompt'); pl.textContent = r.prompt ? 'Prompt: ' + r.prompt : ''; pl.hidden = !r.prompt;
    const left = r.expires_at ? Math.max(0, Math.ceil((new Date(r.expires_at) - Date.now()) / 86400000)) : null;
    say('viewMeta', r.nickname + '#' + r.tag + ' · ' + new Date(r.created_at).toLocaleDateString(undefined, { month:'short', day:'numeric' }) +
      (left === null ? '' : ' · ' + left + (left === 1 ? ' day left' : ' days left')));
    $('viewSong').replaceChildren(); $('delPost').hidden = !r.mine; open('viewSheet');
    if (r.song_title){
      const chip = document.createElement('div'); chip.className = 'songchip';
      if (r.song_art){ const a = document.createElement('img'); a.src = r.song_art; a.alt = ''; chip.appendChild(a); }
      const meta = document.createElement('div'); meta.className = 'meta';
      const t = document.createElement('b'); t.textContent = r.song_title;
      const s = document.createElement('span'); s.textContent = r.song_artist || '';
      meta.append(t, s); chip.appendChild(meta);
      if (r.song_preview){
        const p = document.createElement('button'); p.className = 'mini'; p.innerHTML = ICON_PLAY; p.setAttribute('aria-label', 'Play preview');
        p.onclick = () => {
          if (viewAudio){ stopView(); p.innerHTML = ICON_PLAY; return; }
          viewAudio = new Audio(r.song_preview);
          viewAudio.onended = () => { stopView(); p.innerHTML = ICON_PLAY; };
          viewAudio.play().catch(() => {}); p.innerHTML = ICON_PAUSE;
        };
        chip.appendChild(p);
      }
      $('viewSong').appendChild(chip);
    }
    $('delPost').onclick = async () => {
      const { error } = await sb.rpc('delete_post', { p_post: r.id });
      if (error) return toast('Could not delete.');
      await sb.storage.from(B).remove([r.image_path, r.thumb_path]);
      stopView(); shut('viewSheet'); toast('Deleted'); openRoll(current);
    };
    $('sendCard').hidden = !!r.mine;
    $('sendCard').onclick = () => window.openPostcard && window.openPostcard({ kind: 'group', id: r.id, name: r.nickname });
    $('savePhoto').onclick = async () => {                    // photos disappear, so make saving easy
      const { data: blob, error } = await sb.storage.from(B).download(r.image_path);
      if (error || !blob) return toast('Could not save this photo.');
      saveBlob(blob, 'rewind-' + Date.now() + '.jpg');
    };
    const { data } = await sb.storage.from(B).createSignedUrl(r.image_path, 3600);
    if (data) $('viewImg').src = data.signedUrl;
  }
  $('viewClose').onclick = () => { stopView(); shut('viewSheet'); };

  /* ----- post the current photo to a group ----- */
  function shrink(blob, max, q){                        // smaller files keep your free storage going longer
    return new Promise((res, rej) => {
      const im = new Image(), u = URL.createObjectURL(blob);
      im.onload = () => {
        const k = Math.min(1, max / Math.max(im.naturalWidth, im.naturalHeight));
        const c = document.createElement('canvas'); c.width = Math.round(im.naturalWidth * k); c.height = Math.round(im.naturalHeight * k);
        c.getContext('2d').drawImage(im, 0, 0, c.width, c.height); URL.revokeObjectURL(u);
        c.toBlob(b => b ? res(b) : rej(new Error('encode')), 'image/jpeg', q);
      };
      im.onerror = () => rej(new Error('image')); im.src = u;
    });
  }
  $('postBtn').onclick = async () => {
    await loadGroups();
    renderList('postList', doPost);
    const li = document.createElement('li'), b = document.createElement('button');
    const n = document.createElement('b'); n.textContent = 'Public feed';
    const s = document.createElement('span'); s.textContent = 'Everyone on Rewind';
    b.append(n, s); b.onclick = () => window.rewindPostPublic && window.rewindPostPublic(); li.appendChild(b); $('postList').prepend(li);
    say('postSub', 'Pick where to post. Everyone there will see this photo.'); open('postSheet');
  };
  $('postClose').onclick = () => shut('postSheet');
  $('again').addEventListener('click', () => { $('caption').value = ''; $('forPrompt').checked = false; });   // a new photo starts with a blank caption
  async function doPost(g){
    if (posting || !lastBlob) return;
    posting = true; say('postSub', 'Posting…'); let step = 'preparing the photo';
    try{
      let img = await shrink(lastBlob, 960, .68); if (img.size > 900000) img = await shrink(lastBlob, 800, .55);
      const thumb = await shrink(lastBlob, 360, .7);
      step = 'checking your login'; const { data: s } = await sb.auth.getSession();
      const base = g.id + '/' + s.session.user.id + '/' + crypto.randomUUID(), p1 = base + '.jpg', p2 = base + '_t.jpg';
      step = 'uploading the photo'; let r = await sb.storage.from(B).upload(p1, img, { contentType: 'image/jpeg' }); if (r.error) throw r.error;
      step = 'uploading the thumbnail'; r = await sb.storage.from(B).upload(p2, thumb, { contentType: 'image/jpeg' });
      if (r.error){ await sb.storage.from(B).remove([p1]); throw r.error; }
      step = 'saving the post'; const sg = song || {};
      const { error } = await sb.rpc('create_post', { p_group: g.id, p_image: p1, p_thumb: p2, p_title: sg.title || null,
        p_artist: sg.artist || null, p_art: sg.art || null, p_preview: sg.preview || null, p_link: sg.link || null,
        p_caption: $('caption').value.trim() || null,
        p_prompt: $('forPrompt').checked ? (window.dailyPrompt || null) : null });
      if (error){ await sb.storage.from(B).remove([p1, p2]); throw error; }
      shut('postSheet'); toast('Posted to ' + g.name); $('again').click();
    }catch(e){ console.warn(e); say('postSub', nice(e) + ' [' + step + ': ' + ((e && e.message) || e) + ']'); }
    finally{ posting = false; }
  }

  /* ----- saving a file ----- */
  async function saveBlob(blob, name){
    const f = new File([blob], name, { type: blob.type || 'image/jpeg' });
    if (navigator.canShare && navigator.canShare({ files: [f] })){
      try{ await navigator.share({ files: [f] }); return; }catch(e){ if (e.name === 'AbortError') return; }
    }
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; a.click();
  }

  /* ----- monthly album ----- */
  const pic = blob => new Promise((res, rej) => { const im = new Image(); im.onload = () => res(im); im.onerror = rej; im.src = URL.createObjectURL(blob); });
  $('albumBtn').onclick = () => {
    say('albumSub', 'Pick a month and Rewind makes a collage of your group\'s photos from it.');
    $('albumImg').hidden = true; $('albumSave').hidden = true; open('albumSheet');
  };
  $('albumClose').onclick = () => shut('albumSheet');
  $('albumThis').onclick = () => makeAlbum(0);
  $('albumLast').onclick = () => makeAlbum(1);
  $('albumSave').onclick = () => { if (albumBlob) saveBlob(albumBlob, 'rewind-album.jpg'); };
  async function makeAlbum(back){
    const now = new Date(), start = new Date(now.getFullYear(), now.getMonth() - back, 1), end = new Date(now.getFullYear(), now.getMonth() - back + 1, 1);
    const label = start.toLocaleDateString(undefined, { month:'long', year:'numeric' });
    let list = lastRows.filter(r => { const d = new Date(r.created_at); return d >= start && d < end; }).reverse();
    $('albumImg').hidden = true; $('albumSave').hidden = true;
    if (!list.length) return say('albumSub', 'No photos from ' + label + ' yet.');
    if (list.length > 12){ const k = list.length / 12; list = Array.from({ length: 12 }, (_, i) => list[Math.floor(i * k)]); }
    say('albumSub', 'Making your album…');
    try{
      const imgs = [];
      for (const r of list){
        const { data } = await sb.storage.from(B).download(r.thumb_path);
        if (data) imgs.push(await pic(data));
      }
      const W = 1080, pad = 40, gap = 20, cols = 3, t = (W - pad * 2 - gap * (cols - 1)) / cols;
      const rowsN = Math.ceil(imgs.length / cols), head = 240, H = head + rowsN * (t + gap) + pad + 20;
      const c = document.createElement('canvas'); c.width = W; c.height = H;
      const x = c.getContext('2d');
      x.fillStyle = '#EEE2CF'; x.fillRect(0, 0, W, H);
      ['#C73227','#D9A57E','#D1846B','#3F98B0','#0873A8','#7B0C06','#B52707','#C4520F','#DFA00E'].forEach((col, i) => { x.fillStyle = col; x.fillRect(0, i * 9, W, 9); });
      let fs = 76; x.font = '700 ' + fs + 'px Fraunces, Georgia, serif';
      while (x.measureText(current.name).width > W - pad * 2 && fs > 36){ fs -= 4; x.font = '700 ' + fs + 'px Fraunces, Georgia, serif'; }
      x.fillStyle = '#7B0C06'; x.textAlign = 'left'; x.fillText(current.name, pad, 175);
      x.font = '32px "DM Sans", sans-serif'; x.fillStyle = '#3A1A12'; x.fillText(label + '  ·  ' + imgs.length + (imgs.length === 1 ? ' photo' : ' photos'), pad, 222);
      imgs.forEach((im, i) => {
        const px = pad + (i % cols) * (t + gap), py = head + Math.floor(i / cols) * (t + gap);
        x.fillStyle = '#FBF4E4'; x.fillRect(px - 6, py - 6, t + 12, t + 12);
        const s = Math.max(t / im.width, t / im.height), w = im.width * s, h = im.height * s;
        x.save(); x.beginPath(); x.rect(px, py, t, t); x.clip(); x.drawImage(im, px + (t - w) / 2, py + (t - h) / 2, w, h); x.restore();
      });
      x.font = '26px "DM Sans", sans-serif'; x.fillStyle = '#7B0C06'; x.textAlign = 'right'; x.fillText('Made with Rewind', W - pad, H - 22);
      c.toBlob(b => {
        if (!b) return say('albumSub', 'Could not make the album. Try again.');
        albumBlob = b; $('albumImg').src = URL.createObjectURL(b); $('albumImg').hidden = false; $('albumSave').hidden = false;
        say('albumSub', label + ' album ready.');
      }, 'image/jpeg', .92);
    }catch(e){ console.warn(e); say('albumSub', 'Could not make the album. Try again.'); }
  }

  /* ----- delete my account ----- */
  async function removeAll(list){
    for (let i = 0; i < list.length; i += 100) await sb.storage.from(B).remove(list.slice(i, i + 100));
  }
  $('delAcct').onclick = () => { say('delMsg', ''); shut('recSheet'); open('delSheet'); };
  $('delNo').onclick = () => shut('delSheet');
  $('delYes').onclick = async () => {
    const btn = $('delYes'); btn.disabled = true; say('delMsg', 'Deleting…');
    try{
      await loadGroups();
      for (const g of groups){                              // groups where I am the last member: clear every file
        if (Number(g.members) === 1){ const { data } = await sb.rpc('group_paths', { p_group: g.id }); await removeAll(data || []); }
      }
      const { data: mine } = await sb.rpc('my_file_paths'); await removeAll(mine || []);   // my photos in other groups
      const { error } = await sb.rpc('delete_account'); if (error) throw error;
      try{
        await sb.auth.signOut({ scope: 'local' });
      }catch(e){}
      try{
        Object.keys(localStorage).filter(k => k.startsWith('sb-') || k.startsWith('flashback-')).forEach(k => localStorage.removeItem(k));
        sessionStorage.clear();
      }catch(e){}
      location.reload();
    }catch(e){ console.warn(e); say('delMsg', 'Could not delete your account. Try again.'); btn.disabled = false; }
  };

  window.rewindShrink = shrink; window.rewindSaveBlob = saveBlob; window.rewindRemoveAll = removeAll;   // shared with feed.js

  /* ----- invite links and start up ----- */
  const m = location.hash.match(/join=([A-Za-z0-9]{6})/);
  if (m){
    try{ sessionStorage.setItem(PENDING, m[1].toUpperCase()); }catch(e){}
    history.replaceState(null, '', location.pathname + location.search);
  }
  async function ready(){
    $('grpBtn').hidden = false; $('postBtn').hidden = false; $('caption').hidden = false; $('tagrow').hidden = false;
    if (!swept){ swept = true; loadGroups().then(() => groups.forEach(x => sweep(x.id))); }
    let code = null; try{ code = sessionStorage.getItem(PENDING); sessionStorage.removeItem(PENDING); }catch(e){}
    if (!code) return;
    const r = await joinCode(code);
    if (r.error) return toast(nice(r.error));
    toast('Joined ' + r.group.name); await loadGroups(); openRoll(r.group);
  }
  document.addEventListener('rewind-profile', ready);
  if (api.getProfile()) ready();
})();
