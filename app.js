/* ===== The retro cameras: add or tweak looks here ===== */
const LOOKS = {
  disposable:{name:'Disposable', css:'sepia(.25) contrast(1.15) saturate(1.3) brightness(1.05)',
    contrast:1.15, bright:6, sat:1.25, tint:[14,4,-10], lift:8, grain:34, vig:.35, leak:true, stamp:'#FF9F1C'},
  faded:{name:'Faded Film', css:'contrast(.9) saturate(.75) brightness(1.08) hue-rotate(-8deg)',
    contrast:.88, bright:12, sat:.7, tint:[-4,6,8], lift:26, grain:22, vig:.2},
  classic:{name:'Classic M', css:'contrast(1.05) saturate(.88) sepia(.12) brightness(1.04)',
    contrast:1.06, bright:4, sat:.88, tint:[6,3,-4], lift:14, grain:12, vig:.22},
  polaroid:{name:'Polaroid', css:'sepia(.2) contrast(1.05) saturate(1.1) brightness(1.1)',
    contrast:1.05, bright:12, sat:1.05, tint:[12,6,-6], lift:18, grain:16, vig:.25, frame:true},
  vhs:{name:'VHS Tape', css:'contrast(1.2) saturate(1.4) blur(.4px)',
    contrast:1.2, bright:0, sat:1.35, tint:[-6,0,10], lift:14, grain:42, vig:.3, vhs:true, shift:6},
  night:{name:'Night Owl', css:'brightness(1.2) contrast(1.15) saturate(1.1)',
    contrast:1.12, bright:-2, gamma:.82, sat:1.1, tint:[4,0,2], lift:5, grain:26, vig:.45,
    glow:true, stamp:'#FF9F1C', vert:true}
};

const $ = id => document.getElementById(id);
const video = $('video'), frame = $('frame'), msg = $('msg');
let current = 'disposable', facing = 'environment', stream = null, lastBlob = null;

/* ===== Start screen: swipeable postcards ===== */
const deck = $('cards'), pcs = [...deck.querySelectorAll('.pc')];
const dots = [...document.querySelectorAll('#dots i')], nextBtn = $('next');
const REST = [-1.6, 1.2, -0.8];          // each postcard rests at a slight angle
let idx = 0, dragging = false, startX = 0, dx = 0;

function layout(){
  pcs.forEach((c, i) => {
    const k = i - idx;
    c.style.zIndex = 10 - k;
    c.style.pointerEvents = k === 0 ? 'auto' : 'none';
    if (k < 0){ c.style.transform = 'translateX(-125%) rotate(-16deg)'; c.style.opacity = 0; }
    else {
      const s = Math.min(k, 3);
      c.style.transform = `translateY(${s*14}px) scale(${1 - s*.05}) rotate(${REST[i]}deg)`;
      c.style.opacity = k > 2 ? 0 : 1;
    }
  });
  dots.forEach((d, n) => d.classList.toggle('on', n === idx));
  nextBtn.textContent = idx === pcs.length - 1 ? 'Start shooting' : 'Next';
  $('hintswipe').style.opacity = idx === 0 ? 1 : 0;
}
function advance(){ if (idx < pcs.length - 1){ idx++; layout(); } else finishWelcome(); }
function back(){ if (idx > 0){ idx--; layout(); } }
function finishWelcome(){ try{ localStorage.setItem('flashback-seen','1'); }catch(e){} enterApp(); }
nextBtn.onclick = advance;

deck.addEventListener('pointerdown', e => {
  if (!e.target.closest('.pc')) return;
  dragging = true; startX = e.clientX; dx = 0;
  deck.setPointerCapture(e.pointerId); pcs[idx].classList.add('drag');
});
deck.addEventListener('pointermove', e => {
  if (!dragging) return;
  dx = e.clientX - startX;
  pcs[idx].style.transform = `translateX(${dx}px) rotate(${REST[idx] + dx/18}deg)`;
});
function endDrag(){
  if (!dragging) return;
  dragging = false; pcs[idx].classList.remove('drag');
  if (dx < -70) advance(); else if (dx > 70 && idx > 0) back(); else layout();
}
deck.addEventListener('pointerup', endDrag);
deck.addEventListener('pointercancel', endDrag);

function enterApp(){ $('welcome').hidden = true; startCam(); }
let seen = false;
try{ seen = localStorage.getItem('flashback-seen') === '1'; }catch(e){}
if (seen) enterApp(); else layout();

/* ===== Look picker ===== */
Object.entries(LOOKS).forEach(([key, l]) => {
  const b = document.createElement('button');
  b.className = 'chip'; b.textContent = l.name; b.dataset.key = key;
  b.setAttribute('aria-pressed', key === current);
  b.onclick = () => setLook(key);
  $('looks').appendChild(b);
});
function setLook(key){
  current = key;
  document.querySelectorAll('.chip').forEach(c => c.setAttribute('aria-pressed', c.dataset.key === key));
  $('lookName').textContent = LOOKS[key].name;
  video.style.filter = LOOKS[key].css;
  frame.classList.toggle('sq', !!LOOKS[key].frame);
}
setLook(current);

/* ===== Camera ===== */
async function startCam(){
  if (stream) stream.getTracks().forEach(t => t.stop());
  msg.hidden = true;
  try{
    stream = await navigator.mediaDevices.getUserMedia({
      video:{facingMode:facing, width:{ideal:1280}, height:{ideal:1280}}, audio:false});
    video.srcObject = stream;
    video.classList.toggle('mirror', facing === 'user');
    await video.play();
  }catch(e){
    msg.hidden = false;
    msg.innerHTML = '<div><p>The camera did not start.</p><p>Allow camera access in your browser, or choose a photo from your phone instead.</p>' +
      '<button id="retry">Try again</button></div>';
    $('retry').onclick = startCam;
  }
}
$('flip').onclick = () => { facing = facing === 'user' ? 'environment' : 'user'; startCam(); };

/* ===== Make the photo ===== */
function stampText(){
  const d = new Date(), p = n => String(n).padStart(2,'0');
  return `'${p(d.getFullYear()%100)} ${p(d.getMonth()+1)} ${p(d.getDate())}`;
}

function render(src, sw, sh, mirror){
  const L = LOOKS[current];
  let sx = 0, sy = 0;
  if (L.frame){ const s = Math.min(sw, sh); sx = (sw-s)/2; sy = (sh-s)/2; sw = sh = s; }
  const k = Math.min(1, 1280 / Math.max(sw, sh));
  const w = Math.round(sw*k), h = Math.round(sh*k);
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const ctx = c.getContext('2d');
  if (mirror){ ctx.translate(w,0); ctx.scale(-1,1); }
  ctx.drawImage(src, sx, sy, sw, sh, 0, 0, w, h);
  ctx.setTransform(1,0,0,1,0,0);

  // colors + grain, pixel by pixel
  const img = ctx.getImageData(0,0,w,h), d = img.data;
  const copy = L.shift ? new Uint8ClampedArray(d) : null;
  const gt = L.gamma ? Array.from({length:256}, (_, i) => 255*Math.pow(i/255, L.gamma)) : null;
  for (let i = 0; i < d.length; i += 4){
    let r = d[i], g = d[i+1], b = d[i+2];
    if (copy){ r = copy[Math.min(i + 4*L.shift, d.length-4)]; }   // red channel slips sideways (VHS)
    r = (r-128)*L.contrast + 128 + L.bright;
    g = (g-128)*L.contrast + 128 + L.bright;
    b = (b-128)*L.contrast + 128 + L.bright;
    if (gt){ r = gt[Math.min(255,Math.max(0,r|0))]; g = gt[Math.min(255,Math.max(0,g|0))]; b = gt[Math.min(255,Math.max(0,b|0))]; }
    const gray = .299*r + .587*g + .114*b;
    r = gray + (r-gray)*L.sat; g = gray + (g-gray)*L.sat; b = gray + (b-gray)*L.sat;
    r += L.tint[0]; g += L.tint[1]; b += L.tint[2];
    const f = 1 - L.lift/255;                                     // faded blacks
    r = r*f + L.lift; g = g*f + L.lift; b = b*f + L.lift;
    const n = (Math.random()-.5) * L.grain;                       // film grain
    d[i] = r+n; d[i+1] = g+n; d[i+2] = b+n;                       // Uint8ClampedArray clamps for us
  }
  ctx.putImageData(img, 0, 0);

  // vignette
  const v = ctx.createRadialGradient(w/2,h/2,Math.min(w,h)*.35, w/2,h/2,Math.max(w,h)*.75);
  v.addColorStop(0,'rgba(0,0,0,0)'); v.addColorStop(1,`rgba(0,0,0,${L.vig})`);
  ctx.fillStyle = v; ctx.fillRect(0,0,w,h);

  // soft glow around bright lights
  if (L.glow){
    [8, 20].forEach((f, n) => {
      const gw = Math.max(8, Math.round(w/f)), gh = Math.max(8, Math.round(h/f));
      const s = document.createElement('canvas'); s.width = gw; s.height = gh;
      const sc = s.getContext('2d'); sc.drawImage(c, 0, 0, gw, gh);
      const im = sc.getImageData(0, 0, gw, gh), p = im.data;
      for (let i = 0; i < p.length; i += 4){
        const lum = .299*p[i] + .587*p[i+1] + .114*p[i+2];
        const k = lum > 150 ? (lum-150)/105 : 0;                   // keep only the bright parts
        p[i] *= k; p[i+1] *= k; p[i+2] *= k;
      }
      sc.putImageData(im, 0, 0);
      ctx.globalCompositeOperation = 'screen'; ctx.globalAlpha = n ? .55 : .8;
      ctx.imageSmoothingEnabled = true; ctx.drawImage(s, 0, 0, w, h);   // enlarging blurs it
    });
    ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';
  }

  // light leak
  if (L.leak){
    const g = ctx.createLinearGradient(w,0,w*.55,h*.3);
    g.addColorStop(0,'rgba(255,120,40,.55)'); g.addColorStop(1,'rgba(255,120,40,0)');
    ctx.globalCompositeOperation = 'screen'; ctx.fillStyle = g; ctx.fillRect(0,0,w,h);
    ctx.globalCompositeOperation = 'source-over';
  }

  // VHS scan lines + on-screen text
  if (L.vhs){
    ctx.fillStyle = 'rgba(0,0,0,.18)';
    for (let y = 0; y < h; y += 4) ctx.fillRect(0,y,w,1.5);
    ctx.font = `${Math.round(h*.06)}px VT323, monospace`;
    ctx.fillStyle = '#fff'; ctx.shadowColor = 'rgba(0,0,0,.7)'; ctx.shadowBlur = 4;
    const fs = Math.round(h*.06);
    ctx.beginPath(); ctx.moveTo(w*.05, h*.09 - fs*.7); ctx.lineTo(w*.05, h*.09); ctx.lineTo(w*.05 + fs*.6, h*.09 - fs*.35); ctx.closePath(); ctx.fill();
    ctx.textAlign = 'left'; ctx.fillText('PLAY', w*.05 + fs*.9, h*.09);
    ctx.fillText(stampText().replace(/'/,'') , w*.05, h*.95);
    ctx.shadowBlur = 0;
  }

  // orange date stamp (disposable)
  if (L.stamp){
    ctx.font = `${Math.round(h*.05)}px VT323, monospace`;
    ctx.fillStyle = L.stamp; ctx.shadowColor = 'rgba(255,120,0,.8)'; ctx.shadowBlur = 6;
    if (L.vert){
      ctx.save(); ctx.translate(w*.08, h*.78); ctx.rotate(Math.PI/2);
      ctx.textAlign = 'left'; ctx.fillText(stampText(), 0, 0); ctx.restore();
    } else { ctx.textAlign = 'right'; ctx.fillText(stampText(), w*.95, h*.95); }
    ctx.shadowBlur = 0;
  }

  // white polaroid border
  if (L.frame){
    const bd = Math.round(w*.06), bt = Math.round(w*.22);
    const o = document.createElement('canvas'); o.width = w + bd*2; o.height = h + bd + bt;
    const oc = o.getContext('2d');
    oc.fillStyle = '#FAF7F0'; oc.fillRect(0,0,o.width,o.height);
    oc.drawImage(c, bd, bd);
    return o;
  }
  return c;
}

function show(canvas){
  canvas.toBlob(blob => {
    lastBlob = blob;
    $('out').src = URL.createObjectURL(blob);
    $('result').hidden = false;
  }, 'image/jpeg', .9);
}

$('shutter').onclick = () => {
  if (!video.videoWidth) return;
  show(render(video, video.videoWidth, video.videoHeight, facing === 'user'));
};

$('file').onchange = e => {
  const f = e.target.files[0]; if (!f) return;
  const im = new Image();
  im.onload = () => { show(render(im, im.naturalWidth, im.naturalHeight, false)); URL.revokeObjectURL(im.src); };
  im.src = URL.createObjectURL(f);
  e.target.value = '';
};

/* ===== Save + retake ===== */
$('save').onclick = async () => {
  if (!lastBlob) return;
  const file = new File([lastBlob], `flashback-${Date.now()}.jpg`, {type:'image/jpeg'});
  if (navigator.canShare && navigator.canShare({files:[file]})){
    try{ await navigator.share({files:[file]}); return; }
    catch(e){ if (e.name === 'AbortError') return; }
  }
  const a = document.createElement('a');
  a.href = URL.createObjectURL(lastBlob); a.download = file.name; a.click();
};
$('again').onclick = () => { $('result').hidden = true; };


/* ===== Song picker =====
   The chosen song lives in `song` as { id, title, artist, art, preview, link }.
   Later (Supabase), save those fields with the post. We only store the info and
   links, never the audio itself. */
let song = null, audio = null, searchTimer = null;
const ICON_PLAY = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M8 5v14l11-7z" fill="currentColor" stroke="none"/></svg>`;
const ICON_PAUSE = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="6" y="5" width="4" height="14" rx="1" fill="currentColor" stroke="none"/><rect x="14" y="5" width="4" height="14" rx="1" fill="currentColor" stroke="none"/></svg>`;

function jsonp(url){                       // Apple's search works from any website this way
  return new Promise((resolve, reject) => {
    const cb = 'songcb' + Date.now() + Math.floor(Math.random()*1e4);
    const s = document.createElement('script');
    const done = () => { clearTimeout(t); delete window[cb]; s.remove(); };
    const t = setTimeout(() => { done(); reject(new Error('timeout')); }, 8000);
    window[cb] = data => { done(); resolve(data); };
    s.onerror = () => { done(); reject(new Error('network')); };
    s.src = url + '&callback=' + cb;
    document.head.appendChild(s);
  });
}

const ITUNES = 'https://itunes.apple.com/search?media=music&entity=song&limit=8&term=';
const fromItunes = d => d.results.filter(r => r.previewUrl).map(r => ({
  id: r.trackId, title: r.trackName, artist: r.artistName, art: r.artworkUrl100,
  preview: r.previewUrl, link: r.trackViewUrl, source: 'Apple Music'}));

const ROUTES = [
  async term => {                                   // 1) Apple, normal request
    const r = await fetch(ITUNES + encodeURIComponent(term));
    if (!r.ok) throw new Error('apple ' + r.status);
    return fromItunes(await r.json());
  },
  async term => fromItunes(await jsonp(ITUNES + encodeURIComponent(term))),   // 2) Apple, script trick
  async term => {                                   // 3) Deezer as a backup
    const d = await jsonp('https://api.deezer.com/search?limit=8&output=jsonp&q=' + encodeURIComponent(term));
    return (d.data || []).filter(x => x.preview).map(x => ({
      id: x.id, title: x.title, artist: x.artist.name, art: x.album.cover_medium,
      preview: x.preview, link: x.link, source: 'Deezer'}));
  }
];

async function searchSongs(term){
  let lastErr = null, gotAnswer = false;
  for (const route of ROUTES){
    try{
      const list = await route(term);
      gotAnswer = true;
      if (list.length) return list;
    }catch(e){ lastErr = e; console.warn('Song search route failed:', e); }
  }
  if (gotAnswer) return [];
  throw lastErr || new Error('unknown');
}

function note(text){
  const li = document.createElement('li'); li.className = 'note'; li.textContent = text;
  $('results').replaceChildren(li);
}

function showResults(list){
  if (!list.length) return note('No songs found. Try another search.');
  $('credit').textContent = 'Song info and 30-second previews from ' + list[0].source + '.';
  $('results').replaceChildren(...list.map(item => {
    const li = document.createElement('li'), b = document.createElement('button');
    const img = document.createElement('img'); img.src = item.art; img.alt = '';
    const meta = document.createElement('div'); meta.className = 'meta';
    const t = document.createElement('b'); t.textContent = item.title;
    const a = document.createElement('span'); a.textContent = item.artist;
    meta.append(t, a); b.append(img, meta);
    b.onclick = () => pickSong(item);
    li.appendChild(b); return li;
  }));
}

$('q').addEventListener('input', () => {
  clearTimeout(searchTimer);
  const term = $('q').value.trim();
  if (term.length < 2){ $('results').replaceChildren(); return; }
  note('Searching…');
  searchTimer = setTimeout(async () => {
    try{ const list = await searchSongs(term); if (term === $('q').value.trim()) showResults(list); }
    catch(e){ note('Could not search right now (' + (e.message || 'error') + '). Check your connection and try again.'); }
  }, 350);
});

function openSheet(){ $('sheet').hidden = false; $('q').focus(); }
function closeSheet(){ $('sheet').hidden = true; }
$('addSong').onclick = openSheet;
$('closeSheet').onclick = closeSheet;
$('sheet').addEventListener('click', e => { if (e.target === $('sheet')) closeSheet(); });

function pickSong(item){
  stopSong(); song = item;
  $('songArt').src = item.art;
  $('songTitle').textContent = item.title;
  $('songArtist').textContent = item.artist;
  $('songChip').hidden = false; $('addSong').hidden = true;
  closeSheet();
}

function stopSong(){
  if (audio){ audio.pause(); audio = null; }
  $('songPlay').innerHTML = ICON_PLAY;
}
$('songPlay').onclick = () => {
  if (!song) return;
  if (audio){ stopSong(); return; }
  audio = new Audio(song.preview);
  audio.onended = stopSong;
  audio.play().catch(stopSong);
  $('songPlay').innerHTML = ICON_PAUSE;
};
function clearSong(){
  stopSong(); song = null;
  $('songChip').hidden = true; $('addSong').hidden = false;
}
$('songRemove').onclick = clearSong;

// Retake also clears the song
const retake = $('again').onclick;
$('again').onclick = () => { clearSong(); retake(); };


// Version stamp so you can see which files your phone loaded
$('ver').textContent += ' · script v1.8';


/* ===== Button press animation (works on phones) + shutter flash ===== */
document.addEventListener('pointerdown', e => {
  const b = e.target.closest('button, .side');
  if (b){ b.classList.add('down'); if (navigator.vibrate) navigator.vibrate(8); }
});
const release = () => document.querySelectorAll('.down').forEach(b => b.classList.remove('down'));
document.addEventListener('pointerup', release);
document.addEventListener('pointercancel', release);

const shoot = $('shutter').onclick;
$('shutter').onclick = () => {
  const f = $('flash'); f.classList.remove('go'); void f.offsetWidth; f.classList.add('go');
  shoot();
};
