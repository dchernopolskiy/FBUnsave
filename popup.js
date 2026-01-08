document.addEventListener('DOMContentLoaded', () => {
  const hideSoldCheckbox = document.getElementById('hideSold');
  const hidePendingCheckbox = document.getElementById('hidePending');
  const searchInput = document.getElementById('searchInput');
  const searchBtn = document.getElementById('searchBtn');
  const searchStatus = document.getElementById('searchStatus');
  const searchNav = document.getElementById('searchNav');
  const prevMatchBtn = document.getElementById('prevMatch');
  const nextMatchBtn = document.getElementById('nextMatch');
  const clearSearchBtn = document.getElementById('clearSearch');
  const matchPosition = document.getElementById('matchPosition');
  const loadAllBtn = document.getElementById('loadAllBtn');
  const filterSection = document.getElementById('filterSection');
  const searchTitle = document.getElementById('searchTitle');
  const helpText = document.getElementById('helpText');
  const navLink = document.getElementById('navLink');
  const checkPricesBtn = document.getElementById('checkPricesBtn');
  const priceResults = document.getElementById('priceResults');
  const priceSection = document.getElementById('priceSection');

  let isLoading = false;
  let isMessengerPage = false;
  let isCheckingPrices = false;

  chrome.storage.sync.get(['hideSold', 'hidePending'], (result) => {
    hideSoldCheckbox.checked = result.hideSold !== false;
    hidePendingCheckbox.checked = result.hidePending === true;
  });

  hideSoldCheckbox.addEventListener('change', (e) => {
    chrome.storage.sync.set({ hideSold: e.target.checked });
  });

  hidePendingCheckbox.addEventListener('change', (e) => {
    chrome.storage.sync.set({ hidePending: e.target.checked });
  });

  function sendToContent(message) {
    return new Promise((resolve) => {
      chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        if (tabs[0]) {
          chrome.tabs.sendMessage(tabs[0].id, message, (response) => {
            if (chrome.runtime.lastError) {
              resolve(null);
              return;
            }
            resolve(response);
          });
        } else {
          resolve(null);
        }
      });
    });
  }

  async function performSearch() {
    const query = searchInput.value.trim();
    if (!query) {
      searchStatus.textContent = '';
      searchStatus.classList.remove('has-results');
      searchNav.style.display = 'none';
      return;
    }

    searchBtn.disabled = true;
    searchStatus.textContent = 'Searching...';

    const response = await sendToContent({ action: 'search', query: query });

    searchBtn.disabled = false;

    if (response) {
      if (response.matches > 0) {
        searchStatus.textContent = `Found ${response.matches} match${response.matches !== 1 ? 'es' : ''} (${response.total} items loaded)`;
        searchStatus.classList.add('has-results');
        searchNav.style.display = 'flex';
        updateMatchPosition(response.currentIndex + 1, response.matches);
      } else {
        searchStatus.textContent = `No matches found (${response.total} items loaded)`;
        searchStatus.classList.remove('has-results');
        searchNav.style.display = 'none';
      }
    } else {
      searchStatus.textContent = 'Error: Make sure you\'re on the Saved page';
      searchStatus.classList.remove('has-results');
      searchNav.style.display = 'none';
    }
  }

  function updateMatchPosition(current, total) {
    matchPosition.textContent = `${current}/${total}`;
  }

  searchBtn.addEventListener('click', performSearch);

  searchInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') {
      performSearch();
    }
  });

  prevMatchBtn.addEventListener('click', async () => {
    const response = await sendToContent({ action: 'prevMatch' });
    if (response) {
      updateMatchPosition(response.currentIndex + 1, response.total);
    }
  });

  nextMatchBtn.addEventListener('click', async () => {
    const response = await sendToContent({ action: 'nextMatch' });
    if (response) {
      updateMatchPosition(response.currentIndex + 1, response.total);
    }
  });

  clearSearchBtn.addEventListener('click', async () => {
    searchInput.value = '';
    searchStatus.textContent = '';
    searchStatus.classList.remove('has-results');
    searchNav.style.display = 'none';
    await sendToContent({ action: 'clearSearch' });
  });

  loadAllBtn.addEventListener('click', async () => {
    if (isLoading) {
      await sendToContent({ action: 'stopLoadAll' });
      loadAllBtn.textContent = 'Load all items (scroll to bottom)';
      loadAllBtn.classList.remove('loading');
      isLoading = false;
      return;
    }

    isLoading = true;
    loadAllBtn.textContent = 'Loading... (click to stop)';
    loadAllBtn.classList.add('loading');

    const response = await sendToContent({ action: 'loadAll' });

    isLoading = false;
    loadAllBtn.classList.remove('loading');

    if (response) {
      loadAllBtn.textContent = `Loaded ${response.total} items`;
      setTimeout(() => {
        loadAllBtn.textContent = 'Load all items (scroll to bottom)';
      }, 3000);
    } else {
      loadAllBtn.textContent = 'Error - click this again when page fully loads';
      setTimeout(() => {
        loadAllBtn.textContent = 'Load all items (scroll to bottom)';
      }, 3000);
    }
  });

  checkPricesBtn.addEventListener('click', async () => {
    if (isCheckingPrices) return;

    isCheckingPrices = true;
    checkPricesBtn.disabled = true;
    checkPricesBtn.textContent = 'Checking prices...';
    priceResults.style.display = 'none';

    const response = await sendToContent({ action: 'checkPrices' });

    isCheckingPrices = false;
    checkPricesBtn.disabled = false;
    checkPricesBtn.textContent = 'Check for price changes';

    if (response && !response.error) {
      displayPriceResults(response);
    } else {
      priceResults.innerHTML = '<div style="color: #f02849; font-size: 11px;">Error checking prices. Make sure you\'re on the saved items page.</div>';
      priceResults.style.display = 'block';
    }
  });

  function displayPriceResults(data) {
    const { totalChecked, drops, increases, newItems } = data;

    let html = '';

    if (drops.length > 0) {
      html += '<div style="font-weight: 600; margin-bottom: 6px; color: #42b72a;">Price Drops:</div>';
      drops.forEach(item => {
        const dropPercent = ((item.dropAmount / item.previousPrice) * 100).toFixed(0);
        html += `
          <div class="price-drop">
            <div class="price-item-title">${escapeHtml(item.title)}</div>
            <div class="price-change">
              $${item.previousPrice.toFixed(2)} → $${item.currentPrice.toFixed(2)}
              (-$${item.dropAmount.toFixed(2)}, ${dropPercent}% off)
            </div>
          </div>
        `;
      });
    }

    if (increases.length > 0) {
      html += '<div style="font-weight: 600; margin: 12px 0 6px 0; color: #f7b928;">Price Increases:</div>';
      increases.forEach(item => {
        const increasePercent = ((item.increaseAmount / item.previousPrice) * 100).toFixed(0);
        html += `
          <div class="price-increase">
            <div class="price-item-title">${escapeHtml(item.title)}</div>
            <div class="price-change">
              $${item.previousPrice.toFixed(2)} → $${item.currentPrice.toFixed(2)}
              (+$${item.increaseAmount.toFixed(2)}, +${increasePercent}%)
            </div>
          </div>
        `;
      });
    }

    if (drops.length === 0 && increases.length === 0) {
      html += '<div style="color: #65676b; font-size: 12px; text-align: center; padding: 8px;">No price changes detected</div>';
    }

    html += `
      <div class="price-stats">
        Checked ${totalChecked} item${totalChecked !== 1 ? 's' : ''} •
        ${drops.length} drop${drops.length !== 1 ? 's' : ''} •
        ${increases.length} increase${increases.length !== 1 ? 's' : ''} •
        ${newItems.length} new
      </div>
    `;

    priceResults.innerHTML = html;
    priceResults.style.display = 'block';
  }

  function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  chrome.runtime.onMessage.addListener((request) => {
    if (request.action === 'loadProgress' && isLoading) {
      loadAllBtn.textContent = `Loading... ${request.count} items (click to stop)`;
    }
  });

  // Detect which page we're on
  async function detectPage() {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (tabs[0] && tabs[0].url) {
        const url = tabs[0].url;
        if (url && url.includes('messenger.com/marketplace')) {
          isMessengerPage = true;
          // Hide filter options and price tracking on Messenger (they don't apply)
          if (filterSection) {
            filterSection.style.display = 'none';
          }
          if (priceSection) {
            priceSection.style.display = 'none';
          }
          // Update search title
          if (searchTitle) {
            searchTitle.textContent = 'Search Conversations';
          }
          // Update placeholder
          searchInput.placeholder = 'Search conversations...';
          // Update load button text
          loadAllBtn.textContent = 'Load all conversations (scroll to bottom)';
          // Update help text
          if (helpText) {
            helpText.innerHTML = '<strong>Tip:</strong> Click "Load all conversations" first to search through everything that\'s loaded!';
          }
          // Show link to Facebook Marketplace
          if (navLink) {
            navLink.textContent = '→ Search in Facebook Marketplace';
            navLink.href = 'https://www.facebook.com/marketplace/you/saved';
            navLink.style.display = 'inline-block';
            navLink.target = '_blank';
          }
        } else if (url && url.includes('facebook.com/marketplace')) {
          // On Facebook Marketplace - show link to Messenger
          if (navLink) {
            navLink.textContent = '→ Search Marketplace Conversations';
            navLink.href = 'https://www.messenger.com/marketplace';
            navLink.style.display = 'inline-block';
            navLink.target = '_blank';
          }
        }
      }
    });
  }

  async function restoreSearchState() {
    const stats = await sendToContent({ action: 'getStats' });

    if (stats) {
      if (stats.currentQuery) {
        searchInput.value = stats.currentQuery;
        if (stats.totalMatches > 0) {
          searchStatus.textContent = `Found ${stats.totalMatches} match${stats.totalMatches !== 1 ? 'es' : ''} (${stats.totalLoaded} items loaded)`;
          searchStatus.classList.add('has-results');
          searchNav.style.display = 'flex';
          updateMatchPosition(stats.currentIndex + 1, stats.totalMatches);
        } else {
          searchStatus.textContent = `No matches found (${stats.totalLoaded} items loaded)`;
          searchStatus.classList.remove('has-results');
          searchNav.style.display = 'none';
        }
      } else if (stats.totalLoaded > 0) {
        const itemLabel = isMessengerPage ? 'conversations' : 'items';
        searchStatus.textContent = `${stats.totalLoaded} ${itemLabel} loaded`;
      }
    } else {
      const storageKeys = isMessengerPage ?
        ['_messengerSearchQuery', '_messengerSearchIndex'] :
        ['_searchQuery', '_searchIndex'];

      chrome.storage.sync.get(storageKeys, async (result) => {
        const query = isMessengerPage ? result._messengerSearchQuery : result._searchQuery;
        const index = isMessengerPage ? result._messengerSearchIndex : result._searchIndex;

        if (query) {
          searchInput.value = query;
          const response = await sendToContent({
            action: 'restoreSearch',
            query: query,
            savedIndex: index || 0
          });
          if (response && response.matches > 0) {
            const itemLabel = isMessengerPage ? 'conversations' : 'items';
            searchStatus.textContent = `Found ${response.matches} match${response.matches !== 1 ? 'es' : ''} (${response.total} ${itemLabel} loaded)`;
            searchStatus.classList.add('has-results');
            searchNav.style.display = 'flex';
            updateMatchPosition(response.currentIndex + 1, response.matches);
          }
        }
      });
    }
  }

  detectPage();
  restoreSearchState();
});
