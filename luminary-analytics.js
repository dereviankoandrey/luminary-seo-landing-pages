/**
 * Luminary Analytics — Lightweight, zero-dependency tracking system
 * 
 * Tracks: page views, tool interactions (button clicks, form submissions),
 * scroll depth, time on page. All data stored in localStorage with a
 * central dashboard at /analytics.html for review.
 * 
 * No external API calls, no cookies, no third-party dependencies.
 */

(function() {
  'use strict';

  // ─── Configuration ────────────────────────────────────────────────
  const VERSION = '1.0.0';
  const STORAGE_KEY = 'luminary_analytics_v2';
  const SESSION_KEY = 'luminary_session_id';
  const VISIT_KEY = 'luminary_visit_start';
  
  // ─── Session Management ──────────────────────────────────────────
  function getSessionId() {
    let sid = sessionStorage.getItem(SESSION_KEY);
    if (!sid) {
      sid = 'sess_' + Date.now().toString(36) + '_' + Math.random().toString(36).substr(2, 9);
      sessionStorage.setItem(SESSION_KEY, sid);
    }
    return sid;
  }

  function getVisitStart() {
    let start = localStorage.getItem(VISIT_KEY);
    if (!start) {
      start = Date.now().toString();
      localStorage.setItem(VISIT_KEY, start);
    }
    return parseInt(start, 10);
  }

  // ─── Data Store (localStorage) ──────────────────────────────────
  function loadData() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return { events: [], meta: { initialized: Date.now(), version: VERSION }, pages: {}, interactions: {} };
      const data = JSON.parse(raw);
      // Ensure structure
      if (!data.events) data.events = [];
      if (!data.meta) data.meta = { initialized: Date.now(), version: VERSION };
      if (!data.pages) data.pages = {};
      if (!data.interactions) data.interactions = {};
      return data;
    } catch (e) {
      console.warn('[Luminary Analytics] Failed to load data:', e);
      return { events: [], meta: { initialized: Date.now(), version: VERSION }, pages: {}, interactions: {} };
    }
  }

  function saveData(data) {
    try {
      // Cap at 50MB to prevent localStorage issues
      const serialized = JSON.stringify(data);
      if (serialized.length > 48 * 1024 * 1024) {
        // Prune oldest events if over limit
        data.events = data.events.slice(-5000);
      }
      localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
    } catch (e) {
      console.warn('[Luminary Analytics] Failed to save data:', e);
    }
  }

  // ─── Event Types ────────────────────────────────────────────────
  const EVENTS = {
    PAGE_VIEW: 'page_view',
    BUTTON_CLICK: 'button_click',
    FORM_SUBMIT: 'form_submit',
    SCROLL_DEPTH_25: 'scroll_25',
    SCROLL_DEPTH_50: 'scroll_50',
    SCROLL_DEPTH_75: 'scroll_75',
    SCROLL_DEPTH_100: 'scroll_100',
    TIME_ON_PAGE_MIN1: 'time_on_page_1m',
    TIME_ON_PAGE_MIN5: 'time_on_page_5m',
    TIME_ON_PAGE_MIN15: 'time_on_page_15m',
    TOOLS_USED: 'tools_used',
    EXIT_CLICK: 'exit_click' // Links that leave the page (CTAs, external links)
  };

  // ─── Core Tracking Functions ──────────────────────────────────────
  
  function trackEvent(type, details = {}) {
    const data = loadData();
    
    const event = {
      id: 'evt_' + Date.now().toString(36) + '_' + Math.random().toString(36).substr(2, 5),
      type: type,
      timestamp: Date.now(),
      sessionId: getSessionId(),
      page: window.location.pathname || '/',
      url: window.location.href || '',
      referrer: document.referrer || '(direct)',
      userAgent: navigator.userAgent.substring(0, 200), // Truncate to save space
      ...details
    };

    data.events.push(event);

    // Update page stats
    const pageKey = event.page;
    if (!data.pages[pageKey]) {
      data.pages[pageKey] = { views: 0, uniqueVisitors: new Set(), lastViewed: null };
    }
    data.pages[pageKey].views++;
    data.pages[pageKey].lastViewed = event.timestamp;

    // Track unique visitors per page (by session)
    if (!data.pages[pageKey]._sessions) {
      data.pages[pageKey]._sessions = new Set();
    }
    data.pages[pageKey]._sessions.add(event.sessionId);

    saveData(data);

    console.log(`[Luminary Analytics] ${type}: ${event.page}`, details);
  }

  // ─── Auto-Trackers ──────────────────────────────────────────────

  // Page view tracking
  function trackPageView() {
    trackEvent(EVENTS.PAGE_VIEW, {
      pageTitle: document.title || '',
      pagePath: window.location.pathname || '/',
      isDashboard: window.location.pathname.includes('/analytics'),
      language: navigator.language || 'en'
    });

    // Track time on page events
    setTimeout(() => trackEvent(EVENTS.TIME_ON_PAGE_MIN1), 60000);
    setTimeout(() => trackEvent(EVENTS.TIME_ON_PAGE_MIN5), 300000);
    setTimeout(() => trackEvent(EVENTS.TIME_ON_PAGE_MIN15), 900000);
  }

  // Scroll depth tracking
  function setupScrollTracking() {
    let tracked = new Set();
    
    function checkScrollDepth() {
      const scrollTop = window.pageYOffset || document.documentElement.scrollTop;
      const docHeight = document.documentElement.scrollHeight - document.documentElement.clientHeight;
      
      if (docHeight <= 0) return; // Single page, no scroll
      
      const depthPercent = Math.round((scrollTop / docHeight) * 100);
      
      [25, 50, 75, 100].forEach(threshold => {
        if (depthPercent >= threshold && !tracked.has(threshold)) {
          tracked.add(threshold);
          trackEvent(`scroll_${threshold}`);
        }
      });
    }

    // Check on scroll and load
    window.addEventListener('scroll', checkScrollDepth, { passive: true });
    
    // Also check after a delay for dynamically loaded content
    setTimeout(checkScrollDepth, 2000);
    setTimeout(checkScrollDepth, 5000);
  }

  // Click tracking (buttons, CTAs, form submissions)
  function setupClickTracking() {
    document.addEventListener('click', function(e) {
      const target = e.target.closest('button, a, input[type="submit"], [data-track]');
      if (!target) return;

      let eventType = EVENTS.BUTTON_CLICK;
      
      // Form submission detection
      if (e.submitter && e.submitter.form) {
        eventType = EVENTS.FORM_SUBMIT;
        trackEvent(eventType, {
          formAction: e.submitter.form.action || '(unknown)',
          formMethod: e.submitter.form.method || 'GET',
          buttonText: e.submitter.textContent?.trim() || ''
        });
        return;
      }

      // Exit click detection (links leaving the domain)
      if (target.tagName === 'A') {
        const href = target.getAttribute('href');
        if (href && !href.startsWith('#') && !window.location.hostname.includes(new URL(href).hostname)) {
          eventType = EVENTS.EXIT_CLICK;
        }
      }

      trackEvent(eventType, {
        element: target.tagName.toLowerCase(),
        text: target.textContent?.trim().substring(0, 100) || '',
        classes: (target.className || '').toString().substring(0, 200),
        href: target.getAttribute('href') || ''
      });
    }, true); // Use capture phase to catch all clicks

    // Also track form submissions via submit event
    document.addEventListener('submit', function(e) {
      const form = e.target;
      if (!form) return;
      
      trackEvent(EVENTS.FORM_SUBMIT, {
        formAction: form.action || '(unknown)',
        formId: form.id || '',
        className: (form.className || '').toString().substring(0, 100),
        inputCount: form.elements.length
      });
    }, true);
  }

  // Tool usage tracking (for interactive tools)
  function setupToolTracking() {
    // Track common tool interaction patterns
    const toolSelectors = [
      '[data-tool]',           // Explicitly marked tools
      '.calculate',             // Calculator buttons
      '.submit-analysis',       // Analysis submission
      '.generate-report',       // Report generation
      '.run-underwriting',      // Underwriting engine
      '.score-deal',            // Deal scoring
    ];

    toolSelectors.forEach(selector => {
      document.querySelectorAll(selector).forEach(el => {
        el.addEventListener('click', function() {
          trackEvent(EVENTS.TOOLS_USED, {
            selector: selector,
            elementText: this.textContent?.trim().substring(0, 100) || '',
            toolName: this.getAttribute('data-tool') || 'unknown'
          });
        });
      });
    });
  }

  // ─── Dashboard Data Export ──────────────────────────────────────
  
  function getDashboardData() {
    const data = loadData();
    
    // Calculate summary statistics
    const totalEvents = data.events.length;
    const uniqueSessions = new Set(data.events.map(e => e.sessionId)).size;
    const totalPages = Object.keys(data.pages).length;
    
    // Events by type
    const eventsByType = {};
    data.events.forEach(event => {
      if (!eventsByType[event.type]) {
        eventsByType[event.type] = 0;
      }
      eventsByType[event.type]++;
    });

    // Page views (top pages)
    const pageViews = Object.entries(data.pages)
      .map(([path, stats]) => ({
        path: path,
        views: stats.views,
        uniqueVisitors: stats._sessions?.size || 0,
        lastViewed: new Date(stats.lastViewed).toLocaleString()
      }))
      .sort((a, b) => b.views - a.views)
      .slice(0, 20);

    // Recent events (last 50)
    const recentEvents = data.events.slice(-50).reverse();

    // Time distribution (events by hour of day)
    const timeDistribution = {};
    for (let i = 0; i < 24; i++) {
      timeDistribution[i] = 0;
    }
    data.events.forEach(event => {
      const hour = new Date(event.timestamp).getHours();
      if (timeDistribution[hour] !== undefined) {
        timeDistribution[hour]++;
      }
    });

    // Referrer breakdown
    const referrers = {};
    data.events.forEach(event => {
      const ref = event.referrer || '(direct)';
      if (!referrers[ref]) referrers[ref] = 0;
      referrers[ref]++;
    });

    return {
      meta: data.meta,
      summary: {
        totalEvents,
        uniqueSessions,
        totalPages,
        eventsByType,
        firstEvent: data.events.length > 0 ? new Date(data.events[0].timestamp).toLocaleString() : 'N/A',
        lastEvent: data.events.length > 0 ? new Date(data.events[data.events.length - 1].timestamp).toLocaleString() : 'N/A'
      },
      pages: pageViews,
      recentEvents: recentEvents.map(e => ({
        type: e.type,
        timestamp: new Date(e.timestamp).toLocaleString(),
        page: e.page,
        text: e.text || '',
        sessionId: e.sessionId.substring(0, 12) + '...'
      })),
      timeDistribution: timeDistribution,
      referrers: Object.entries(referrers)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 15),
      rawData: data // For export
    };
  }

  // ─── Public API ──────────────────────────────────────────────
  
  window.luminaryAnalytics = {
    
    // Initialize all tracking
    init: function() {
      trackPageView();
      setupScrollTracking();
      setupClickTracking();
      setupToolTracking();
      
      console.log('[Luminary Analytics] Initialized v' + VERSION);
    },

    // Manual event tracking
    track: function(type, details = {}) {
      trackEvent(type, details);
    },

    // Get dashboard data (for the analytics page)
    getData: getDashboardData,

    // Export all data as JSON
    exportData: function() {
      const data = loadData();
      return JSON.stringify(data, null, 2);
    },

    // Clear all tracking data
    clearData: function() {
      localStorage.removeItem(STORAGE_KEY);
      console.log('[Luminary Analytics] Data cleared');
    },

    // Get current session ID
    getSessionId: getSessionId,

    // Version info
    version: VERSION
  };

  // Auto-initialize if not on dashboard page
  if (!window.location.pathname.includes('/analytics')) {
    window.luminaryAnalytics.init();
  } else {
    // Dashboard page - make data available but don't track the dashboard itself
    console.log('[Luminary Analytics] Dashboard mode active');
  }

})();
