'use strict';

/* ===== Helpers ===== */
const $  = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];

/* ===== Module 1: Audio FX (Web Audio API) =====
   The AudioContext is created lazily on first use, as browsers
   require a user gesture before audio can play. */
const Sound = (() => {
  let ctx;
  function beep(freq = 600, dur = 0.06) {
    try {
      ctx = ctx || new (window.AudioContext || window.webkitAudioContext)();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'square';
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0.03, ctx.currentTime);               // keep it quiet
      gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + dur);
      osc.connect(gain).connect(ctx.destination);
      osc.start();
      osc.stop(ctx.currentTime + dur);
    } catch (e) { /* audio unavailable: fail silently */ }
  }
  function init() {
    let last = null;
    // Hover beep (mouse only, once per element entry)
    document.addEventListener('pointerover', e => {
      if (e.pointerType !== 'mouse') return;
      const t = e.target.closest('a, button, .card');
      if (t && t !== last) beep(520, 0.04);
      last = t;
    });
    // Click beep
    document.addEventListener('click', e => {
      if (e.target.closest('a, button')) beep(880, 0.08);
    });
  }
  return { init, beep };
})();

/* ===== Module 2: Canvas particle network ===== */
const Particles = (() => {
  const canvas = $('#bg');
  const g = canvas.getContext('2d');
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const LINK = 120;                                  // max link distance in px
  const mouse = { x: -999, y: -999 };               // cursor position for interaction
  let w, h, dots = [];

  function resize() {
    w = canvas.width = innerWidth;
    h = canvas.height = innerHeight;
    const n = Math.min(90, Math.floor((w * h) / 16000));   // fewer dots on small screens
    dots = Array.from({ length: n }, () => ({
      x: Math.random() * w, y: Math.random() * h,
      vx: (Math.random() - 0.5) * 0.6, vy: (Math.random() - 0.5) * 0.6
    }));
  }

  function frame() {
    const color = getComputedStyle(document.documentElement).getPropertyValue('--accent').trim();
    g.clearRect(0, 0, w, h);
    g.fillStyle = g.strokeStyle = color;
    g.globalAlpha = 0.6;
    for (const p of dots) {
      const mx = p.x - mouse.x, my = p.y - mouse.y, md = Math.hypot(mx, my) || 1;
      if (md < 140) {                                // cursor repels nearby dots and links to them
        p.x += (mx / md) * 1.5; p.y += (my / md) * 1.5;
        g.globalAlpha = (1 - md / 140) * 0.5;
        g.beginPath(); g.moveTo(p.x, p.y); g.lineTo(mouse.x, mouse.y); g.stroke();
        g.globalAlpha = 0.6;
      }
      p.x += p.vx; p.y += p.vy;
      if (p.x < 0 || p.x > w) p.vx *= -1;            // bounce off edges
      if (p.y < 0 || p.y > h) p.vy *= -1;
      g.beginPath(); g.arc(p.x, p.y, 1.5, 0, Math.PI * 2); g.fill();
    }
    // Connect nearby particles; closer = brighter line
    for (let i = 0; i < dots.length; i++) {
      for (let j = i + 1; j < dots.length; j++) {
        const d = Math.hypot(dots[i].x - dots[j].x, dots[i].y - dots[j].y);
        if (d < LINK) {
          g.globalAlpha = (1 - d / LINK) * 0.35;
          g.beginPath(); g.moveTo(dots[i].x, dots[i].y); g.lineTo(dots[j].x, dots[j].y); g.stroke();
        }
      }
    }
    if (!reduce) requestAnimationFrame(frame);       // single static frame if reduced motion
  }

  function init() {
    resize(); frame();
    addEventListener('pointermove', e => { mouse.x = e.clientX; mouse.y = e.clientY; });
    addEventListener('resize', () => { resize(); if (reduce) frame(); });
  }
  return { init, redraw: () => { if (reduce) frame(); } };   // the running loop already picks up theme colors
})();

/* ===== Module 2b: PCB header canvas =====
   The static board (grid, traces, chips, silkscreen) is painted once into an offscreen
   layer. Each frame only blits that layer, then draws data pulses and cursor effects.
   The loop pauses when the hero is off screen, and stays still under reduced motion. */
const Pcb = (() => {
  const canvas = $('#headerCanvas'), hero = $('#home');
  const g = canvas.getContext('2d');
  const layer = document.createElement('canvas'), L = layer.getContext('2d');
  const reduce = matchMedia('(prefers-reduced-motion: reduce)');
  const mouse = { x: 0, y: 0, a: 0, on: false, t: 0 };
  const TAU = Math.PI * 2;
  let w = 0, h = 0, G = 24, dpr = 1, raf = 0, last = 0, col = {};
  let traces = [], chips = [], nodes = [], labels = [], pulses = [];

  // Seeded RNG: the board layout is identical on every resize
  const seeded = a => () => {
    a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const trail = (c, p) => { c.beginPath(); p.forEach(([x, y], i) => i ? c.lineTo(x, y) : c.moveTo(x, y)); };

  function readColors() {
    const s = getComputedStyle(document.documentElement);
    col = { acc: s.getPropertyValue('--accent').trim(), slate: s.getPropertyValue('--text').trim(), bg: s.getPropertyValue('--bg').trim() };
  }

  /* ---- Board layout (all coordinates snap to the G-pixel grid) ---- */
  const route = (x, y, side, dirY, s, d, e) => {          // straight, 45 degree jog, straight
    const p = [[x, y]];
    x += side * s * G; p.push([x, y]);
    x += side * d * G; y += dirY * d * G; p.push([x, y]);
    x += side * e * G; p.push([x, y]);
    return p;
  };
  const trace = (p, power = 0, faint = false) => {
    const cum = [0];
    for (let i = 1; i < p.length; i++) cum.push(cum[i - 1] + Math.hypot(p[i][0] - p[i - 1][0], p[i][1] - p[i - 1][1]));
    const t = { p, cum, total: cum[cum.length - 1], power, faint };
    traces.push(t); nodes.push(p[0], p[p.length - 1]);
    return t;
  };
  // One route copied per pin, so the traces run side by side like a real bus
  const bus = (c, side, dirY, s, d, ends) => {
    const out = [];
    for (let j = 1; j < c.rows; j++)
      out.push(trace(route(side < 0 ? c.x : c.x + c.w, c.y + j * G, side, dirY, s, d, ends[(j - 1) % ends.length])));
    return out;
  };

  function build() {
    const R = seeded(11), cols = Math.floor(w / G), rows = Math.floor(h / G);
    traces = []; chips = []; nodes = []; labels = []; pulses = [];
    const chip = (name, fx, fy, c, r) => {
      const x = Math.max(1, Math.min(Math.round(fx * cols - c / 2), cols - c - 1));
      const y = Math.max(3, Math.min(Math.round(fy * rows - r / 2), rows - r - 5));
      const o = { name, x: x * G, y: y * G, w: c * G, h: r * G, rows: r };
      chips.push(o); return o;
    };
    const s3 = chip('ESP32-S3', .62, .27, 8, 6), c6 = chip('ESP32-C6', .84, .68, 6, 5);

    // Faint background routes entering from the board edges
    for (let i = 0; i < 7; i++) {
      const side = i % 2 ? -1 : 1, row = 1 + Math.floor(R() * (rows - 2));
      trace(route(side > 0 ? 0 : cols * G, row * G, side, R() < .5 ? -1 : 1, 2 + Math.floor(R() * 6), 1 + Math.floor(R() * 3), 2 + Math.floor(R() * 7)), 0, true);
    }
    const spi = bus(s3, -1, 1, 1, 3, [4, 6, 5, 7, 5]);
    const uart = bus(s3, 1, -1, 1, 3, [3, 5, 4, 6, 4]);
    bus(c6, -1, -1, 1, 2, [3, 5, 4, 6]);
    bus(c6, 1, 1, 1, 2, [2, 3, 2, 4]);

    // Power pads under the C6: 3.3V (cyan) and GND (slate)
    const by = c6.y + c6.h;
    trace([[c6.x + 2 * G, by], [c6.x + 2 * G, by + 3 * G]], 1);
    trace([[c6.x + 4 * G, by], [c6.x + 4 * G, by + 3 * G]], 2);

    // Silkscreen text: [text, x, y, align]
    const se = spi[spi.length - 1].p[3], ue = uart[0].p[3];
    labels.push(['SPI_BUS', se[0], se[1] + G * 1.1, 'right'], ['UART_0', ue[0], ue[1] - G * .9, 'right'],
                ['3.3V', c6.x + 2 * G, by + 4 * G, 'center'], ['GND', c6.x + 4 * G, by + 4 * G, 'center']);

    for (const t of traces) pulses.push({ t, d: Math.random() * t.total, v: 70 + Math.random() * 90 });
  }

  function paintLayer() {
    L.setTransform(dpr, 0, 0, dpr, 0, 0);
    L.clearRect(0, 0, w, h);
    L.lineJoin = L.lineCap = 'round';
    L.fillStyle = col.slate; L.globalAlpha = .13;                       // board grid
    for (let x = G; x < w; x += G) for (let y = G; y < h; y += G) L.fillRect(x - .5, y - .5, 1, 1);
    for (const t of traces) {                                           // traces and end pads
      L.strokeStyle = t.power === 1 ? col.acc : col.slate;
      L.globalAlpha = t.power ? .8 : t.faint ? .2 : .42;
      L.lineWidth = t.power ? 3 : 1.5;
      trail(L, t.p); L.stroke();
      const [x, y] = t.p[t.p.length - 1];
      L.lineWidth = 1.5; L.beginPath(); L.arc(x, y, G * (t.power ? .3 : .17), 0, TAU); L.stroke();
    }
    for (const c of chips) {                                            // microchips
      L.globalAlpha = 1; L.fillStyle = col.bg; L.fillRect(c.x, c.y, c.w, c.h);
      L.shadowColor = col.acc; L.shadowBlur = 16;
      L.strokeStyle = col.acc; L.lineWidth = 1.5; L.strokeRect(c.x, c.y, c.w, c.h);
      L.shadowBlur = 0;
      L.globalAlpha = .35; L.strokeStyle = col.slate; L.strokeRect(c.x + G * .5, c.y + G * .5, c.w - G, c.h - G);
      L.globalAlpha = 1; L.fillStyle = col.slate;
      for (let j = 1; j < c.rows; j++) for (const px of [c.x, c.x + c.w]) L.fillRect(px - G * .13, c.y + j * G - G * .13, G * .26, G * .26);
      L.fillStyle = col.acc; L.beginPath(); L.arc(c.x + G * .85, c.y + G * .85, G * .1, 0, TAU); L.fill();
      L.font = `500 ${Math.max(9, Math.round(G * .55))}px "Fira Code", monospace`;
      L.textAlign = 'center'; L.textBaseline = 'middle';
      L.fillText(c.name, c.x + c.w / 2, c.y + c.h / 2);
    }
    L.font = `400 ${Math.max(9, Math.round(G * .42))}px "Fira Code", monospace`;
    L.fillStyle = col.slate; L.globalAlpha = .75; L.textBaseline = 'middle';
    for (const [text, x, y, align] of labels) { L.textAlign = align; L.fillText(text, x, y); }
  }

  /* ---- Per-frame drawing ---- */
  const pointAt = (t, d) => {
    let i = 1;
    while (i < t.cum.length - 1 && t.cum[i] < d) i++;
    const a = t.p[i - 1], b = t.p[i], k = (d - t.cum[i - 1]) / ((t.cum[i] - t.cum[i - 1]) || 1);
    return [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k];
  };
  function arc(x1, y1, x2, y2) {                                         // jagged voltage arc
    const dx = x2 - x1, dy = y2 - y1, len = Math.hypot(dx, dy) || 1;
    g.beginPath(); g.moveTo(x1, y1);
    for (let i = 1; i < 5; i++) {
      const j = (Math.random() - .5) * 12;
      g.lineTo(x1 + dx * i / 5 - dy / len * j, y1 + dy * i / 5 + dx / len * j);
    }
    g.lineTo(x2, y2); g.stroke();
  }
  function couple() {                                                    // cursor fires a pulse on the nearest trace
    let best = G * 6, hit = null;
    for (const t of traces) t.p.forEach((q, i) => {
      const d = Math.hypot(q[0] - mouse.x, q[1] - mouse.y);
      if (d < best) { best = d; hit = [t, i]; }
    });
    if (hit && pulses.filter(p => p.temp).length < 18) pulses.push({ t: hit[0], d: hit[0].cum[hit[1]], v: 260, temp: true });
  }

  function draw(dt) {
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, w, h);
    g.globalAlpha = 1; g.drawImage(layer, 0, 0, w, h);

    g.fillStyle = col.acc;                                               // data pulses: bright head, fading tail
    for (let i = pulses.length - 1; i >= 0; i--) {
      const p = pulses[i];
      p.d += p.v * dt;
      if (p.d > p.t.total) {
        if (p.temp) { pulses.splice(i, 1); continue; }
        p.d = -Math.random() * 240;                                      // pause, then fire again
      }
      if (p.d < 0) continue;
      for (let k = 0; k < 5; k++) {
        const d = p.d - k * G * .3;
        if (d < 0) break;
        const [x, y] = pointAt(p.t, d);
        g.globalAlpha = 1 - k / 5;
        g.beginPath(); g.arc(x, y, 2.6 - k * .35, 0, TAU); g.fill();
        if (!k) { g.globalAlpha = .2; g.beginPath(); g.arc(x, y, 8, 0, TAU); g.fill(); }
      }
    }

    mouse.a += ((mouse.on ? 1 : 0) - mouse.a) * Math.min(1, dt * 8);
    if (mouse.a > .02) {                                                 // cursor coupling
      const { x, y } = mouse, rad = G * 6;
      g.strokeStyle = col.acc; g.lineWidth = 2;
      for (const t of traces) {                                          // highlight nearby traces
        let m = rad;
        for (const q of t.p) m = Math.min(m, Math.hypot(q[0] - x, q[1] - y));
        if (m < rad) { g.globalAlpha = (1 - m / rad) * mouse.a; trail(g, t.p); g.stroke(); }
      }
      g.fillStyle = col.acc;
      for (const [r, a] of [[rad * .8, .04], [rad * .4, .06], [6, .6]]) { g.globalAlpha = a * mouse.a; g.beginPath(); g.arc(x, y, r, 0, TAU); g.fill(); }
      g.shadowColor = col.acc; g.shadowBlur = 10; g.lineWidth = 1.2;     // arcs to the three nearest pads
      nodes.map(n => [Math.hypot(n[0] - x, n[1] - y), n]).filter(a => a[0] < rad).sort((a, b) => a[0] - b[0]).slice(0, 3)
        .forEach(([d, n]) => { g.globalAlpha = (1 - d / rad) * mouse.a; arc(x, y, n[0], n[1]); });
      g.shadowBlur = 0;
    }
    g.globalAlpha = 1;
  }

  function loop(t) {
    const dt = Math.min(.05, (t - last) / 1000 || 0);
    last = t; draw(dt);
    raf = requestAnimationFrame(loop);
  }
  const start = () => { if (!raf && !reduce.matches) { last = performance.now(); raf = requestAnimationFrame(loop); } };
  const stop = () => { cancelAnimationFrame(raf); raf = 0; };

  function repaint() {
    if (!w) return;
    readColors(); paintLayer();
    if (reduce.matches) draw(0);                                         // one still frame
  }
  function resize() {
    const r = canvas.getBoundingClientRect();
    w = Math.round(r.width); h = Math.round(r.height);
    if (!w || !h) return;
    dpr = Math.min(devicePixelRatio || 1, 2);
    canvas.width = layer.width = Math.round(w * dpr);
    canvas.height = layer.height = Math.round(h * dpr);
    G = Math.max(14, Math.min(24, Math.round(w / 52)));
    build(); repaint();
  }

  function init() {
    new ResizeObserver(resize).observe(canvas);
    new MutationObserver(repaint).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    new IntersectionObserver(([e]) => e.isIntersecting ? start() : stop()).observe(hero);
    hero.addEventListener('pointermove', e => {
      if (reduce.matches) return;
      const r = canvas.getBoundingClientRect();
      mouse.x = e.clientX - r.left; mouse.y = e.clientY - r.top; mouse.on = true;
      if (e.timeStamp - mouse.t > 90) { mouse.t = e.timeStamp; couple(); }
    });
    hero.addEventListener('pointerleave', () => { mouse.on = false; });
    reduce.addEventListener('change', () => { stop(); repaint(); start(); });
    if (document.fonts) document.fonts.ready.then(repaint);              // redraw once Fira Code has loaded
  }
  return { init };
})();

/* ===== Module 3: Modals (CLI and Resume) ===== */
const Modal = (() => {
  function open(id) {
    $('#' + id).classList.add('open');
    if (id === 'cli') $('#termIn').focus();
  }
  function close(id) { $('#' + id).classList.remove('open'); }
  function init() {
    $('#cliBtn').onclick = () => open('cli');
    $('#cvBtn').onclick = () => open('cvModal');
    $('#printBtn').onclick = () => window.print();
    $$('[data-close]').forEach(b => b.onclick = () => close(b.dataset.close));
    $$('.modal').forEach(m => m.addEventListener('click', e => { if (e.target === m) close(m.id); }));
    addEventListener('keydown', e => { if (e.key === 'Escape') $$('.modal.open').forEach(m => close(m.id)); });
  }
  return { init, open, close };
})();

/* ===== Module 4: Navbar, mobile menu and theme ===== */
const UI = (() => {
  function init() {
    const menu = $('#menu'), burger = $('#burger');
    burger.onclick = () => burger.setAttribute('aria-expanded', menu.classList.toggle('open'));
    $$('#menu a').forEach(a => a.onclick = () => {
      menu.classList.remove('open'); burger.setAttribute('aria-expanded', 'false');
    });

    // Theme: restore saved choice (storage may be blocked, so guard it)
    const root = document.documentElement;
    try { root.dataset.theme = localStorage.getItem('theme') || 'dark'; } catch (e) {}
    $('#themeBtn').onclick = () => {
      root.dataset.theme = root.dataset.theme === 'dark' ? 'light' : 'dark';
      try { localStorage.setItem('theme', root.dataset.theme); } catch (e) {}
      Particles.redraw();
    };
  }
  return { init };
})();

/* ===== Module 5: Project filter (data-cat attributes, no reload) ===== */
const Filter = (() => {
  function init() {
    const buttons = $$('[data-filter]');
    buttons.forEach(btn => btn.addEventListener('click', () => {
      buttons.forEach(b => b.classList.toggle('active', b === btn));
      $$('.card').forEach(card => {
        const show = btn.dataset.filter === 'all' || card.dataset.cat === btn.dataset.filter;
        card.classList.toggle('hide', !show);
      });
    }));
  }
  return { init };
})();

/* ===== Module 6: Terminal CLI =====
   Output is built from the page's own DOM, so content stays in sync. */
const Terminal = (() => {
  const out = $('#termOut'), input = $('#termIn');
  const history = []; let hIdx = 0;

  const print = (text, cls = '') => {
    const p = document.createElement('p');
    p.className = cls; p.textContent = text;
    out.append(p); out.scrollTop = out.scrollHeight;
  };

  const commands = {
    help:     () => 'Commands: help, about, skills, projects, contact, clear, exit',
    about:    () => $('#about .lead').textContent,
    skills:   () => $$('.skill-card').map(c =>
                `${$('h3', c).textContent}: ${$$('.tag', c).map(t => t.textContent).join(', ')}`).join('\n'),
    projects: () => $$('.card h3').map((h, i) => `${i + 1}. ${h.textContent}`).join('\n'),
    contact:  () => $$('.socials a').map(a => `${a.textContent}: ${a.getAttribute('href').replace('mailto:', '')}`).join('\n'),
    clear:    () => { out.innerHTML = ''; return ''; },
    exit:     () => { Modal.close('cli'); return ''; }
  };

  function run(raw) {
    const cmd = raw.trim().toLowerCase();
    if (!cmd) return;
    history.push(cmd); hIdx = history.length;
    if (cmd !== 'clear') print('$ ' + cmd, 'cmd');
    const result = commands[cmd]
      ? commands[cmd]()
      : `Unknown command: "${cmd}". Type "help" to list commands.`;
    if (result) print(result);
  }

  function init() {
    print('Portfolio terminal. Type "help" to list commands.');
    input.addEventListener('keydown', e => {
      if (e.key === 'Enter') { run(input.value); input.value = ''; }
      if (e.key === 'ArrowUp' && hIdx > 0) input.value = history[--hIdx];                 // history back
      if (e.key === 'ArrowDown') input.value = history[++hIdx] || (hIdx = history.length, '');
    });
  }
  return { init };
})();

/* ===== Boot ===== */
[Particles, Pcb, Sound, Modal, UI, Filter, Terminal].forEach(m => m.init());
