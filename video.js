/* Version 5: a VHS video camera. The video is processed live on your phone and saved to your camera roll.
   Nothing is uploaded. */
(function(){
  const VW = 360, VH = 480;                                  // low resolution on purpose: it is part of the VHS look
  const vc = $('vhsCanvas'); vc.width = VW; vc.height = VH;
  const vctx = vc.getContext('2d', { willReadFrequently: true });
  const hint = document.querySelector('#result .hint'), hintText = hint.textContent;
  const MON = ['JAN','FEB','MAR','APR','MAY','JUN','JUL','AUG','SEP','OCT','NOV','DEC'];

  // pre-made overlay: a soft vignette and scan lines
  const ov = document.createElement('canvas'); ov.width = VW; ov.height = VH;
  (() => {
    const x = ov.getContext('2d');
    const g = x.createRadialGradient(VW/2, VH/2, VH*.35, VW/2, VH/2, VH*.75);
    g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(1, 'rgba(0,0,0,.45)');
    x.fillStyle = g; x.fillRect(0, 0, VW, VH);
    x.fillStyle = 'rgba(0,0,0,.2)'; for (let y = 0; y < VH; y += 3) x.fillRect(0, y, VW, 1);
  })();
  const NZ = new Int8Array(65536); for (let i = 0; i < NZ.length; i++) NZ[i] = (Math.random() - .5) * 34;   // ready-made film noise
  const copy = new Uint8ClampedArray(VW * VH * 4);

  let on = false, last = 0, rec = null, chunks = [], recStart = 0, ticker = null, noteT = null;
  let lastVideo = null, ext = 'mp4';
  const fmt = s => Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0');
  const secs = () => Math.floor((performance.now() - recStart) / 1000);
  const stamp = () => { const d = new Date(), p = n => String(n).padStart(2, '0');
    return MON[d.getMonth()] + '. ' + p(d.getDate()) + ' ' + d.getFullYear() + '  ' + p(d.getHours()) + ':' + p(d.getMinutes()); };
  const tagName = () => on ? 'VHS Tape' : LOOKS[current].name;
  function note(t){ $('lookName').textContent = t; clearTimeout(noteT); noteT = setTimeout(() => { if (!rec) $('lookName').textContent = tagName(); }, 3000); }

  /* ----- one frame of VHS ----- */
  function frameLoop(t){
    if (!on) return;
    requestAnimationFrame(frameLoop);
    if (t - last < 32 || !$('result').hidden || !video.videoWidth) return;      // about 30 frames a second, and rest while a result is showing
    last = t;
    const vw = video.videoWidth, vh = video.videoHeight, s = Math.max(VW / vw, VH / vh), w = vw * s, h = vh * s;
    vctx.save();
    if (facing === 'user'){ vctx.translate(VW, 0); vctx.scale(-1, 1); }
    vctx.drawImage(video, (VW - w) / 2, (VH - h) / 2, w, h);
    vctx.restore();

    const by = ((t * .09) % (VH + 40)) - 20;                                      // a thin tracking line drifting down
    if (by > 0 && by < VH - 14) vctx.drawImage(vc, 0, by, VW, 14, (Math.random() - .5) * 10, by, VW, 14);
    if ((t % 4500) < 200){ const gy = Math.random() * (VH - 40); vctx.drawImage(vc, 0, gy, VW, 40, (Math.random() - .5) * 50, gy, VW, 40); }

    const img = vctx.getImageData(0, 0, VW, VH), d = img.data, n = d.length, off = (Math.random() * 65536) | 0;
    copy.set(d);
    for (let i = 0; i < n; i += 4){
      let r = copy[Math.min(i + 12, n - 4)], g = copy[i + 1], b = copy[Math.max(i - 12, 0) + 2];   // colors bleed sideways
      r = (r - 128) * 1.18 + 132; g = (g - 128) * 1.18 + 128; b = (b - 128) * 1.18 + 124;
      const y = .299 * r + .587 * g + .114 * b;
      const nz = NZ[((i >> 2) + off) & 65535];
      d[i] = y + (r - y) * 1.3 + nz; d[i + 1] = y + (g - y) * 1.3 + nz; d[i + 2] = y + (b - y) * 1.3 + nz;
    }
    vctx.putImageData(img, 0, 0);
    vctx.drawImage(ov, 0, 0);

    vctx.font = '30px VT323, monospace'; vctx.textAlign = 'left'; vctx.shadowColor = 'rgba(0,0,0,.8)'; vctx.shadowBlur = 3;
    vctx.fillStyle = '#fff';
    if (rec){
      if (Math.floor(t / 500) % 2 === 0){ vctx.fillStyle = '#ff3b30'; vctx.beginPath(); vctx.arc(24, 30, 7, 0, 7); vctx.fill(); vctx.fillStyle = '#fff'; }
      vctx.fillText('REC ' + fmt(secs()), 40, 38);
    } else vctx.fillText('STBY', 16, 38);
    vctx.fillText(stamp(), 16, VH - 18);
    vctx.shadowBlur = 0;
  }

  /* ----- photo / video switch ----- */
  function setMode(m){
    if (rec) return;
    if (m === 'video' && (typeof MediaRecorder === 'undefined' || !vc.captureStream)){ note('Video is not supported here'); return; }
    on = m === 'video';
    $('modePhoto').setAttribute('aria-pressed', !on); $('modeVideo').setAttribute('aria-pressed', on);
    frame.classList.toggle('vmode', on);
    frame.classList.toggle('sq', !on && !!LOOKS[current].frame);
    $('looks').hidden = on; $('vlooks').hidden = !on;
    video.style.filter = on ? 'none' : LOOKS[current].css;
    $('lookName').textContent = tagName();
    if (on) requestAnimationFrame(frameLoop);
  }
  $('modePhoto').onclick = () => setMode('photo');
  $('modeVideo').onclick = () => setMode('video');

  /* ----- record ----- */
  async function startRec(){
    const types = ['video/mp4;codecs=avc1,mp4a.40.2', 'video/mp4', 'video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm'];
    const mime = types.find(t => MediaRecorder.isTypeSupported(t)) || '';
    let mic = null;
    try{ mic = await navigator.mediaDevices.getUserMedia({ audio: true }); }catch(e){ note('No microphone: silent video'); }
    const out = vc.captureStream(30);
    if (mic) mic.getAudioTracks().forEach(t => out.addTrack(t));
    chunks = [];
    try{ rec = new MediaRecorder(out, mime ? { mimeType: mime, videoBitsPerSecond: 2500000 } : { videoBitsPerSecond: 2500000 }); }
    catch(e){ if (mic) mic.getTracks().forEach(t => t.stop()); return note('Could not start recording'); }
    const r = rec;
    r.ondataavailable = e => { if (e.data && e.data.size) chunks.push(e.data); };
    r.onstop = () => { if (mic) mic.getTracks().forEach(t => t.stop()); finish(r.mimeType || mime || 'video/mp4'); };
    r.start(1000); recStart = performance.now();
    $('shutter').classList.add('rec');
    ticker = setInterval(() => { const s = secs(); $('lookName').textContent = 'REC ' + fmt(s); if (s >= 60) stopRec(); }, 250);   // 60 seconds is the longest clip
  }
  function stopRec(){ if (rec && rec.state !== 'inactive') rec.stop(); }
  function finish(type){
    clearInterval(ticker); $('shutter').classList.remove('rec');
    const base = type.split(';')[0];
    lastVideo = new Blob(chunks, { type: base }); ext = base.includes('mp4') ? 'mp4' : 'webm';
    rec = null; $('lookName').textContent = tagName();
    if (!lastVideo.size) return note('Nothing was recorded');
    const v = $('outVid'); v.src = URL.createObjectURL(lastVideo);
    hint.textContent = 'On iPhone, pick "Save Video" in the menu to put it in your camera roll.';
    $('save').textContent = 'Save video';
    $('result').classList.add('vid'); $('result').hidden = false;
    v.play().catch(() => {});
  }

  const photoShutter = $('shutter').onclick;
  $('shutter').onclick = () => { if (!on) return photoShutter(); if (rec) stopRec(); else startRec(); };
  const flip = $('flip').onclick; $('flip').onclick = () => { if (!rec) flip(); };

  /* ----- save, and go again ----- */
  async function saveVideo(){
    if (!lastVideo) return;
    const f = new File([lastVideo], 'rewind-' + Date.now() + '.' + ext, { type: lastVideo.type });
    if (navigator.canShare && navigator.canShare({ files: [f] })){
      try{ await navigator.share({ files: [f] }); return; }catch(e){ if (e.name === 'AbortError') return; }
    }
    const a = document.createElement('a'); a.href = URL.createObjectURL(lastVideo); a.download = f.name; a.click();
  }
  const photoSave = $('save').onclick;
  $('save').onclick = () => $('result').classList.contains('vid') ? saveVideo() : photoSave();
  const photoAgain = $('again').onclick;
  $('again').onclick = () => {
    if ($('result').classList.contains('vid')){
      const v = $('outVid'); v.pause(); v.removeAttribute('src'); v.load();
      $('result').classList.remove('vid'); hint.textContent = hintText; $('save').textContent = 'Save to camera roll'; lastVideo = null;
    }
    photoAgain();
  };
})();
