// core/logger.js
import { ChromeStorageLogAdapter } from '../adapters/ChromeStorageLogAdapter.js';

/**
 * @typedef {import('./types/log.types.js').LogEntry} LogEntry
 * @typedef {import('./types/log.types.js').LoggerConfig} LoggerConfig
 * @typedef {import('./types/log.types.js').LogAdapter} LogAdapter
 * @typedef {import('./types/log.types.js').LogSubscriber} LogSubscriber
 */

export class Logger {
    /** @type {LogAdapter[]} */
    #adapters = [];
    /** @type {LogSubscriber[]} */
    #subscribers = [];
    /** @type {LoggerConfig} */
    #config;

    /**
     * @param {LoggerConfig} config
     */
    constructor(config = {}) {
        this.#config = {
            maxSize: config.maxSize ?? 1000,
            enableConsole: config.enableConsole ?? true,
            defaultLevel: config.defaultLevel ?? 'info',
        };

        // По умолчанию добавляем адаптер для Chrome Storage
        this.addAdapter(new ChromeStorageLogAdapter({ maxSize: this.#config.maxSize }));
    }

    /**
     * Добавляет адаптер для хранения/вывода логов.
     * @param {LogAdapter} adapter
     */
    addAdapter(adapter) {
        this.#adapters.push(adapter);
    }

    /**
     * Подписывается на новые логи и команды (например, очистка).
     * @param {LogSubscriber} callback
     */
    subscribe(callback) {
        this.#subscribers.push(callback);
    }

    /**
     * Отписывается от новых логов.
     * @param {LogSubscriber} callback
     */
    unsubscribe(callback) {
        this.#subscribers = this.#subscribers.filter(cb => cb !== callback);
    }

    /**
     * Создает и записывает лог-запись.
     * @param {string} message
     * @param {'debug'|'info'|'success'|'warn'|'error'} [level]
     * @param {Object} [options]
     * @param {string} [options.module]
     * @param {string} [options.contextId]
     * @param {Object} [options.meta]
     */
    async log(message, level = this.#config.defaultLevel, options = {}) {
        const entry = {
            id: this.#generateId(),
            timestamp: Date.now(),
            level,
            message,
            module: options.module,
            contextId: options.contextId,
            meta: options.meta,
        };

        // 1. Запись через адаптеры
        const writePromises = this.#adapters.map(adapter => adapter.write(entry));
        await Promise.allSettled(writePromises); // Не прерываемся из-за ошибки одного адаптера

        // 2. Дублирование в консоль (если включено)
        if (this.#config.enableConsole) {
            this.#logToConsole(entry);
        }

        // 3. Уведомление подписчиков
        this.#notifySubscribers(entry);

        // 4. 👇 НОВОЕ: Отправка сообщения в popup (если в background)
        // Проверяем, что мы в Service Worker (background)
        if (typeof chrome !== 'undefined' && chrome.runtime) {
            try {
                // Используем стрелочную функцию для правильного контекста this
                chrome.runtime.sendMessage({
                    type: "newLog",
                    log: entry
                }).catch(err => {
                    // Это обработка ошибки асинхронной операции sendMessage
                    if (chrome.runtime.lastError) {
                        // Это нормально, если popup закрыт
                        // console.debug("Popup недоступен для sendMessage:", chrome.runtime.lastError.message);
                    } else {
                        console.debug("Ошибка при отправке лога в popup (асинхронная):", err);
                    }
                });
            } catch (syncSendError) {
                // Это обработка синхронной ошибки при вызове sendMessage
                // Может возникнуть, если API недоступен в текущем контексте (редко)
                console.debug("Синхронная ошибка при вызове sendMessage:", syncSendError);
            }
        }
    }

    /**
     * Получает все логи из всех адаптеров (берет из первого доступного).
     * @returns {Promise<LogEntry[]>}
     */
    async getAllLogs() {
        for (const adapter of this.#adapters) {
            try {
                const logs = await adapter.read();
                return logs;
            } catch (e) {
                console.warn("[Logger] Не удалось получить логи из адаптера:", e);
            }
        }
        return []; // Если ни один адаптер не сработал
    }

    /**
     * Очищает логи во всех адаптерах.
     * @returns {Promise<void>}
     */
    async clear() {
        const clearPromises = this.#adapters.map(adapter => adapter.clear());
        await Promise.allSettled(clearPromises);
        // Уведомляем подписчиков об очистке
        this.#notifySubscribers({ type: 'CLEAR_LOGS' });
    }

    /**
     * Отправляет событие обновления метрики в UI.
     * @param {string} metricName - Название метрики (например, 'russianChannelAverage').
     * @param {number} value - Значение метрики.
     * @param {Object} [options] - Дополнительные опции.
     * @param {string} [options.format] - Формат отображения (например, '.2f').
    */
    async updateMetric(metricName, value, options = {}) {
        const formattedValue = options.format ? value.toFixed(parseFloat(options.format)) : value;
        const entry = {
            type: 'UPDATE_METRIC',
            metricName,
            value,
            formattedValue,
            options
        };
        console.log("[Logger] updateMetric: Подготовка к отправке события в popup:", entry);
        // 👇 Отправляем сообщение в popup (если в background)
        if (typeof chrome !== 'undefined' && chrome.runtime) {
            try {
                chrome.runtime.sendMessage({
                    type: "updateMetric",
                    metric: entry
                }).catch(err => {
                    if (!chrome.runtime.lastError) {
                        console.debug("Ошибка при отправке updateMetric в popup:", err);
                    }
                });
                console.log("[Logger] updateMetric: Событие успешно отправлено в popup.");
            } catch (syncSendError) {
                console.debug("Синхронная ошибка при вызове sendMessage (updateMetric):", syncSendError);
            }
        }
        // 👇 Также уведомляем подписчиков (на случай, если кто-то внутри background слушает)
        this.#notifySubscribers(entry);
    }

    // --- Вспомогательные методы ---

    /**
     * Удобные методы для разных уровней
     */
    debug(message, options = {}) { return this.log(message, 'debug', options); }
    info(message, options = {}) { return this.log(message, 'info', options); }
    success(message, options = {}) { return this.log(message, 'success', options); }
    warn(message, options = {}) { return this.log(message, 'warn', options); }
    error(message, options = {}) { return this.log(message, 'error', options); }

    /**
     * Генерирует уникальный ID для записи.
     * @returns {string}
     */
    #generateId() {
        return Date.now().toString(36) + Math.random().toString(36).substr(2, 9);
    }

    /**
     * Выводит лог в консоль браузера.
     * @param {LogEntry} entry
     */
    #logToConsole(entry) {
        const time = new Date(entry.timestamp).toLocaleTimeString();
        const prefix = `[${time}] [${entry.level.toUpperCase()}]`;
        const suffix = entry.module ? `[${entry.module}]` : '';
        const context = entry.contextId ? `(ctx:${entry.contextId})` : '';

        const consoleMethod = entry.level === 'error' ? console.error :
            entry.level === 'warn' ? console.warn :
                entry.level === 'debug' ? console.debug : console.log;

        consoleMethod(`${prefix} ${entry.message} ${suffix} ${context}`, entry.meta || '');
    }

    /**
     * Уведомляет всех подписчиков.
     * @param {LogEntry | { type: 'CLEAR_LOGS' }} entry
     */
    #notifySubscribers(entry) {
        this.#subscribers.forEach(callback => {
            try {
                callback(entry);
            } catch (e) {
                console.error("[Logger] Ошибка в подписчике:", e);
            }
        });
    }
}