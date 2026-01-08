// IndexedDB wrapper for price tracking
// Stores item data with price history

(function() {
  'use strict';

  // Prevent multiple initialization
  if (typeof window.priceTracker !== 'undefined') {
    console.log('PriceTracker: Already loaded, skipping re-initialization');
    return;
  }

  const DB_NAME = 'FBMarketplacePriceTracker';
  const DB_VERSION = 1;
  const STORE_NAME = 'items';

  class PriceTracker {
  constructor() {
    this.db = null;
  }

  // Initialize database
  async init() {
    if (this.db) {
      console.log('PriceTracker: Already initialized');
      return this.db;
    }

    console.log('PriceTracker: Opening IndexedDB...');
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);

      request.onerror = () => {
        console.error('PriceTracker: IndexedDB open error:', request.error);
        reject(request.error);
      };

      request.onsuccess = () => {
        console.log('PriceTracker: IndexedDB opened successfully');
        this.db = request.result;
        resolve(this.db);
      };

      request.onupgradeneeded = (event) => {
        console.log('PriceTracker: Upgrading database schema...');
        const db = event.target.result;

        // Create object store if it doesn't exist
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          console.log('PriceTracker: Creating object store:', STORE_NAME);
          const objectStore = db.createObjectStore(STORE_NAME, { keyPath: 'itemId' });

          // Create indexes for efficient querying
          objectStore.createIndex('lastChecked', 'lastChecked', { unique: false });
          objectStore.createIndex('title', 'title', { unique: false });
          console.log('PriceTracker: Object store created successfully');
        }
      };
    });
  }

  // Save or update an item
  async saveItem(itemData) {
    if (!this.db) await this.init();

    return new Promise((resolve, reject) => {
      const transaction = this.db.transaction([STORE_NAME], 'readwrite');
      const objectStore = transaction.objectStore(STORE_NAME);

      // Get existing item if it exists
      const getRequest = objectStore.get(itemData.itemId);

      getRequest.onsuccess = () => {
        const existingItem = getRequest.result;
        const now = Date.now();

        let itemToSave;

        if (existingItem) {
          // Update existing item
          itemToSave = {
            ...existingItem,
            title: itemData.title,
            currentPrice: itemData.price,
            lastChecked: now,
            url: itemData.url,
            imageUrl: itemData.imageUrl || existingItem.imageUrl,
            location: itemData.location || existingItem.location,
            seller: itemData.seller || existingItem.seller
          };

          // Add to price history if price changed
          if (existingItem.currentPrice !== itemData.price) {
            itemToSave.priceHistory = [
              ...(existingItem.priceHistory || []),
              {
                price: itemData.price,
                date: now
              }
            ];
          } else {
            itemToSave.priceHistory = existingItem.priceHistory || [];
          }
        } else {
          // New item
          itemToSave = {
            itemId: itemData.itemId,
            title: itemData.title,
            currentPrice: itemData.price,
            firstSeen: now,
            lastChecked: now,
            url: itemData.url,
            imageUrl: itemData.imageUrl,
            location: itemData.location,
            seller: itemData.seller,
            priceHistory: [{
              price: itemData.price,
              date: now
            }]
          };
        }

        const putRequest = objectStore.put(itemToSave);
        putRequest.onsuccess = () => resolve(itemToSave);
        putRequest.onerror = () => reject(putRequest.error);
      };

      getRequest.onerror = () => reject(getRequest.error);
    });
  }

  // Get an item by ID
  async getItem(itemId) {
    if (!this.db) await this.init();

    return new Promise((resolve, reject) => {
      const transaction = this.db.transaction([STORE_NAME], 'readonly');
      const objectStore = transaction.objectStore(STORE_NAME);
      const request = objectStore.get(itemId);

      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  // Get all items
  async getAllItems() {
    if (!this.db) await this.init();

    return new Promise((resolve, reject) => {
      const transaction = this.db.transaction([STORE_NAME], 'readonly');
      const objectStore = transaction.objectStore(STORE_NAME);
      const request = objectStore.getAll();

      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  // Get items with price drops
  async getItemsWithPriceDrops() {
    const allItems = await this.getAllItems();

    return allItems.filter(item => {
      if (!item.priceHistory || item.priceHistory.length < 2) return false;

      // Compare current price with first seen price
      const firstPrice = item.priceHistory[0].price;
      const currentPrice = item.currentPrice;

      return currentPrice < firstPrice;
    });
  }

  // Get items with price increases
  async getItemsWithPriceIncreases() {
    const allItems = await this.getAllItems();

    return allItems.filter(item => {
      if (!item.priceHistory || item.priceHistory.length < 2) return false;

      const firstPrice = item.priceHistory[0].price;
      const currentPrice = item.currentPrice;

      return currentPrice > firstPrice;
    });
  }

  // Delete an item
  async deleteItem(itemId) {
    if (!this.db) await this.init();

    return new Promise((resolve, reject) => {
      const transaction = this.db.transaction([STORE_NAME], 'readwrite');
      const objectStore = transaction.objectStore(STORE_NAME);
      const request = objectStore.delete(itemId);

      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  }

  // Clear all data
  async clearAll() {
    if (!this.db) await this.init();

    return new Promise((resolve, reject) => {
      const transaction = this.db.transaction([STORE_NAME], 'readwrite');
      const objectStore = transaction.objectStore(STORE_NAME);
      const request = objectStore.clear();

      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  }

  // Get statistics
  async getStats() {
    const allItems = await this.getAllItems();
    const drops = await this.getItemsWithPriceDrops();
    const increases = await this.getItemsWithPriceIncreases();

    return {
      totalItems: allItems.length,
      priceDrops: drops.length,
      priceIncreases: increases.length,
      unchanged: allItems.length - drops.length - increases.length
    };
  }
}

  // Export singleton instance to window
  window.priceTracker = new PriceTracker();
  console.log('PriceTracker: Initialized and exported to window.priceTracker');
})(); // End IIFE
