// core/types/log.types.js
/**
 * @typedef {Object} LogEntry
 * @property {string} id - Уникальный идентификатор записи.
 * @property {number} timestamp - Временная метка (мс с 1970).
 * @property {string} level - Уровень лога: 'debug', 'info', 'success', 'warn', 'error'.
 * @property {string} message - Текст сообщения.
 * @property {string} [module] - Модуль или компонент, создавший запись.
 * @property {string} [contextId] - Идентификатор контекста.
 * @property {Object} [meta] - Дополнительные данные.
 */

/**
 * @typedef {Object} LoggerConfig
 * @property {number} [maxSize=1000] - Максимальное количество записей.
 * @property {boolean} [enableConsole=true] - Дублировать в console.
 * @property {string} [defaultLevel='info'] - Уровень по умолчанию.
 */

/**
 * @callback LogSubscriber
 * @param {LogEntry | { type: 'CLEAR_LOGS' }} entry
 * @returns {void}
 */

/**
 * @typedef {Object} LogAdapter
 * @property {function(LogEntry): Promise<void>} write
 * @property {function(): Promise<LogEntry[]>} read
 * @property {function(): Promise<void>} clear
 */