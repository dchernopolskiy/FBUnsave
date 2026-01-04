(function() {
  'use strict';

  // Prevent multiple initializations
  if (window.__messengerMarketplaceSearchLoaded) {
    console.log('Messenger Marketplace Search: Already loaded, skipping...');
    return;
  }
  window.__messengerMarketplaceSearchLoaded = true;

  // State
  let allConversations = new Map(); // Map<threadId, conversationData>
  let searchMatchIds = [];
  let currentMatchIndex = -1;
  let isAutoScrolling = false;
  let currentSearchQuery = '';

  // Inject highlight styles
  const highlightStyles = document.createElement('style');
  highlightStyles.id = 'mms-highlight-styles';
  highlightStyles.textContent = `
    .mms-search-match {
      position: relative !important;
      background-color: rgba(24, 119, 242, 0.1) !important;
    }
    .mms-search-match::before {
      content: '' !important;
      position: absolute !important;
      top: 0 !important;
      left: 0 !important;
      right: 0 !important;
      bottom: 0 !important;
      border-left: 4px solid #1877f2 !important;
      pointer-events: none !important;
      z-index: 9999 !important;
    }
    .mms-current-match {
      position: relative !important;
      background-color: rgba(247, 185, 40, 0.15) !important;
    }
    .mms-current-match::before {
      content: '' !important;
      position: absolute !important;
      top: 0 !important;
      left: 0 !important;
      right: 0 !important;
      bottom: 0 !important;
      border-left: 5px solid #f7b928 !important;
      box-shadow: inset 0 0 20px rgba(247, 185, 40, 0.3) !important;
      pointer-events: none !important;
      z-index: 9999 !important;
    }
  `;
  document.head.appendChild(highlightStyles);
  console.log('MMS: Injected highlight styles');

  // Helper: Get thread ID from conversation element
  function getThreadId(conversationElement) {
    // Look for a link with /marketplace/t/{id}
    const link = conversationElement.querySelector('a[href*="/marketplace/t/"]');
    if (link) {
      const match = link.href.match(/\/marketplace\/t\/(\d+)/);
      return match ? match[1] : null;
    }
    return null;
  }

  // Helper: Find conversation element by thread ID
  function findConversationElement(threadId) {
    const links = document.querySelectorAll(`a[href*="/marketplace/t/${threadId}"]`);
    for (const link of links) {
      // Find the parent that represents the whole conversation item
      let parent = link;
      let attempts = 0;
      while (parent && attempts < 10) {
        // Conversation items typically have consistent height and are clickable
        const rect = parent.getBoundingClientRect();
        if (rect.height > 50 && rect.height < 200 && rect.width > 200) {
          return parent;
        }
        parent = parent.parentElement;
        attempts++;
      }
    }
    return null;
  }

  // Helper: Get conversation list container
  function getConversationListContainer() {
    // Strategy 1: Find a scrollable container with conversation links
    const conversationLinks = document.querySelectorAll('a[href*="/marketplace/t/"]');

    if (conversationLinks.length === 0) return null;

    // Start from the first conversation link and traverse up
    let container = conversationLinks[0];
    let candidates = [];

    while (container && container !== document.body) {
      const style = window.getComputedStyle(container);
      const hasScroll = style.overflowY === 'scroll' || style.overflowY === 'auto' || style.overflow === 'auto' || style.overflow === 'scroll';

      // Check if this container has multiple conversation items
      const childLinks = container.querySelectorAll('a[href*="/marketplace/t/"]');

      if (hasScroll && childLinks.length >= 2) {
        candidates.push({
          element: container,
          linkCount: childLinks.length,
          scrollHeight: container.scrollHeight,
          clientHeight: container.clientHeight
        });
      }

      container = container.parentElement;
    }

    // Return the candidate with the most links and is actually scrollable
    candidates.sort((a, b) => {
      // Prefer containers that are actually scrollable
      const aScrollable = a.scrollHeight > a.clientHeight;
      const bScrollable = b.scrollHeight > b.clientHeight;

      if (aScrollable && !bScrollable) return -1;
      if (!aScrollable && bScrollable) return 1;

      // Then prefer more links
      return b.linkCount - a.linkCount;
    });

    if (candidates.length > 0) {
      console.log('MMS: Found conversation container with', candidates[0].linkCount, 'links, scrollable:', candidates[0].scrollHeight > candidates[0].clientHeight);
      return candidates[0].element;
    }

    console.log('MMS: No suitable container found');
    return null;
  }

  // Find and catalog all conversation items currently in DOM
  function findConversationItems() {
    const conversationLinks = document.querySelectorAll('a[href*="/marketplace/t/"]');
    let newCount = 0;

    conversationLinks.forEach(link => {
      let conversationElement = link;
      let attempts = 0;

      // Find the conversation container
      while (conversationElement && attempts < 10) {
        const rect = conversationElement.getBoundingClientRect();

        // Heuristic: conversation items are typically 60-150px tall and clickable
        if (rect.height > 50 && rect.height < 200 && rect.width > 200) {
          const threadId = getThreadId(conversationElement);

          if (threadId && !allConversations.has(threadId)) {
            // Extract conversation info
            const text = conversationElement.textContent.trim();
            const data = {
              threadId,
              element: conversationElement,
              text,
              href: link.href
            };

            allConversations.set(threadId, data);
            newCount++;
            break;
          } else if (threadId) {
            // Update existing conversation (element may have been re-rendered)
            const existing = allConversations.get(threadId);
            existing.element = conversationElement;
            break;
          }
        }

        conversationElement = conversationElement.parentElement;
        attempts++;
      }
    });

    console.log(`MMS: Found ${newCount} new conversations (${allConversations.size} total)`);
    return allConversations.size;
  }

  // Search conversations
  function searchConversations(query, savedIndex = -1) {
    if (!query || query.trim() === '') {
      clearSearchHighlights();
      searchMatchIds = [];
      currentMatchIndex = -1;
      currentSearchQuery = '';
      saveSearchState();
      return { matches: 0, total: allConversations.size };
    }

    const searchTerm = query.toLowerCase().trim();
    currentSearchQuery = query;
    clearSearchHighlights();
    searchMatchIds = [];

    // Search through all conversations
    allConversations.forEach((data, threadId) => {
      if (data.text.toLowerCase().includes(searchTerm)) {
        searchMatchIds.push(threadId);
      }
    });

    // Highlight all matches
    highlightAllMatches();

    // Use saved index if provided, otherwise start at 0
    if (savedIndex >= 0 && savedIndex < searchMatchIds.length) {
      currentMatchIndex = savedIndex;
    } else {
      currentMatchIndex = searchMatchIds.length > 0 ? 0 : -1;
    }

    if (currentMatchIndex >= 0) {
      highlightCurrentMatch();
    }

    saveSearchState();
    return { matches: searchMatchIds.length, total: allConversations.size };
  }

  // Highlight all search matches
  function highlightAllMatches() {
    console.log('MMS: Highlighting', searchMatchIds.length, 'matches');
    searchMatchIds.forEach((threadId) => {
      const element = findConversationElement(threadId);
      if (element) {
        element.classList.remove('mms-current-match');
        element.classList.add('mms-search-match');
      }
    });
  }

  // Save search state
  function saveSearchState() {
    try {
      chrome.storage.sync.set({
        _messengerSearchQuery: currentSearchQuery,
        _messengerSearchIndex: currentMatchIndex
      });
    } catch (e) {
      // Ignore storage errors
    }
  }

  // Highlight current match and scroll to it
  function highlightCurrentMatch(shouldScroll = true) {
    console.log('MMS: Highlighting current match', currentMatchIndex, 'of', searchMatchIds.length);

    // Re-apply highlights to all matches
    highlightAllMatches();

    // Highlight current match specially
    if (searchMatchIds[currentMatchIndex]) {
      const threadId = searchMatchIds[currentMatchIndex];
      const element = findConversationElement(threadId);

      if (element) {
        element.classList.remove('mms-search-match');
        element.classList.add('mms-current-match');

        if (shouldScroll) {
          // Scroll within the conversation list container
          const container = getConversationListContainer();
          if (container) {
            console.log('MMS: Scrolling to match in container');
            const elementRect = element.getBoundingClientRect();
            const containerRect = container.getBoundingClientRect();

            // Calculate how much to scroll:
            // Element's position relative to container + current scroll - half container height
            const relativeTop = elementRect.top - containerRect.top;
            const targetScroll = container.scrollTop + relativeTop - (containerRect.height / 2) + (elementRect.height / 2);

            console.log('MMS: Container scrollTop:', container.scrollTop, '→', targetScroll);

            container.scrollTo({
              top: targetScroll,
              behavior: 'smooth'
            });
          } else {
            console.log('MMS: No container found, using scrollIntoView');
            // Fallback: scroll element into view
            element.scrollIntoView({
              behavior: 'smooth',
              block: 'center'
            });
          }
        }
      } else {
        // Element not in DOM, need to scroll to find it
        console.log('MMS: Conversation not in DOM, scrolling to find it...');
        scrollToFindConversation(threadId);
      }
    }
  }

  // Scroll to find a conversation that's not currently in DOM
  async function scrollToFindConversation(threadId) {
    const container = getConversationListContainer();
    if (!container) {
      console.log('MMS: Could not find conversation list container');
      return;
    }

    // Scroll to top first
    container.scrollTo({ top: 0, behavior: 'auto' });
    await new Promise(r => setTimeout(r, 300));

    // Scroll down looking for the conversation
    for (let i = 0; i < 30; i++) {
      const element = findConversationElement(threadId);
      if (element) {
        console.log('MMS: Found conversation after scrolling');
        element.classList.remove('mms-search-match');
        element.classList.add('mms-current-match');

        // Center it in the container
        const elementRect = element.getBoundingClientRect();
        const containerRect = container.getBoundingClientRect();
        const relativeTop = elementRect.top - containerRect.top;
        const targetScroll = container.scrollTop + relativeTop - (containerRect.height / 2) + (elementRect.height / 2);

        container.scrollTo({
          top: targetScroll,
          behavior: 'smooth'
        });

        return;
      }

      // Scroll down
      container.scrollBy({ top: container.clientHeight * 0.7, behavior: 'auto' });
      await new Promise(r => setTimeout(r, 300));
    }

    console.log('MMS: Could not find conversation after scrolling');
  }

  // Navigate to next match
  function nextMatch() {
    if (searchMatchIds.length === 0) return currentMatchIndex;
    currentMatchIndex = (currentMatchIndex + 1) % searchMatchIds.length;

    // Re-apply all highlights first (in case elements were re-rendered)
    setTimeout(() => {
      highlightAllMatches();
      highlightCurrentMatch();
    }, 50);

    saveSearchState();
    return currentMatchIndex;
  }

  // Navigate to previous match
  function prevMatch() {
    if (searchMatchIds.length === 0) return currentMatchIndex;
    currentMatchIndex = (currentMatchIndex - 1 + searchMatchIds.length) % searchMatchIds.length;

    // Re-apply all highlights first (in case elements were re-rendered)
    setTimeout(() => {
      highlightAllMatches();
      highlightCurrentMatch();
    }, 50);

    saveSearchState();
    return currentMatchIndex;
  }

  // Clear all search highlights
  function clearSearchHighlights() {
    searchMatchIds.forEach((threadId) => {
      const element = findConversationElement(threadId);
      if (element) {
        element.classList.remove('mms-search-match', 'mms-current-match');
      }
    });

    // Also clear any stray highlights
    document.querySelectorAll('.mms-search-match, .mms-current-match').forEach(el => {
      el.classList.remove('mms-search-match', 'mms-current-match');
    });
  }

  // Auto-scroll to load all conversations
  async function loadAllConversations(progressCallback) {
    if (isAutoScrolling) {
      isAutoScrolling = false;
      return { stopped: true };
    }

    isAutoScrolling = true;
    const container = getConversationListContainer();

    if (!container) {
      console.log('MMS: Could not find conversation list container');
      console.log('MMS: Trying to find any scrollable element...');

      // Fallback: try to find ANY scrollable element
      const allElements = document.querySelectorAll('*');
      for (const el of allElements) {
        const style = window.getComputedStyle(el);
        const hasScroll = style.overflowY === 'scroll' || style.overflowY === 'auto';
        if (hasScroll && el.scrollHeight > el.clientHeight) {
          const links = el.querySelectorAll('a[href*="/marketplace/t/"]');
          if (links.length >= 2) {
            console.log('MMS: Found fallback container with', links.length, 'links');
            return loadWithContainer(el, progressCallback);
          }
        }
      }

      isAutoScrolling = false;
      return { total: allConversations.size, error: 'Container not found' };
    }

    console.log('MMS: Starting auto-scroll with container:', container);
    console.log('MMS: Container scrollHeight:', container.scrollHeight, 'clientHeight:', container.clientHeight);

    return loadWithContainer(container, progressCallback);
  }

  async function loadWithContainer(container, progressCallback) {
    let previousCount = 0;
    let sameCountIterations = 0;
    const maxSameCount = 5;
    let scrollAttempts = 0;
    const maxScrollAttempts = 50; // Prevent infinite loops

    while (isAutoScrolling && scrollAttempts < maxScrollAttempts) {
      scrollAttempts++;

      // Get current scroll position
      const beforeScroll = container.scrollTop;

      // Scroll to bottom of container - try multiple methods
      container.scrollTop = container.scrollHeight;
      container.scrollTo({ top: container.scrollHeight, behavior: 'auto' });

      const afterScroll = container.scrollTop;

      console.log(`MMS: Scroll attempt ${scrollAttempts}: scrollTop ${beforeScroll} → ${afterScroll} (max: ${container.scrollHeight})`);

      // Wait for content to load
      await new Promise(resolve => setTimeout(resolve, 1000));

      // Update conversations
      findConversationItems();
      const currentCount = allConversations.size;

      console.log(`MMS: Found ${currentCount} conversations (previous: ${previousCount})`);

      if (progressCallback) {
        progressCallback(currentCount);
      }

      // Check if we're still finding new conversations
      if (currentCount === previousCount) {
        sameCountIterations++;
        console.log(`MMS: No new conversations found (${sameCountIterations}/${maxSameCount})`);
        if (sameCountIterations >= maxSameCount) {
          console.log('MMS: Stopping - no new conversations after multiple attempts');
          isAutoScrolling = false;
          break;
        }
      } else {
        sameCountIterations = 0;
      }

      previousCount = currentCount;
    }

    console.log('MMS: Auto-scroll complete. Total conversations:', allConversations.size);

    // Scroll back to top
    container.scrollTo({ top: 0, behavior: 'smooth' });

    return { total: allConversations.size, stopped: !isAutoScrolling };
  }

  // Stop auto-scroll
  function stopAutoScroll() {
    isAutoScrolling = false;
  }

  // Listen for messages from popup
  chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === 'search') {
      const result = searchConversations(request.query);
      sendResponse({
        matches: result.matches,
        total: result.total,
        currentIndex: currentMatchIndex
      });
    } else if (request.action === 'restoreSearch') {
      const result = searchConversations(request.query, request.savedIndex);
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
      loadAllConversations((count) => {
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
        totalLoaded: allConversations.size,
        currentQuery: currentSearchQuery,
        currentIndex: currentMatchIndex,
        totalMatches: searchMatchIds.length
      });
    }
    return true;
  });

  // Initialize - find conversations periodically
  function startMonitoring() {
    // Initial scan
    findConversationItems();

    // Set up MutationObserver for dynamic content
    const observer = new MutationObserver(() => {
      clearTimeout(window.mmsUpdateTimeout);
      window.mmsUpdateTimeout = setTimeout(() => {
        findConversationItems();
        // Re-apply highlights if there's an active search
        if (searchMatchIds.length > 0) {
          highlightAllMatches();
          if (currentMatchIndex >= 0) {
            const threadId = searchMatchIds[currentMatchIndex];
            const element = findConversationElement(threadId);
            if (element) {
              element.classList.remove('mms-search-match');
              element.classList.add('mms-current-match');
            }
          }
        }
      }, 300);
    });

    observer.observe(document.body, {
      childList: true,
      subtree: true
    });

    // Also monitor scroll events on the conversation list
    const container = getConversationListContainer();
    if (container) {
      let scrollTimeout;
      container.addEventListener('scroll', () => {
        clearTimeout(scrollTimeout);
        scrollTimeout = setTimeout(() => {
          findConversationItems();
        }, 500);
      }, { passive: true });
    }

    console.log('MMS: Monitoring started');
  }

  // Wait for content to be ready
  function waitForContent() {
    const hasConversations = document.querySelector('a[href*="/marketplace/t/"]');

    if (hasConversations) {
      startMonitoring();
    } else {
      const startupObserver = new MutationObserver((mutations, obs) => {
        const conversations = document.querySelector('a[href*="/marketplace/t/"]');
        if (conversations) {
          obs.disconnect();
          startMonitoring();
        }
      });

      startupObserver.observe(document.body, {
        childList: true,
        subtree: true
      });

      // Fallback: start anyway after 5 seconds
      setTimeout(() => {
        startupObserver.disconnect();
        startMonitoring();
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
    // Don't trigger if user is typing
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

  console.log('MMS: Messenger Marketplace Search loaded!');
})();
