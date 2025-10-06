// adapters/ChromeStorageLogAdapter.js
import { Logger } from '../core/logger.js'; // Для типов

/**
 * @typedef {import('../core/types/log.types.js').LogEntry} LogEntry
 * @typedef {import('../core/types/log.types.js').LogAdapter} LogAdapter
 */

export class ChromeStorageLogAdapter {
    /** @type {string} */
    #storageKey;
    /** @type {number} */
    #maxSize;

    /**
     * @param {Object} options
     * @param {string} [options.storageKey='appLogs']
     * @param {number} [options.maxSize=500]
     */
    constructor(options = {}) {
        // Проверяем доступность chrome.storage.local
        if (typeof chrome === 'undefined' || !chrome.storage || !chrome.storage.local) {
            throw new Error('ChromeStorageLogAdapter: chrome.storage.local is not available.');
        }

        this.#storageKey = options.storageKey ?? 'appLogs';
        this.#maxSize = options.maxSize ?? 500;
    }

    /**
     * @param {LogEntry} entry
     * @returns {Promise<void>}
     */
    async write(entry) {
        try {
            const logs = await this.read();
            logs.push(entry);
            if (logs.length > this.#maxSize) {
                logs.splice(0, logs.length - this.#maxSize);
            }
            await chrome.storage.local.set({ [this.#storageKey]: logs });
        } catch (e) {
            console.error("[ChromeStorageLogAdapter] Ошибка записи:", e);
            // В реальном адаптере можно выбрасывать ошибку или логировать иначе
            // throw e;
        }
    }

    /**
     * @returns {Promise<LogEntry[]>}
     */
    async read() {
        try {
            const result = await chrome.storage.local.get([this.#storageKey]);
            return result[this.#storageKey] || [];
        } catch (e) {
            console.error("[ChromeStorageLogAdapter] Ошибка чтения:", e);
            return [];
        }
    }

    /**
     * @returns {Promise<void>}
     */
    async clear() {
        try {
            await chrome.storage.local.remove([this.#storageKey]);
        } catch (e) {
            console.error("[ChromeStorageLogAdapter] Ошибка очистки:", e);
        }
    }
}