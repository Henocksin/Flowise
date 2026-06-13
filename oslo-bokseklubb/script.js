/* Oslo Bokseklubb – små interaksjoner, ingen avhengigheter */
(function () {
    'use strict';

    /* ---- Mobil-meny ---- */
    var toggle = document.getElementById('nav-toggle');
    var nav = document.getElementById('main-nav');

    function closeNav() {
        nav.classList.remove('open');
        toggle.setAttribute('aria-expanded', 'false');
        toggle.setAttribute('aria-label', 'Åpne meny');
    }

    if (toggle && nav) {
        toggle.addEventListener('click', function () {
            var open = nav.classList.toggle('open');
            toggle.setAttribute('aria-expanded', String(open));
            toggle.setAttribute('aria-label', open ? 'Lukk meny' : 'Åpne meny');
        });
        // Lukk når man klikker en lenke
        nav.querySelectorAll('a').forEach(function (link) {
            link.addEventListener('click', closeNav);
        });
        // Lukk ved Escape
        document.addEventListener('keydown', function (e) {
            if (e.key === 'Escape') closeNav();
        });
    }

    /* ---- Scroll-reveal ---- */
    var revealEls = document.querySelectorAll('.reveal');
    if ('IntersectionObserver' in window && revealEls.length) {
        var io = new IntersectionObserver(function (entries) {
            entries.forEach(function (entry) {
                if (entry.isIntersecting) {
                    entry.target.classList.add('is-visible');
                    io.unobserve(entry.target);
                }
            });
        }, { threshold: 0.12, rootMargin: '0px 0px -40px 0px' });
        revealEls.forEach(function (el) { io.observe(el); });
    } else {
        revealEls.forEach(function (el) { el.classList.add('is-visible'); });
    }

    /* ---- Årstall i footer ---- */
    var yearEl = document.getElementById('year');
    if (yearEl) yearEl.textContent = new Date().getFullYear();
})();
