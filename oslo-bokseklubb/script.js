/* Oslo Bokseklubb – interaksjoner, ingen avhengigheter */
(function () {
    'use strict';

    var reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

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
        nav.querySelectorAll('a').forEach(function (l) { l.addEventListener('click', closeNav); });
        document.addEventListener('keydown', function (e) { if (e.key === 'Escape') closeNav(); });
    }

    /* ---- Scroll-progressbar ---- */
    var bar = document.getElementById('scroll-progress');
    if (bar) {
        var onScroll = function () {
            var h = document.documentElement;
            var max = h.scrollHeight - h.clientHeight;
            var p = max > 0 ? h.scrollTop / max : 0;
            bar.style.transform = 'scaleX(' + p + ')';
        };
        window.addEventListener('scroll', onScroll, { passive: true });
        onScroll();
    }

    /* ---- Sett kortfarge fra data-accent ---- */
    document.querySelectorAll('.card[data-accent]').forEach(function (card) {
        card.style.setProperty('--c', card.getAttribute('data-accent'));
    });

    /* ---- Subtil 3D-tilt på kort ---- */
    if (!reduce && window.matchMedia('(hover: hover)').matches) {
        document.querySelectorAll('.card.tilt').forEach(function (card) {
            card.addEventListener('mousemove', function (e) {
                var r = card.getBoundingClientRect();
                var x = (e.clientX - r.left) / r.width - 0.5;
                var y = (e.clientY - r.top) / r.height - 0.5;
                card.style.transform = 'perspective(700px) rotateX(' + (-y * 5).toFixed(2) + 'deg) rotateY(' + (x * 6).toFixed(2) + 'deg) translateY(-4px)';
            });
            card.addEventListener('mouseleave', function () { card.style.transform = ''; });
        });
    }

    /* ---- Reveal + tellere ---- */
    function animateCount(el) {
        var target = parseInt(el.getAttribute('data-count'), 10);
        if (isNaN(target) || reduce) { return; }
        var dur = 1100, start = null, from = 0;
        function step(ts) {
            if (!start) start = ts;
            var t = Math.min((ts - start) / dur, 1);
            var eased = 1 - Math.pow(1 - t, 3);
            el.textContent = Math.round(from + (target - from) * eased);
            if (t < 1) requestAnimationFrame(step);
            else el.textContent = target;
        }
        requestAnimationFrame(step);
    }

    var revealEls = document.querySelectorAll('.reveal');
    if ('IntersectionObserver' in window) {
        var io = new IntersectionObserver(function (entries) {
            entries.forEach(function (entry) {
                if (entry.isIntersecting) {
                    entry.target.classList.add('is-visible');
                    var c = entry.target.querySelector('strong[data-count]');
                    if (c) animateCount(c);
                    io.unobserve(entry.target);
                }
            });
        }, { threshold: 0.12, rootMargin: '0px 0px -40px 0px' });
        revealEls.forEach(function (el) { io.observe(el); });
    } else {
        revealEls.forEach(function (el) { el.classList.add('is-visible'); });
    }

    /* ---- Årstall ---- */
    var yearEl = document.getElementById('year');
    if (yearEl) yearEl.textContent = new Date().getFullYear();
})();
