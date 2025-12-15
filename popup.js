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

  let isLoading = false;

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

  chrome.runtime.onMessage.addListener((request) => {
    if (request.action === 'loadProgress' && isLoading) {
      loadAllBtn.textContent = `Loading... ${request.count} items (click to stop)`;
    }
  });

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
        searchStatus.textContent = `${stats.totalLoaded} items loaded`;
      }
    } else {
      chrome.storage.sync.get(['_searchQuery', '_searchIndex'], async (result) => {
        if (result._searchQuery) {
          searchInput.value = result._searchQuery;
          const response = await sendToContent({
            action: 'restoreSearch',
            query: result._searchQuery,
            savedIndex: result._searchIndex || 0
          });
          if (response && response.matches > 0) {
            searchStatus.textContent = `Found ${response.matches} match${response.matches !== 1 ? 'es' : ''} (${response.total} items loaded)`;
            searchStatus.classList.add('has-results');
            searchNav.style.display = 'flex';
            updateMatchPosition(response.currentIndex + 1, response.matches);
          }
        }
      });
    }
  }

  restoreSearchState();
});
