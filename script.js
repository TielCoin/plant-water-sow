// Completely block default touch gestures on the page

document.addEventListener('touchmove', function(e) {
    e.preventDefault();
}, { passive: false });
/* script.js
   Full game logic. Place this file alongside index.html and style.css
   and the required PNGs:
     Front.png, Back.PNG, Health.PNG, Dead.PNG, Bg.png, sun.png
*/

// --- Canvas setup
const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');
function resize() {
  canvas.width = window.innerWidth;
  canvas.height = window.innerHeight;
}
window.addEventListener('resize', resize);
resize();

// --- UI elements
const startDialog = document.getElementById('startDialog');
const startBtn = document.getElementById('startBtn');
const loaderText = document.getElementById('loaderText');
const endScreen = document.getElementById('endScreen');

// --- Asset list (exact filenames)
const ASSETS = {
  Front: 'Front.png',
  Back: 'Back.PNG',
  Health: 'Health.PNG',
  Dead: 'Dead.PNG',
  Bg: 'Bg.png',
  Sun: 'sun.png'
};

// --- Web sounds (hosted)
const ORB_SPAWN_URL = 'https://actions.google.com/sounds/v1/cartoon/pop.ogg';
const ORB_COLLECT_URL = 'https://actions.google.com/sounds/v1/cartoon/wood_plank_flicks.ogg';

// Preload Image storage
const imgs = {};
let assetsTotal = Object.keys(ASSETS).length;
let assetsLoaded = 0;

// Preload images with progress
function preloadAssets() {
  return new Promise((resolve) => {
    assetsLoaded = 0;
    Object.entries(ASSETS).forEach(([key, path]) => {
      const img = new Image();
      img.onload = () => { imgs[key] = img; assetsLoaded++; updateLoader(); if (assetsLoaded === assetsTotal) resolve(); };
      img.onerror = () => { imgs[key] = null; assetsLoaded++; updateLoader(); if (assetsLoaded === assetsTotal) resolve(); };
      img.src = path;
    });
  });
}

function updateLoader() {
  const pct = Math.round((assetsLoaded / assetsTotal) * 100);
  loaderText.textContent = `Loading assets... ${pct}%`;
}

// --- Sounds (Audio objects)
const audioOrbSpawn = new Audio(ORB_SPAWN_URL);
const audioOrbCollect = new Audio(ORB_COLLECT_URL);

// Small WebAudio splash for hits (works without external files)
const AudioCtx = window.AudioContext || window.webkitAudioContext;
const audioCtx = AudioCtx ? new AudioCtx() : null;
function playSplash(volume = 0.16, freq = 700, dur = 0.26) {
  if (!audioCtx) return;
  const o = audioCtx.createOscillator();
  const g = audioCtx.createGain();
  o.type = 'triangle';
  o.frequency.setValueAtTime(freq, audioCtx.currentTime);
  g.gain.setValueAtTime(volume, audioCtx.currentTime);
  g.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + dur);
  o.connect(g); g.connect(audioCtx.destination);
  o.start(); o.stop(audioCtx.currentTime + dur);
}

// --- Game state
let running = false;
let lastTS = 0;
let rafId = 0;

let timeLeft = 60.0; // 60s gameplay
let score = 0;

const player = {
  x: window.innerWidth / 2,
  y: window.innerHeight - 135,
  w: 120, h: 140,
  dir: 'back',        // 'back' or 'front'
  targetX: window.innerWidth / 2,
  ease: 0.16
};

const plants = []; // array of {x,y,w,h,thirst,alive,grow}
const drops = [];  // water drops {x,y,vx,vy,life}
let orb = null;    // orb {x,y,r,vy}
let lastOrbTime = 0;
let sunlightMeter = 0;
let superReady = false;
const particles = [];

// --- Utility funcs
function rand(min, max) { return min + Math.random() * (max - min); }
function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }

// --- Initialize plants
function spawnPlants() {
  plants.length = 0;
  const count = 4 + Math.floor(Math.random() * 2); // 4-5 plants
  const margin = 80;
  const minDistance = 120; // Minimum distance between plants

  for (let i = 0; i < count; i++) {
    let px, py;
    let safe = false;
    let tries = 0;
    do {
      px = margin + Math.random() * (canvas.width - margin * 2);
      py = canvas.height * 0.35 + Math.random() * canvas.height * 0.18;
      safe = plants.every(p => Math.hypot(p.x - px, p.y - py) >= minDistance);
      tries++;
    } while (!safe && tries < 50);

    plants.push({
      x: px, y: py,
      w: 110, h: 78,
      thirst: 100,
      alive: true,
      grow: 0
    });
  }
}

// --- Input: touch/mouse swipe handling
let touchStart = null;
canvas.addEventListener('touchstart', e => { touchStart = e.touches[0]; }, { passive: true });
canvas.addEventListener('touchend', e => {
  if (!touchStart) return;
  const t = e.changedTouches[0];
  handleSwipe(t.clientX, t.clientY, touchStart.clientX, touchStart.clientY);
  touchStart = null;
}, { passive: true });

let mouseDown = null;
canvas.addEventListener('mousedown', e => { mouseDown = { x: e.clientX, y: e.clientY }; });
canvas.addEventListener('mouseup', e => {
  if (!mouseDown) return;
  handleSwipe(e.clientX, e.clientY, mouseDown.x, mouseDown.y);
  mouseDown = null;
});
function handleSwipe(endX, endY, startX, startY) {
  const dx = endX - startX, dy = endY - startY;
  // move player if horizontal swipe near bottom
  if (Math.abs(dy) < 50 && Math.abs(dx) > 20 && startY > (canvas.height - 180)) {
    player.targetX = clamp(player.x + dx, 80, canvas.width - 80);
    return;
  }
  // upward swipe -> throw
  if (dy < -28) {
    // Super throw if ready
    if (superReady) {
      plants.forEach(p => { if (p.alive) { p.thirst = 100; p.grow = 1; } });
      sunlightMeter = 0; superReady = false;
      for (let p of plants) {
        for (let i = 0; i < 28; i++) particles.push({
          x: p.x + (Math.random() - 0.5) * 80,
          y: p.y + (Math.random() - 0.5) * 40,
          vx: (Math.random() - 0.5) * 6, vy: -Math.random() * 6,
          life: 800
        });
      }
      playSplash(0.44, 380, 0.6);
      score += 24;
    } else {
      // normal throw — more powerful
      player.dir = 'front';
      setTimeout(() => player.dir = 'back', 220);
      const powerBoost = 1.6; // increase this for more throw speed
      drops.push({
        x: player.x,
        y: player.y,
        vx: (dx / 18) * powerBoost,
        vy: (dy / 36) * powerBoost,
        life: 4500
      });
    }
  }
}

// --- Collisions
function dropHitsPlant(d, p) {
  const px = p.x - p.w / 2, py = p.y - p.h / 2;
  return d.x > px && d.x < px + p.w && d.y > py && d.y < py + p.h;
}

// --- Spawn orb (one at a time)
function spawnOrb() {
  if (orb) return;
  const margin = 80;
  const ox = margin + Math.random() * (canvas.width - margin * 2);
  orb = { x: ox, y: -12, r: 14, vy: 2.6 };
  lastOrbTime = performance.now();
  try { audioOrbSpawn.play(); } catch (e) {}
}

// --- Reset round
function resetRound() {
  timeLeft = 60;
  score = 0;
  sunlightMeter = 0;
  superReady = false;
  drops.length = 0;
  particles.length = 0;
  orb = null;
  spawnPlants();
  player.x = canvas.width / 2;
  player.targetX = player.x;
  running = true;
  lastTS = 0;
  rafId = requestAnimationFrame(loop);
}

// --- Particle & physics update
function updateParticles(dt) {
  for (let i = particles.length - 1; i >= 0; i--) {
    const p = particles[i];
    p.x += p.vx; p.y += p.vy; p.vy += 0.12; p.life -= dt;
    if (p.life <= 0) particles.splice(i, 1);
  }
}

// --- Main loop
function loop(ts) {
  if (!lastTS) lastTS = ts;
  const dt = ts - lastTS;
  lastTS = ts;

  if (running) {
    // player easing movement
    player.x += (player.targetX - player.x) * player.ease;

    // update drops
    for (let i = drops.length - 1; i >= 0; i--) {
      const d = drops[i];
      d.x += d.vx; d.y += d.vy; d.vy += 0.28; d.life -= dt;
      // check hit
      let hit = false;
      for (let p of plants) {
        if (p.alive && dropHitsPlant(d, p)) {
          p.thirst = 100; p.grow = 1; score += 6;
          for (let k = 0; k < 10; k++) particles.push({
            x: d.x + (Math.random() - 0.5) * 18,
            y: d.y + (Math.random() - 0.5) * 8,
            vx: (Math.random() - 0.5) * 3, vy: -Math.random() * 3,
            life: 380
          });
          playSplash(0.16, 700 - Math.random() * 200, 0.26);
          hit = true;
          break;
        }
      }
      if (hit || d.y > canvas.height + 80 || d.life <= 0 || d.x < -120 || d.x > canvas.width + 120) drops.splice(i, 1);
    }

    // orb update
if (orb) {
  orb.y += orb.vy;
  // catch
  if (orb.y > canvas.height - 220 && Math.abs(orb.x - player.x) < 60) { // reduced from 90 to 60 for smaller catch radius
    sunlightMeter = clamp(sunlightMeter + 28, 0, 100);
    if (sunlightMeter >= 100) { sunlightMeter = 100; superReady = true; }
    for (let i = 0; i < 12; i++) particles.push({
      x: orb.x + (Math.random() - 0.5) * 16, // smaller particle spread
      y: orb.y + (Math.random() - 0.5) * 12,
      vx: (Math.random() - 0.5) * 2, vy: -Math.random() * 2, life: 320
    });
    try { audioOrbCollect.play(); } catch (e) {}
    orb = null;
  } else if (orb.y > canvas.height - 60) {
    // missed: penalty
    for (let p of plants) if (p.alive) p.thirst = Math.max(0, p.thirst - 10);
    orb = null;
  }
} else {
  // spawn new orb every ~5s
  if (!lastOrbTime || (performance.now() - lastOrbTime) > 5000) spawnOrb();
}

    // update particles
    updateParticles(dt);

    // plants thirst decay
    for (let p of plants) {
      if (!p.alive) continue;
      // tuned drain
      p.thirst = Math.max(0, p.thirst - (3.2 * dt / 1000));
      if (p.thirst <= 0) { p.alive = false; p.thirst = 0; }
      if (p.grow > 0) p.grow = Math.max(0, p.grow - (dt / 600));
    }

    // time & end condition
    timeLeft -= dt / 1000;
    if (timeLeft <= 0) {
      running = false;
      // show end message
      endScreen.style.display = 'block';
      setTimeout(() => { /* keep message visible */ }, 500);
    }
  }

  // draw
  drawScene();

  rafId = requestAnimationFrame(loop);
}

// --- Drawing
function drawScene() {
  // background
  if (imgs.Bg) {
    const img = imgs.Bg;
    const ar = img.width / img.height;
    const car = canvas.width / canvas.height;
    let dw, dh, dx, dy;
    if (ar > car) { dh = canvas.height; dw = dh * ar; dx = -(dw - canvas.width) / 2; dy = 0; }
    else { dw = canvas.width; dh = dw / ar; dx = 0; dy = -(dh - canvas.height) / 2; }
    ctx.drawImage(img, dx, dy, dw, dh);
  } else {
    ctx.fillStyle = '#cfeffd'; ctx.fillRect(0, 0, canvas.width, canvas.height);
  }

  // day->night t
  const t = clamp(1 - (timeLeft / 60), 0, 1);
  const sunX = canvas.width - 110 - t * (canvas.width - 220);
  const sunY = 92;

  // draw sun
  if (imgs.Sun) ctx.drawImage(imgs.Sun, sunX - 56, sunY - 56, 112, 112);
  else {
    const g = ctx.createRadialGradient(sunX, sunY, 10, sunX, sunY, 86);
    g.addColorStop(0, 'rgba(255,240,160,0.95)'); g.addColorStop(1, 'rgba(255,200,60,0.06)');
    ctx.fillStyle = g; ctx.beginPath(); ctx.arc(sunX, sunY, 86, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = 'rgba(255,210,70,1)'; ctx.beginPath(); ctx.arc(sunX, sunY, 36, 0, Math.PI * 2); ctx.fill();
  }

  // clouds (decor)
  drawCloud(canvas.width * 0.18, 130, 0.9);
  drawCloud(canvas.width * 0.52, 115, 1.0);

  // plants
  for (const p of plants) {
    const px = p.x, py = p.y;
    const bw = 84, bh = 10;
    const bx = px - bw / 2, by = py - p.h / 2 - 26;
    // bar bg
    ctx.fillStyle = 'rgba(0,0,0,0.12)'; roundRect(ctx, bx - 2, by - 2, bw + 4, bh + 4, 8); ctx.fill();
    // fill
    ctx.fillStyle = p.alive ? '#6fb6ff' : '#7a7a7a'; roundRect(ctx, bx, by, Math.max(2, (p.thirst / 100) * bw), bh, 6); ctx.fill();
    ctx.strokeStyle = 'rgba(0,0,0,0.08)'; ctx.strokeRect(bx, by, bw, bh);

    // plant image: Health.PNG when alive (>25), Dead.PNG when thirst <= 25 (user requested)
    if (!p.alive || p.thirst <= 25) {
      if (imgs.Dead) ctx.drawImage(imgs.Dead, px - p.w / 2, py - p.h / 2, p.w, p.h);
      else { ctx.fillStyle = '#7b4b2f'; ctx.fillRect(px - p.w / 2, py - p.h / 2, p.w, p.h); }
    } else {
      if (imgs.Health) {
        const sc = 1 + p.grow * 0.25;
        ctx.save();
        ctx.translate(px, py);
        ctx.drawImage(imgs.Health, -p.w / 2 * sc, -p.h / 2 * sc, p.w * sc, p.h * sc);
        ctx.restore();
      } else {
        ctx.fillStyle = '#2e9b2e'; ctx.beginPath();
        ctx.ellipse(px, py, p.w / 2, p.h / 2, 0, 0, Math.PI * 2); ctx.fill();
      }
    }
  }

  // orb beam & orb
  if (orb) {
    const bx = orb.x, by = orb.y, br = orb.r;
    const beamH = Math.max(0, by + 6);
    const grad = ctx.createLinearGradient(bx, 0, bx, beamH);
    grad.addColorStop(0, 'rgba(255,240,160,0.0)'); grad.addColorStop(0.6, 'rgba(255,220,80,0.18)'); grad.addColorStop(1, 'rgba(255,200,50,0.30)');
    ctx.fillStyle = grad; ctx.fillRect(bx - 18, 0, 36, beamH);
    const g2 = ctx.createRadialGradient(bx, by, 0, bx, by, br * 3);
    g2.addColorStop(0, 'rgba(255,238,120,0.95)'); g2.addColorStop(1, 'rgba(255,200,40,0.05)');
    ctx.fillStyle = g2; ctx.beginPath(); ctx.arc(bx, by, br * 2.6, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = 'rgba(255,210,60,1)'; ctx.beginPath(); ctx.arc(bx, by, br, 0, Math.PI * 2); ctx.fill();
  }

  // drops
  for (const d of drops) {
    ctx.fillStyle = 'rgba(57,149,255,0.95)'; ctx.beginPath(); ctx.ellipse(d.x, d.y, 6, 8, 0, 0, Math.PI * 2); ctx.fill();
  }

  // player
  const px = player.x - player.w / 2, py = player.y;
  if (player.dir === 'front' && imgs.Front) ctx.drawImage(imgs.Front, px, py, player.w, player.h);
  else if (imgs.Back) ctx.drawImage(imgs.Back, px, py, player.w, player.h);
  else { ctx.fillStyle = '#5b3a2e'; ctx.fillRect(px, py, player.w, player.h); }

  // particles
  for (const p of particles) {
    const alpha = clamp(p.life / 600, 0, 1);
    ctx.fillStyle = `rgba(200,230,255,${alpha})`; ctx.beginPath(); ctx.arc(p.x, p.y, 3, 0, Math.PI * 2); ctx.fill();
  }

  // UI sunlight meter (top-left)
  const ux = 16, uy = 16, uw = 220, uh = 22;
  roundRect(ctx, ux, uy, uw, uh, 12); ctx.fillStyle = 'rgba(0,0,0,0.12)'; ctx.fill();
  ctx.fillStyle = '#ffb65e'; roundRect(ctx, ux + 2, uy + 2, Math.max(6, (sunlightMeter / 100) * (uw - 4)), uh - 4, 10); ctx.fill();
  ctx.fillStyle = 'rgba(0,0,0,0.85)'; ctx.font = '12px system-ui, Arial'; ctx.textAlign = 'left'; ctx.fillText('Sunlight', ux + 6, uy + 15);

  // super ready indicator
  if (superReady) {
    roundRect(ctx, canvas.width - 124, 14, 108, 28, 14); ctx.fillStyle = 'rgba(30,170,140,0.95)'; ctx.fill();
    ctx.fillStyle = 'white'; ctx.font = '12px system-ui, Arial'; ctx.textAlign = 'center'; ctx.fillText('SUPER READY', canvas.width - 124 + 54, 32);
  }

  // score bottom-left
  ctx.fillStyle = 'rgba(0,0,0,0.85)'; ctx.font = '14px system-ui, Arial'; ctx.textAlign = 'left';
  ctx.fillText(`Score: ${score}`, 16, canvas.height - 18);

  // small arc near sun for time-left indicator
  ctx.strokeStyle = 'rgba(255,255,255,0.18)'; ctx.lineWidth = 4;
  ctx.beginPath(); ctx.arc(sunX, sunY + 94, 18, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * clamp(timeLeft / 60, 0, 1)); ctx.stroke();

  // if game finished, overlay Good night (endScreen element shown separately)
  if (!running) {
    ctx.fillStyle = 'rgba(0,0,0,0.36)'; ctx.fillRect(0, 0, canvas.width, canvas.height);
  }
}

// helper roundRect
function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

// small cloud draw
function drawCloud(cx, cy, s = 1) {
  ctx.fillStyle = 'rgba(255,255,255,0.95)';
  ctx.beginPath();
  ctx.ellipse(cx - 32 * s, cy, 30 * s, 20 * s, 0, 0, Math.PI * 2);
  ctx.ellipse(cx, cy - 6 * s, 40 * s, 26 * s, 0, 0, Math.PI * 2);
  ctx.ellipse(cx + 32 * s, cy, 28 * s, 18 * s, 0, 0, Math.PI * 2);
  ctx.fill();
}

// clamp util
function clamp(v, a = 0, b = 1) { return Math.max(a, Math.min(b, v)); }

// --- Start button wiring & boot
preloadAssets().then(() => {
  loaderText.textContent = 'Assets ready';
  startBtn.disabled = false;
  startBtn.textContent = 'Start Game';
  // ensure audio allowed on mobile after user interaction
  startBtn.addEventListener('click', () => { try { audioOrbSpawn.play(); audioOrbCollect.play(); } catch (e) {} if (audioCtx && audioCtx.state === 'suspended') audioCtx.resume(); });
});

// Start when user clicks
startBtn.addEventListener('click', () => {
  startDialog.style.display = 'none';
  endScreen.style.display = 'none';
  // initialize
  spawnPlants();
  timeLeft = 60;
  score = 0;
  sunlightMeter = 0; superReady = false;
  running = true;
  lastTS = 0;
  lastOrbTime = performance.now() - 3000;
  rafId = requestAnimationFrame(loop);
});

// allow restart by clicking end screen
endScreen.addEventListener('click', () => {
  endScreen.style.display = 'none';
  spawnPlants();
  timeLeft = 60;
  score = 0;
  sunlightMeter = 0; superReady = false;
  running = true; lastTS = 0; rafId = requestAnimationFrame(loop);
});
// --- your existing game.js code ends here ---


// Prevent touch scrolling when swiping on the canvas
document.body.addEventListener("touchstart", function(e) {
    if (e.target.tagName.toLowerCase() === 'canvas') {
        e.preventDefault();
    }
}, { passive: false });

document.body.addEventListener("touchmove", function(e) {
    if (e.target.tagName.toLowerCase() === 'canvas') {
        e.preventDefault();
    }
}, { passive: false });
