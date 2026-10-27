(function () {
  'use strict';

  // ----- Menu móvel -----
  var toggle = document.querySelector('.nav-toggle');
  var menu = document.getElementById('menu');
  if (toggle && menu) {
    toggle.addEventListener('click', function () {
      var open = menu.classList.toggle('is-open');
      toggle.setAttribute('aria-expanded', String(open));
    });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && menu.classList.contains('is-open')) {
        menu.classList.remove('is-open');
        toggle.setAttribute('aria-expanded', 'false');
        toggle.focus();
      }
    });
  }

  // ----- Google Analytics 4 (só com ID configurado e consentimento) -----
  var gaId = (window.FORT && window.FORT.gaId) || '';
  var KEY = 'fort_consent';
  var loaded = false;

  function getConsent() {
    try { return localStorage.getItem(KEY); } catch (e) { return null; }
  }
  function setConsent(v) {
    try { localStorage.setItem(KEY, v); } catch (e) { /* sem armazenamento */ }
  }

  function track(name, params) {
    if (loaded && typeof window.gtag === 'function') window.gtag('event', name, params || {});
  }

  function loadGA() {
    if (loaded || !gaId) return;
    loaded = true;
    window.dataLayer = window.dataLayer || [];
    window.gtag = function () { window.dataLayer.push(arguments); };
    window.gtag('js', new Date());
    window.gtag('config', gaId);
    var s = document.createElement('script');
    s.async = true;
    s.src = 'https://www.googletagmanager.com/gtag/js?id=' + encodeURIComponent(gaId);
    document.head.appendChild(s);
    var vehicle = document.body.getAttribute('data-view-vehicle');
    if (vehicle) track('view_vehicle', { vehicle_name: vehicle });
  }

  if (gaId) {
    var banner = document.getElementById('consent');
    var stored = getConsent();
    if (stored === 'granted') {
      loadGA();
    } else if (!stored && banner) {
      banner.hidden = false;
      banner.addEventListener('click', function (e) {
        var btn = e.target.closest('[data-consent]');
        if (!btn) return;
        var value = btn.getAttribute('data-consent');
        setConsent(value);
        banner.hidden = true;
        if (value === 'granted') loadGA();
      });
    }
  }

  // ----- Eventos de clique no WhatsApp -----
  document.addEventListener('click', function (e) {
    var a = e.target.closest('a[data-wa]');
    if (!a) return;
    track('whatsapp_click', {
      location: a.getAttribute('data-wa'),
      vehicle_name: a.getAttribute('data-vehicle') || undefined
    });
  });
})();
