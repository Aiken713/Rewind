/* Daily fun: a prompt and a camera of the day. Everyone sees the same ones, with no server needed. */
(function(){
  const PROMPTS = [
    "Something orange",
    "Your breakfast",
    "The weirdest thing near you",
    "A shadow",
    "Something older than you",
    "Your shoes",
    "A reflection",
    "Something round",
    "The view from your window",
    "A snack",
    "Something blue",
    "Your hands doing something",
    "A door",
    "Something that makes you smile",
    "The sky right now",
    "A pet or a plant",
    "Something you can't live without",
    "Something tiny",
    "A line or a pattern",
    "Your favorite place to sit",
    "Something yellow",
    "The best light you can find",
    "Your drink",
    "A sign or some writing",
    "Something borrowed",
    "What's in your bag",
    "A staircase",
    "Something soft",
    "The street outside",
    "A funny coincidence",
    "Something red",
    "Your desk or workspace",
    "Something green",
    "A crowd or an empty room",
    "Something you made",
    "Your music right now",
    "A tree",
    "Something broken or worn",
    "Dinner",
    "A friend at their best angle"
  ];
  const keys = Object.keys(LOOKS);
  const day = Math.floor(Date.now() / 86400000);                 // the same number for everyone on the same (UTC) day
  const prompt = PROMPTS[(day * 7 + 3) % PROMPTS.length];
  const cotd = keys[(day * 5 + 1) % keys.length];
  window.dailyPrompt = prompt; window.dailyCamera = cotd;

  $('dailyPrompt').textContent = prompt;
  $('dailyCam').textContent = LOOKS[cotd].name;
  document.querySelectorAll('.chip').forEach(c => { if (c.dataset.key === cotd) c.classList.add('today'); });

  let last = null; try{ last = localStorage.getItem('rewind-day'); }catch(e){}
  if (last !== String(day)){                                      // each new day starts on the camera of the day
    setLook(cotd);
    try{ localStorage.setItem('rewind-day', String(day)); }catch(e){}
  }
})();
