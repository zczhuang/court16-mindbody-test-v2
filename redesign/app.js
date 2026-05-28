/* Court 16 Redesign — interactivity + shared chrome (nav, footer) */

const LOCATIONS = [
  { id: 'brooklyn', name: 'Downtown Brooklyn', short: 'Brooklyn', city: 'NY', addr: '445 Albee Square W' },
  { id: 'lic',      name: 'Long Island City',  short: 'LIC',      city: 'NY', addr: '13-06 Queens Plaza S' },
  { id: 'fidi',     name: 'FiDi, Manhattan',   short: 'FiDi',     city: 'NY', addr: '28 Liberty Street' },
  { id: 'ridgehill',name: 'Ridge Hill',        short: 'Yonkers',  city: 'NY', addr: '32 Market Street' },
  { id: 'fishtown', name: 'Fishtown',          short: 'Philly',   city: 'PA', addr: '1400 N Howard St' },
  { id: 'newton',   name: 'Newton',            short: 'Newton',   city: 'MA', addr: '300 Needham Street' },
];

const STORE_KEY = 'c16_location';

function getLocation() {
  return localStorage.getItem(STORE_KEY) || 'brooklyn';
}

function setLocation(id) {
  localStorage.setItem(STORE_KEY, id);
  applyLocation();
  // When the user changes location from the redesign pill while on the
  // /trial booking route, push the new id into the URL so the React
  // calendar refetches with the right club. Hard reload (rather than
  // history.replaceState) so /trial's useSearchParams + useEffect
  // properly rebuild from scratch — softer routing wasn't picking it up.
  if (/^\/trial(\/|$|\?)/.test(window.location.pathname + window.location.search)) {
    const params = new URLSearchParams(window.location.search);
    params.set('location', id);
    window.location.assign('/trial?' + params.toString());
  }
}

function applyLocation() {
  const id = getLocation();
  const loc = LOCATIONS.find(l => l.id === id) || LOCATIONS[0];
  document.querySelectorAll('[data-loc-name]').forEach(el => el.textContent = loc.short);
  document.querySelectorAll('[data-loc-full]').forEach(el => el.textContent = loc.name + ', ' + loc.city);
  const priceMod = { brooklyn: 1.0, lic: 1.0, fidi: 1.08, ridgehill: 0.92, fishtown: 0.88, newton: 0.95 }[id] || 1.0;

  // Rewrite all trial CTAs to deep-link into the real /trial flow with location pre-filled
  document.querySelectorAll('[data-trial-cta]').forEach(a => {
    a.setAttribute('href', `/trial?location=${id}`);
  });
  document.querySelectorAll('[data-base-price]').forEach(el => {
    const base = parseFloat(el.dataset.basePrice);
    el.textContent = Math.round(base * priceMod);
  });
}

/* ---------- Mega-menu nav (injected, single source of truth) ---------- */

const NAV_HTML = `
<header class="site-header">
  <div class="wrap nav">
    <a href="/redesign/index.html" class="brand" aria-label="Court 16 — Tennis Remixed">
      <img src="/redesign/assets/court16-logo.png" alt="Court 16 — Tennis Remixed" class="brand-logo">
    </a>
    <nav class="nav-links" aria-label="Primary">
      <div class="nav-item has-mega" data-nav="clubs">
        <button class="nav-trigger">Clubs <span class="caret">▾</span></button>
        <div class="mega mega-clubs">
          <div class="mega-inner">
            <div class="mega-col">
              <span class="eyebrow">By region</span>
              <ul class="mega-list">
                <li><a href="/redesign/locations.html"><strong>New York City</strong><span>Brooklyn · LIC · FiDi · Yonkers</span></a></li>
                <li><a href="/redesign/locations.html"><strong>Philadelphia</strong><span>Fishtown</span></a></li>
                <li><a href="/redesign/locations.html"><strong>Boston</strong><span>Newton</span></a></li>
              </ul>
            </div>
            <div class="mega-col mega-col-wide">
              <span class="eyebrow">All six clubs</span>
              <div class="mega-clubs-grid">
                ${LOCATIONS.map(l => `
                  <a href="/redesign/locations.html#${l.id}" class="mega-club">
                    <span class="city-tag">${l.city}</span>
                    <strong>${l.name}</strong>
                    <span class="addr">${l.addr}</span>
                  </a>
                `).join('')}
              </div>
            </div>
          </div>
        </div>
      </div>

      <div class="nav-item has-mega" data-nav="adults">
        <button class="nav-trigger">Adults <span class="caret">▾</span></button>
        <div class="mega mega-narrow">
          <ul class="mega-list">
            <li><a href="/redesign/adult-classes.html"><strong>Adult Classes</strong><span>Group classes by USTA skill level</span></a></li>
            <li><a href="/redesign/adult-classes.html#private"><strong>Private &amp; Semi-Private</strong><span>1-on-1 or pairs with a pro</span></a></li>
            <li><a href="/redesign/adult-classes.html#ball-machine"><strong>Ball Machine Training</strong><span>Solo reps, member rates</span></a></li>
            <li><a href="/redesign/memberships.html#adult"><strong>Adult Membership</strong><span>Unlimited group classes</span></a></li>
          </ul>
        </div>
      </div>

      <div class="nav-item has-mega" data-nav="kids">
        <button class="nav-trigger">Kids <span class="caret">▾</span></button>
        <div class="mega mega-narrow">
          <ul class="mega-list">
            <li><a href="/redesign/kids-trial.html"><strong>Free Trial Class</strong><span>Complimentary first lesson</span></a></li>
            <li><a href="/redesign/kids-trial.html#academy"><strong>Kids Tennis Academy</strong><span>Red → Orange → Green → Yellow</span></a></li>
            <li><a href="/redesign/summer-camp.html"><strong>Summer Camp</strong><span>NY · PA · 10 themed weeks</span></a></li>
            <li><a href="/redesign/summer-camp.html#holiday"><strong>Holiday Camps</strong><span>School-break programs</span></a></li>
            <li><a href="/redesign/memberships.html#kids"><strong>Kids Membership</strong><span>Sibling discounts</span></a></li>
          </ul>
        </div>
      </div>

      <div class="nav-item has-mega" data-nav="pickleball">
        <button class="nav-trigger">Pickleball <span class="caret">▾</span></button>
        <div class="mega mega-narrow">
          <ul class="mega-list">
            <li><a href="/redesign/pickleball.html"><strong>Clinics &amp; Rentals</strong><span>Beginner to open play</span></a></li>
            <li><a href="/redesign/pickleball.html#league"><strong>League Play</strong><span>Seasonal competitive league</span></a></li>
            <li><a href="/redesign/pickleball.html#open"><strong>Open Play</strong><span>Drop-in rotation games</span></a></li>
            <li><a href="/redesign/memberships.html#pickleball"><strong>Pickleball Membership</strong><span>Court priority + clinics</span></a></li>
          </ul>
        </div>
      </div>

      <div class="nav-item has-mega" data-nav="events">
        <button class="nav-trigger">Events <span class="caret">▾</span></button>
        <div class="mega mega-narrow">
          <ul class="mega-list">
            <li><a href="https://www.court16.com/private-corporate-events" target="_blank" rel="noopener"><strong>Corporate Events</strong><span>Team builders &amp; offsites</span></a></li>
            <li><a href="https://www.court16.com/birthday-parties" target="_blank" rel="noopener"><strong>Birthday Parties</strong><span>Kids &amp; teens</span></a></li>
            <li><a href="https://www.court16.com/private-corporate-events" target="_blank" rel="noopener"><strong>Private Court Rental</strong><span>Hourly bookings</span></a></li>
          </ul>
        </div>
      </div>

      <div class="nav-item">
        <a href="/redesign/about.html" class="nav-trigger nav-trigger-link">About</a>
      </div>
    </nav>

    <div class="nav-spacer"></div>

    <button class="location-pill" data-loc-picker aria-label="Change location">
      <span class="dot"></span>
      <span><span data-loc-name>Brooklyn</span></span>
      <span class="caret">▾</span>
    </button>

    <div class="nav-cta">
      <a href="https://shop.court16.com" target="_blank" rel="noopener" class="btn btn-ghost">Pro Shop</a>
      <a href="https://www.court16.com/login" target="_blank" rel="noopener" class="btn btn-ghost">Log in</a>
      <a href="/trial" data-trial-cta class="btn btn-ball">Book free trial</a>
    </div>

    <button class="hamburger" data-mobile-toggle aria-label="Menu"><span></span></button>
  </div>
</header>

<div class="mobile-drawer">
  <button class="close" data-mobile-toggle aria-label="Close">✕</button>
  <div class="mobile-nav-inner">
    <details open><summary>Clubs</summary>
      <a href="/redesign/locations.html">All locations</a>
      ${LOCATIONS.map(l => `<a href="/redesign/locations.html#${l.id}">${l.name} · ${l.city}</a>`).join('')}
    </details>
    <details><summary>Adults</summary>
      <a href="/redesign/adult-classes.html">Adult Classes</a>
      <a href="/redesign/adult-classes.html#private">Private &amp; Semi-Private</a>
      <a href="/redesign/memberships.html#adult">Adult Membership</a>
    </details>
    <details><summary>Kids</summary>
      <a href="/redesign/kids-trial.html">Free Trial</a>
      <a href="/redesign/kids-trial.html#academy">Kids Academy</a>
      <a href="/redesign/summer-camp.html">Summer Camp</a>
      <a href="/redesign/memberships.html#kids">Kids Membership</a>
    </details>
    <details><summary>Pickleball</summary>
      <a href="/redesign/pickleball.html">Clinics &amp; Rentals</a>
      <a href="/redesign/pickleball.html#league">League</a>
      <a href="/redesign/memberships.html#pickleball">Pickleball Membership</a>
    </details>
    <details><summary>Events</summary>
      <a href="https://www.court16.com/private-corporate-events" target="_blank" rel="noopener">Corporate</a>
      <a href="https://www.court16.com/birthday-parties" target="_blank" rel="noopener">Birthday Parties</a>
    </details>
    <a href="/redesign/about.html" class="mobile-direct">About</a>
    <a href="/redesign/faq.html" class="mobile-direct">FAQ</a>
    <a href="/redesign/contact.html" class="mobile-direct">Contact</a>
    <div class="mobile-cta-row">
      <a href="/trial" data-trial-cta class="btn btn-ball" style="flex:1">Book free trial</a>
    </div>
  </div>
</div>
`;

const FOOTER_HTML = `
<footer class="site-footer">
  <div class="wrap">
    <div class="footer-grid">
      <div>
        <div class="brand brand-footer">
          <img src="/redesign/assets/court16-logo.png" alt="Court 16 — Tennis Remixed" class="brand-logo brand-logo-light">
        </div>
        <p style="margin-top:16px;max-width:30ch">Tennis Remixed. Six clubs across NYC, Philly &amp; Boston.</p>
        <div style="display:flex;gap:12px;margin-top:24px">
          <a href="https://www.instagram.com/court16tennis" target="_blank" rel="noopener" aria-label="Court 16 on Instagram" style="width:36px;height:36px;border-radius:50%;background:rgba(255,255,255,0.08);display:grid;place-items:center;transition:background .15s" onmouseover="this.style.background='rgba(255,224,51,0.2)'" onmouseout="this.style.background='rgba(255,255,255,0.08)'">IG</a>
          <a href="https://www.facebook.com/Court16tennis/" target="_blank" rel="noopener" aria-label="Court 16 on Facebook" style="width:36px;height:36px;border-radius:50%;background:rgba(255,255,255,0.08);display:grid;place-items:center;transition:background .15s" onmouseover="this.style.background='rgba(255,224,51,0.2)'" onmouseout="this.style.background='rgba(255,255,255,0.08)'">FB</a>
          <a href="https://www.linkedin.com/company/court16" target="_blank" rel="noopener" aria-label="Court 16 on LinkedIn" style="width:36px;height:36px;border-radius:50%;background:rgba(255,255,255,0.08);display:grid;place-items:center;transition:background .15s" onmouseover="this.style.background='rgba(255,224,51,0.2)'" onmouseout="this.style.background='rgba(255,255,255,0.08)'">in</a>
        </div>
      </div>
      <div>
        <h5>Play</h5>
        <ul>
          <li><a href="/redesign/adult-classes.html">Adult Classes</a></li>
          <li><a href="/redesign/kids-trial.html">Kids Academy</a></li>
          <li><a href="/redesign/summer-camp.html">Summer Camp</a></li>
          <li><a href="/redesign/pickleball.html">Pickleball</a></li>
          <li><a href="/redesign/memberships.html">Memberships</a></li>
        </ul>
      </div>
      <div>
        <h5>Clubs</h5>
        <ul>
          ${LOCATIONS.map(l => `<li><a href="/redesign/locations.html#${l.id}">${l.short} · ${l.city}</a></li>`).join('')}
          <li><a href="/redesign/locations.html">All locations</a></li>
        </ul>
      </div>
      <div>
        <h5>Company</h5>
        <ul>
          <li><a href="/redesign/about.html">About &amp; Mission</a></li>
          <li><a href="https://www.court16.com/careers" target="_blank" rel="noopener">Careers</a></li>
          <li><a href="https://www.court16.com/press" target="_blank" rel="noopener">Press</a></li>
          <li><a href="https://www.court16.com/blog" target="_blank" rel="noopener">Court 16 Gazette</a></li>
          <li><a href="/redesign/faq.html">FAQ</a></li>
          <li><a href="/redesign/contact.html">Contact</a></li>
        </ul>
      </div>
    </div>
    <div class="footer-bottom">
      <span>© 2026 Court 16 · <a href="tel:+17188755550">718-875-5550</a> · <a href="mailto:hello@court16.com">hello@court16.com</a></span>
      <span><a href="https://www.court16.com/terms" target="_blank" rel="noopener">Terms</a> · <a href="https://www.court16.com/privacy" target="_blank" rel="noopener">Privacy</a> · <a href="https://www.court16.com/mailing-list" target="_blank" rel="noopener">Mailing List</a></span>
    </div>
  </div>
</footer>
`;

const CHATBOT_HTML = `
<button class="c16-bot-launcher" id="c16-bot-launcher" aria-label="Open class finder">
  <span class="ball">16</span>
  <span>Find my class</span>
  <span class="dot" aria-hidden="true"></span>
</button>
<div class="c16-bot-overlay" id="c16-bot-overlay" aria-hidden="true"></div>
<aside class="c16-bot-panel" id="c16-bot-panel" role="dialog" aria-label="Court 16 class concierge" aria-hidden="true">
  <button class="close-x" id="c16-bot-close" aria-label="Close">✕</button>
</aside>
`;

function injectChatbot() {
  const wrap = document.createElement('div');
  wrap.innerHTML = CHATBOT_HTML;
  while (wrap.firstChild) document.body.appendChild(wrap.firstChild);

  const launcher = document.getElementById('c16-bot-launcher');
  const panel = document.getElementById('c16-bot-panel');
  const overlay = document.getElementById('c16-bot-overlay');
  const closeBtn = document.getElementById('c16-bot-close');
  let iframeLoaded = false;

  function open() {
    if (!iframeLoaded) {
      const iframe = document.createElement('iframe');
      iframe.src = '/chatbot.html?embed=1';
      iframe.setAttribute('title', 'Court 16 Class Concierge');
      panel.appendChild(iframe);
      iframeLoaded = true;
    }
    panel.classList.add('open');
    overlay.classList.add('open');
    panel.setAttribute('aria-hidden', 'false');
  }
  function close() {
    panel.classList.remove('open');
    overlay.classList.remove('open');
    panel.setAttribute('aria-hidden', 'true');
  }
  launcher.addEventListener('click', open);
  closeBtn.addEventListener('click', close);
  overlay.addEventListener('click', close);
  window.addEventListener('message', e => {
    if (e.data && e.data.type === 'c16-chatbot-close') close();
  });
}

function injectChrome() {
  const navMount = document.getElementById('site-nav');
  if (navMount) navMount.innerHTML = NAV_HTML;
  const footMount = document.getElementById('site-footer');
  if (footMount) footMount.innerHTML = FOOTER_HTML;
  injectChatbot();

  // Highlight active nav item
  const page = (location.pathname.split('/').pop() || 'index.html').replace('.html', '');
  const map = {
    'index': null,
    'adult-classes': 'adults',
    'kids-trial': 'kids',
    'summer-camp': 'kids',
    'locations': 'clubs',
    'memberships': 'memberships',
    'pickleball': 'pickleball',
    'about': 'about',
    'faq': null, 'contact': null,
  };
  const activeKey = map[page];
  if (activeKey) {
    const el = document.querySelector(`[data-nav="${activeKey}"]`);
    if (el) el.classList.add('active');
  }
}

/* ---------- Location picker modal ---------- */
function openLocationPicker() {
  const existing = document.getElementById('loc-modal');
  if (existing) { existing.remove(); return; }
  const modal = document.createElement('div');
  modal.id = 'loc-modal';
  modal.innerHTML = `
    <div class="loc-modal-back"></div>
    <div class="loc-modal-card">
      <div class="loc-modal-head">
        <div>
          <div class="eyebrow">Your Club</div>
          <h3 style="margin-top:6px">Choose your home court</h3>
        </div>
        <button class="loc-modal-close" aria-label="Close">✕</button>
      </div>
      <p class="muted" style="margin:8px 0 24px;font-size:14px">Pricing and schedules vary by location. We'll remember your pick.</p>
      <div class="loc-modal-grid">
        ${LOCATIONS.map(l => `
          <button class="loc-option ${l.id === getLocation() ? 'selected' : ''}" data-id="${l.id}">
            <span class="loc-option-city">${l.city}</span>
            <span class="loc-option-name">${l.name}</span>
          </button>
        `).join('')}
      </div>
    </div>
  `;
  document.body.appendChild(modal);
  modal.querySelector('.loc-modal-back').onclick = () => modal.remove();
  modal.querySelector('.loc-modal-close').onclick = () => modal.remove();
  modal.querySelectorAll('.loc-option').forEach(btn => {
    btn.onclick = () => { setLocation(btn.dataset.id); modal.remove(); };
  });
}

function toggleMobileMenu() {
  document.querySelector('.mobile-drawer')?.classList.toggle('open');
}

function bindChoices() {
  document.querySelectorAll('.choice-grid').forEach(group => {
    group.addEventListener('click', e => {
      const c = e.target.closest('.choice');
      if (!c) return;
      group.querySelectorAll('.choice').forEach(x => x.classList.remove('selected'));
      c.classList.add('selected');
    });
  });
}

function bindTrialForm() {
  const form = document.getElementById('trial-form');
  if (!form) return;
  const steps = form.querySelectorAll('.trial-form-step');
  const dots = form.querySelectorAll('.step-dot');
  let current = 0;
  function show(i) {
    steps.forEach((s, idx) => s.style.display = idx === i ? 'block' : 'none');
    dots.forEach((d, idx) => d.classList.toggle('active', idx <= i));
    current = i;
  }
  show(0);
  form.addEventListener('click', e => {
    if (e.target.matches('[data-next]')) { e.preventDefault(); if (current < steps.length - 1) show(current + 1); }
    if (e.target.matches('[data-back]')) { e.preventDefault(); if (current > 0) show(current - 1); }
  });
  form.addEventListener('submit', e => { e.preventDefault(); show(steps.length - 1); });
}

function bindTabs() {
  document.querySelectorAll('.tab-bar').forEach(bar => {
    bar.addEventListener('click', e => {
      const b = e.target.closest('[data-tab]');
      if (!b) return;
      const target = b.dataset.tab;
      bar.querySelectorAll('[data-tab]').forEach(x => x.classList.toggle('active', x === b));
      const panels = bar.parentElement.querySelectorAll('[data-panel]');
      panels.forEach(p => p.style.display = p.dataset.panel === target ? '' : 'none');
    });
    // initialize first tab
    const first = bar.querySelector('[data-tab]');
    if (first) first.click();
    // honor hash
    const hash = location.hash.replace('#', '');
    if (hash) {
      const match = bar.querySelector(`[data-tab="${hash}"]`);
      if (match) match.click();
    }
  });
}

// Expose for late-loading consumers (e.g. Next.js <RedesignChrome /> on /trial)
window.injectChrome = injectChrome;
window.applyLocation = applyLocation;

document.addEventListener('DOMContentLoaded', () => {
  injectChrome();
  applyLocation();
  bindChoices();
  bindTrialForm();
  bindTabs();

  document.querySelectorAll('.filter-bar').forEach(bar => {
    bar.addEventListener('click', e => {
      const b = e.target.closest('button');
      if (!b) return;
      bar.querySelectorAll('button').forEach(x => x.classList.remove('active'));
      b.classList.add('active');
    });
  });

  // Delegated click handlers for injected chrome
  document.body.addEventListener('click', e => {
    if (e.target.closest('[data-loc-picker]')) openLocationPicker();
    if (e.target.closest('[data-mobile-toggle]')) toggleMobileMenu();
  });

  // FAQ accordion
  document.querySelectorAll('.faq-item').forEach(item => {
    item.querySelector('.faq-q').addEventListener('click', () => {
      item.classList.toggle('open');
    });
  });
});

/* Runtime CSS for injected modal */
const css = document.createElement('style');
css.textContent = `
#loc-modal { position: fixed; inset: 0; z-index: 200; display: grid; place-items: center; padding: 20px; }
.loc-modal-back { position: absolute; inset: 0; background: rgba(13,20,16,0.6); backdrop-filter: blur(8px); }
.loc-modal-card { position: relative; background: var(--paper); border-radius: var(--r-lg); padding: 32px; max-width: 560px; width: 100%; box-shadow: var(--shadow-lg); max-height: 90vh; overflow-y: auto; }
.loc-modal-head { display: flex; justify-content: space-between; align-items: flex-start; }
.loc-modal-close { width: 36px; height: 36px; border-radius: 50%; background: var(--cream); display: grid; place-items: center; font-size: 14px; }
.loc-modal-grid { display: grid; grid-template-columns: repeat(2,1fr); gap: 10px; }
.loc-option { text-align: left; padding: 16px; border: 1.5px solid var(--line); border-radius: var(--r-md); background: var(--paper); transition: all .15s; }
.loc-option:hover { border-color: var(--ink); }
.loc-option.selected { border-color: var(--ink); background: var(--court-soft); }
.loc-option-city { display: block; font-size: 11px; letter-spacing: 0.15em; text-transform: uppercase; color: var(--accent-green); font-weight: 700; }
.loc-option-name { display: block; font-family: var(--font-display); font-size: 18px; font-weight: 700; margin-top: 4px; letter-spacing: -0.02em; }
.step-dot { width: 32px; height: 4px; border-radius: 2px; background: var(--line); transition: background .2s; }
.step-dot.active { background: var(--ink); }
`;
document.head.appendChild(css);
