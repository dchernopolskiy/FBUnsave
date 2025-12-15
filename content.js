(function() {
  'use strict';

  // Prevent multiple initializations
  if (window.__fbMarketplaceFilterLoaded) {
    console.log('FB Marketplace Filter: Already loaded, skipping...');
    return;
  }
  window.__fbMarketplaceFilterLoaded = true;

  let settings = {
    hideSold: true,
    hidePending: false,
  };

  let isInitialized = false;
  const allCards = new Set();
  const hiddenCards = new Map();

  // Search state
  let searchMatchIds = []; // Store item IDs instead of DOM elements
  let currentMatchIndex = -1;
  let isAutoScrolling = false;
  let currentSearchQuery = '';

  // Inject highlight styles into the page
  const highlightStyles = document.createElement('style');
  highlightStyles.id = 'fbmf-highlight-styles';
  highlightStyles.textContent = `
    .fbmf-search-match {
      position: relative !important;
      z-index: 1 !important;
    }
    .fbmf-search-match::before {
      content: '' !important;
      position: absolute !important;
      top: -4px !important;
      left: -4px !important;
      right: -4px !important;
      bottom: -4px !important;
      border: 3px solid #1877f2 !important;
      border-radius: 12px !important;
      pointer-events: none !important;
      z-index: 9999 !important;
    }
    .fbmf-current-match {
      position: relative !important;
      z-index: 2 !important;
    }
    .fbmf-current-match::before {
      content: '' !important;
      position: absolute !important;
      top: -6px !important;
      left: -6px !important;
      right: -6px !important;
      bottom: -6px !important;
      border: 4px solid #f7b928 !important;
      border-radius: 12px !important;
      box-shadow: 0 0 20px rgba(247, 185, 40, 0.6) !important;
      pointer-events: none !important;
      z-index: 9999 !important;
    }
  `;
  document.head.appendChild(highlightStyles);
  console.log('FBMF: Injected highlight styles, style element in head:', !!document.getElementById('fbmf-highlight-styles'));

  // Helper to get item ID from a card
  function getCardItemId(card) {
    const link = card.querySelector('a[href*="/marketplace/item/"]');
    if (link) {
      const match = link.href.match(/\/marketplace\/item\/(\d+)/);
      return match ? match[1] : null;
    }
    return null;
  }

  // Helper to find card element by item ID
  function findCardByItemId(itemId) {
    const links = document.querySelectorAll(`a[href*="/marketplace/item/${itemId}"]`);
    for (const link of links) {
      let parent = link;
      let attempts = 0;
      while (parent && attempts < 8) {
        const hasImage = parent.querySelector('img');
        const hasPrice = parent.textContent.match(/\$\d+/);
        if (hasImage && hasPrice) {
          const height = parent.offsetHeight;
          if (height > 50 && height < 800) {
            return parent;
          }
        }
        parent = parent.parentElement;
        attempts++;
      }
    }
    return null;
  }

  // Initialize settings and start filtering
  function initialize() {
    if (isInitialized) return;

    chrome.storage.sync.get(['hideSold', 'hidePending'], (result) => {
      settings.hideSold = result.hideSold !== false;
      settings.hidePending = result.hidePending === true;
      isInitialized = true;
      startFiltering();
    });
  }

  chrome.storage.onChanged.addListener((changes) => {
    if (changes.hideSold) settings.hideSold = changes.hideSold.newValue;
    if (changes.hidePending) settings.hidePending = changes.hidePending.newValue;
    filterListings();
  });

  function findListingCards() {
    const itemLinks = document.querySelectorAll('a[href*="/marketplace/item/"]');

    itemLinks.forEach(link => {
      let parent = link;
      let attempts = 0;
      
      while (parent && attempts < 8) {
        const hasImage = parent.querySelector('img');
        const hasPrice = parent.textContent.match(/\$\d+/);
        const hasLink = parent.querySelector('a[href*="/marketplace/item/"]');
                if (hasImage && hasPrice && hasLink) {
          const height = parent.offsetHeight;
          if (height > 50 && height < 800) {
            allCards.add(parent);
            break;
          }
        }
        
        parent = parent.parentElement;
        attempts++;
      }
    });
    return Array.from(allCards);
  }

  function isListingSoldOrPending(card) {
    const text = card.textContent.toLowerCase();
    const html = card.innerHTML.toLowerCase();
    const soldPatterns = [
      /\bsold\s*[·•]\s*\$/i,
      /\bsold\s*$/i,
      /^sold\b/i,
      /<[^>]*>\s*sold\s*</i
    ];
    
    const pendingPatterns = [
      /\bpending\s*[·•]\s*\$/i,
      /\bpending\s*$/i,
      /^pending\b/i,
      /<[^>]*>\s*pending\s*</i
    ];
    
    const isSold = soldPatterns.some(pattern => 
      pattern.test(text) || pattern.test(html)
    );
    
    const isPending = pendingPatterns.some(pattern => 
      pattern.test(text) || pattern.test(html)
    );
    
    return { isSold, isPending };
  }

  function hideCard(card, reason) {
    try {
      // Check if card is still in DOM
      if (!card || !card.parentNode) {
        return;
      }

      let gridItem = card;
      let parent = card.parentElement;

      while (parent) {
        const grandParent = parent.parentElement;

        if (grandParent) {
          const grandParentStyle = window.getComputedStyle(grandParent);
          if (grandParentStyle.display === 'grid' ||
              grandParentStyle.display === 'flex' ||
              grandParentStyle.display === 'inline-grid' ||
              grandParentStyle.display === 'inline-flex') {
            gridItem = parent;
            break;
          }
        }

        parent = parent.parentElement;
        if (parent && parent.tagName === 'BODY') break;
      }

      // Check if gridItem is still in DOM before manipulating
      if (!gridItem || !gridItem.parentNode) {
        return;
      }

      const placeholder = document.createComment(`filtered-${reason}`);
      gridItem.parentNode.insertBefore(placeholder, gridItem);

      hiddenCards.set(card, {
        reason: reason,
        placeholder: placeholder,
        gridItem: gridItem
      });

      gridItem.remove();
    } catch (e) {
      // DOM may have changed, ignore error
      console.log('hideCard error (DOM changed):', e.message);
    }
  }

  function showCard(card) {
    if (hiddenCards.has(card)) {
      const { placeholder, gridItem } = hiddenCards.get(card);
      if (placeholder && placeholder.parentNode) {
        placeholder.parentNode.insertBefore(gridItem, placeholder);
        placeholder.remove();
      }
      hiddenCards.delete(card);
    }
  }

  function restoreAllCards() {
    hiddenCards.forEach((data, card) => {
      if (data.placeholder && data.placeholder.parentNode) {
        data.placeholder.parentNode.insertBefore(data.gridItem, data.placeholder);
        data.placeholder.remove();
      }
    });
    hiddenCards.clear();
  }

  function filterListings() {
    const cards = findListingCards();
    let soldCount = 0;
    let pendingCount = 0;
    let visibleCount = 0;

    cards.forEach((card, index) => {
      const { isSold, isPending } = isListingSoldOrPending(card);
      
      let shouldHide = false;
      let reason = '';

      if (isSold && settings.hideSold) {
        shouldHide = true;
        reason = 'sold';
        soldCount++;
      } else if (isPending && settings.hidePending) {
        shouldHide = true;
        reason = 'pending';
        pendingCount++;
      }

      if (shouldHide) {
        // Only hide if not already hidden
        if (!hiddenCards.has(card)) {
          hideCard(card, reason);
        }
      } else {
        // Show if currently hidden
        if (hiddenCards.has(card)) {
          showCard(card);
        }
        visibleCount++;
      }
    });

    console.log(`FB Marketplace Filter: ${visibleCount} visible, ${soldCount} sold hidden, ${pendingCount} pending hidden (${cards.length} total)`);
  }

  // Search functionality
  function getCardTitle(card) {
    // Try to find the title text - usually in a span or the link text
    const link = card.querySelector('a[href*="/marketplace/item/"]');
    if (link) {
      // Get text content but exclude price
      const text = card.textContent;
      // Remove price patterns and clean up
      return text.replace(/\$[\d,]+(\.\d{2})?/g, '').replace(/\s+/g, ' ').trim();
    }
    return card.textContent;
  }

  function searchItems(query, savedIndex = -1) {
    if (!query || query.trim() === '') {
      clearSearchHighlights();
      searchMatchIds = [];
      currentMatchIndex = -1;
      currentSearchQuery = '';
      saveSearchState();
      return { matches: 0, total: allCards.size };
    }

    const searchTerm = query.toLowerCase().trim();
    currentSearchQuery = query;
    clearSearchHighlights();
    searchMatchIds = [];

    // Search through all cards (including hidden ones for counting)
    const allCardsArray = Array.from(allCards);

    allCardsArray.forEach((card) => {
      const title = getCardTitle(card).toLowerCase();
      if (title.includes(searchTerm)) {
        // Check if card is currently visible (not hidden by filters)
        if (!hiddenCards.has(card)) {
          const itemId = getCardItemId(card);
          if (itemId && !searchMatchIds.includes(itemId)) {
            searchMatchIds.push(itemId);
          }
        }
      }
    });

    // Highlight all matches that are currently in DOM
    highlightAllMatches();

    // Use saved index if provided and valid, otherwise start at 0
    if (savedIndex >= 0 && savedIndex < searchMatchIds.length) {
      currentMatchIndex = savedIndex;
    } else {
      currentMatchIndex = searchMatchIds.length > 0 ? 0 : -1;
    }

    if (currentMatchIndex >= 0) {
      highlightCurrentMatch();
    }

    saveSearchState();
    return { matches: searchMatchIds.length, total: allCards.size };
  }

  // Highlight all search matches that are currently visible in DOM
  function highlightAllMatches() {
    console.log('highlightAllMatches called, searchMatchIds:', searchMatchIds.length);
    searchMatchIds.forEach((itemId, index) => {
      const card = findCardByItemId(itemId);
      console.log(`  Match ${index}: itemId=${itemId}, card found=${!!card}`);
      if (card) {
        card.classList.remove('fbmf-current-match');
        card.classList.add('fbmf-search-match');
        console.log(`    Added fbmf-search-match class, classList now:`, card.classList.toString());
      }
    });
  }

  // Save search state to storage (use sync since session isn't available in content scripts)
  function saveSearchState() {
    try {
      chrome.storage.sync.set({
        _searchQuery: currentSearchQuery,
        _searchIndex: currentMatchIndex
      });
    } catch (e) {
      // Ignore storage errors
    }
  }

  function highlightCurrentMatch(shouldScroll = true) {
    console.log('highlightCurrentMatch called, currentMatchIndex:', currentMatchIndex);

    // First, re-apply highlights to all visible matches
    highlightAllMatches();

    // Then highlight the current match specially
    if (searchMatchIds[currentMatchIndex]) {
      const currentItemId = searchMatchIds[currentMatchIndex];
      const currentCard = findCardByItemId(currentItemId);
      console.log('Current match: itemId=', currentItemId, 'card found=', !!currentCard);
      if (currentCard) {
        currentCard.classList.remove('fbmf-search-match');
        currentCard.classList.add('fbmf-current-match');
        console.log('Added fbmf-current-match, classList:', currentCard.classList.toString());
        // Debug: check computed style
        const computed = window.getComputedStyle(currentCard);
        console.log('Computed outline:', computed.outline);
        console.log('Computed boxShadow:', computed.boxShadow);
      }
    }

    // Scroll to current match
    if (shouldScroll && searchMatchIds[currentMatchIndex]) {
      const targetItemId = searchMatchIds[currentMatchIndex];
      const card = findCardByItemId(targetItemId);

      console.log('Scrolling to match', currentMatchIndex, 'of', searchMatchIds.length, 'itemId:', targetItemId);
      console.log('Card in DOM:', !!card);

      if (!card) {
        // Card was virtualized away - scroll down to find it
        console.log('Card not in DOM (virtualized). Scrolling to find it...');

        const scrollToFind = async () => {
          // First scroll to top, then scroll down looking for the card
          window.scrollTo({ top: 0, behavior: 'auto' });
          await new Promise(r => setTimeout(r, 200));

          for (let i = 0; i < 20; i++) { // Max 20 attempts
            const foundCard = findCardByItemId(targetItemId);
            if (foundCard) {
              console.log('Found card after scrolling!');
              // Scroll to center it
              const cardRect = foundCard.getBoundingClientRect();
              const viewportCenter = window.innerHeight / 2;
              const scrollAmount = cardRect.top + cardRect.height / 2 - viewportCenter;
              window.scrollBy({ top: scrollAmount, behavior: 'smooth' });

              // Re-apply all highlights and highlight current
              setTimeout(() => {
                highlightAllMatches();
                foundCard.classList.remove('fbmf-search-match');
                foundCard.classList.add('fbmf-current-match');
              }, 100);
              return;
            }

            window.scrollBy({ top: window.innerHeight * 0.7, behavior: 'auto' });
            await new Promise(r => setTimeout(r, 250)); // Wait for FB to render
          }
          console.log('Could not find card after scrolling');
        };

        scrollToFind();
        return;
      }

      // Card is in DOM, scroll to it normally
      const cardRect = card.getBoundingClientRect();
      const viewportCenter = window.innerHeight / 2;
      const cardCenter = cardRect.top + cardRect.height / 2;
      const scrollAmount = cardCenter - viewportCenter;

      console.log('Need to scroll by:', scrollAmount);

      window.scrollBy({
        top: scrollAmount,
        behavior: 'smooth'
      });
    }
  }

  function nextMatch() {
    if (searchMatchIds.length === 0) return currentMatchIndex;
    currentMatchIndex = (currentMatchIndex + 1) % searchMatchIds.length;
    highlightCurrentMatch();
    saveSearchState();
    return currentMatchIndex;
  }

  function prevMatch() {
    if (searchMatchIds.length === 0) return currentMatchIndex;
    currentMatchIndex = (currentMatchIndex - 1 + searchMatchIds.length) % searchMatchIds.length;
    highlightCurrentMatch();
    saveSearchState();
    return currentMatchIndex;
  }

  function clearSearchHighlights() {
    // Clear highlights from all cards currently in DOM
    searchMatchIds.forEach((itemId) => {
      const card = findCardByItemId(itemId);
      if (card) {
        card.classList.remove('fbmf-search-match', 'fbmf-current-match');
      }
    });
    // Also clear any stray highlights
    document.querySelectorAll('.fbmf-search-match, .fbmf-current-match').forEach(el => {
      el.classList.remove('fbmf-search-match', 'fbmf-current-match');
    });
    searchMatchIds = [];
    currentMatchIndex = -1;
  }

  // Auto-scroll to load all items
  async function loadAllItems(progressCallback) {
    if (isAutoScrolling) {
      isAutoScrolling = false;
      return { stopped: true };
    }

    isAutoScrolling = true;
    let previousCount = 0;
    let sameCountIterations = 0;
    const maxSameCount = 5; // Stop after 5 iterations with no new items

    while (isAutoScrolling) {
      // Scroll to bottom
      window.scrollTo(0, document.body.scrollHeight);

      // Wait for content to load
      await new Promise(resolve => setTimeout(resolve, 1000));

      // Update cards
      findListingCards();
      const currentCount = allCards.size;

      if (progressCallback) {
        progressCallback(currentCount);
      }

      // Check if we're still finding new items
      if (currentCount === previousCount) {
        sameCountIterations++;
        if (sameCountIterations >= maxSameCount) {
          isAutoScrolling = false;
          break;
        }
      } else {
        sameCountIterations = 0;
      }

      previousCount = currentCount;
    }

    // Scroll back to top
    window.scrollTo({ top: 0, behavior: 'smooth' });

    return { total: allCards.size, stopped: !isAutoScrolling };
  }

  function stopAutoScroll() {
    isAutoScrolling = false;
  }

  // Listen for messages from popup
  chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === 'search') {
      const result = searchItems(request.query);
      sendResponse({
        matches: result.matches,
        total: result.total,
        currentIndex: currentMatchIndex
      });
    } else if (request.action === 'restoreSearch') {
      // Restore search from saved state
      const result = searchItems(request.query, request.savedIndex);
      sendResponse({
        matches: result.matches,
        total: result.total,
        currentIndex: currentMatchIndex
      });
    } else if (request.action === 'nextMatch') {
      const index = nextMatch();
      sendResponse({ currentIndex: index, total: searchMatchIds.length });
    } else if (request.action === 'prevMatch') {
      const index = prevMatch();
      sendResponse({ currentIndex: index, total: searchMatchIds.length });
    } else if (request.action === 'clearSearch') {
      clearSearchHighlights();
      currentSearchQuery = '';
      saveSearchState();
      sendResponse({ success: true });
    } else if (request.action === 'loadAll') {
      loadAllItems((count) => {
        // Send progress updates
        chrome.runtime.sendMessage({ action: 'loadProgress', count: count });
      }).then((result) => {
        sendResponse(result);
      });
      return true; // Keep channel open for async response
    } else if (request.action === 'stopLoadAll') {
      stopAutoScroll();
      sendResponse({ stopped: true });
    } else if (request.action === 'getStats') {
      sendResponse({
        totalLoaded: allCards.size,
        currentQuery: currentSearchQuery,
        currentIndex: currentMatchIndex,
        totalMatches: searchMatchIds.length
      });
    }
    return true;
  });

  // Smarter initialization that waits for content to appear
  function startFiltering() {
    // Filter immediately if content exists
    filterListings();

    // Set up MutationObserver for dynamic content
    const observer = new MutationObserver((mutations) => {
      clearTimeout(window.filterTimeout);
      window.filterTimeout = setTimeout(filterListings, 300);
    });

    observer.observe(document.body, {
      childList: true,
      subtree: true
    });

    // Also filter on scroll (FB loads more items on scroll)
    let scrollTimeout;
    window.addEventListener('scroll', () => {
      clearTimeout(scrollTimeout);
      scrollTimeout = setTimeout(filterListings, 500);
    }, { passive: true });

    console.log('FB Marketplace Saved Filter: Active and filtering');
  }

  // Wait for the page to be ready, then initialize
  function waitForContent() {
    // Check if marketplace items exist
    const hasItems = document.querySelector('a[href*="/marketplace/item/"]');

    if (hasItems) {
      initialize();
    } else {
      // Use MutationObserver to wait for content to appear
      const startupObserver = new MutationObserver((mutations, obs) => {
        const items = document.querySelector('a[href*="/marketplace/item/"]');
        if (items) {
          obs.disconnect();
          initialize();
        }
      });

      startupObserver.observe(document.body, {
        childList: true,
        subtree: true
      });

      // Fallback: initialize anyway after 5 seconds
      setTimeout(() => {
        startupObserver.disconnect();
        initialize();
      }, 5000);
    }
  }

  // Start the process
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', waitForContent);
  } else {
    waitForContent();
  }

  // Keyboard shortcuts: , for previous, . for next
  document.addEventListener('keydown', (e) => {
    // Don't trigger if user is typing in an input field
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.isContentEditable) {
      return;
    }

    // Only work if there's an active search
    if (searchMatchIds.length === 0) {
      return;
    }

    if (e.key === ',') {
      e.preventDefault();
      prevMatch();
    } else if (e.key === '.') {
      e.preventDefault();
      nextMatch();
    }
  });

  console.log('FB Marketplace Saved Filter loaded!');
})();
