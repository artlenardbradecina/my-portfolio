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
  return { init, redraw: frame };
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
[Particles, Sound, Modal, UI, Filter, Terminal].forEach(m => m.init());
