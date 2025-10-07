
// core/scenario-engine.js
import { logger } from '../background/background.js'; // Импортируем логгер

/**
 * @typedef {import('./types/scenario.types.js').ScenarioDefinition} ScenarioDefinition
 * @typedef {import('./types/scenario.types.js').ScenarioContext} ScenarioContext
 */

export class ScenarioEngine {
    /** @type {Map<string, { definition: ScenarioDefinition, context: ScenarioContext, controller: AbortController }>} */
    #runningScenarios = new Map();

    /**
     * Регистрирует сценарий в движке.
     * @param {ScenarioDefinition} scenarioDefinition
     */
    registerScenario(scenarioDefinition) {
        // В будущем можно хранить определения для UI/выбора
        // Пока просто логируем регистрацию
        logger.debug(`[ScenarioEngine] Зарегистрирован сценарий: ${scenarioDefinition.name}`, { module: 'ScenarioEngine' });
    }

    /**
     * Запускает сценарий.
     * @param {ScenarioDefinition} scenarioDefinition
     * @param {Object} [params={}] - Параметры для сценария.
     * @param {number} [tabId] - ID вкладки, если применимо.
     * @returns {Promise<string>} ID запущенного экземпляра сценария.
     */

    async run(scenarioDefinition, params = {}, tabId = null) {
        const instanceId = this.#generateId();
        const controller = new AbortController();
        console.log(`[ScenarioEngine] Начало запуска сценария ${scenarioDefinition.id}, tabId:`, tabId); // <-- Лог

        /** @type {ScenarioContext} */
        const context = {
            id: instanceId,
            tabId,
            params,
            log: (message, options = {}) => {
                logger.info(message, {
                    module: options.module || `Scenario:${scenarioDefinition.id}`,
                    contextId: instanceId,
                    ...options
                });
            },
            abortSignal: async () => {
                return new Promise((resolve, reject) => {
                    // 1. Проверка, не сработал ли сигнал уже
                    if (controller.signal.aborted) {
                        // Если сработал, немедленно ОТКЛОНЯЕМ промис
                        reject(new Error('Сценарий остановлен пользователем.'));
                        return;
                    }
                    // 2. Если сигнал еще не сработал, ставим слушатель
                    controller.signal.addEventListener('abort', () => {
                        // Когда controller.abort() будет вызван, ОТКЛАНИМ промис
                        reject(new Error('Сценарий остановлен пользователем.'));
                    }, { once: true });

                    // 3. !!!КЛЮЧЕВОЕ ИЗМЕНЕНИЕ!!!
                    // Если сигнал еще не сработал, это означает, что остановки нет.
                    // Следовательно, abortSignal должен УСПЕШНО ЗАВЕРШИТЬСЯ.
                    // Мы не ждем "реального" события abort, мы просто сообщаем,
                    // что на данный момент остановки нет.
                    resolve(); // <-- УСПЕШНО РАЗРЕШАЕМ промис
                });
            },
            // Передаем контроллер в контекст, чтобы получить к нему доступ в finally
            controller: controller
        };

        this.#runningScenarios.set(instanceId, { definition: scenarioDefinition, context, controller });

        // 👇 Уведомляем popup о начале сценария
        if (typeof chrome !== 'undefined' && chrome.runtime) {
            chrome.runtime.sendMessage({
                type: "scenarioStatus",
                status: "started",
                message: `[ScenarioEngine] Запуск сценария "${scenarioDefinition.name}" (ID: ${instanceId})`,
                level: "info"
            }).catch(err => {
                console.debug("Не удалось отправить сообщение о начале сценария в popup:", err);
            });
        }

        context.log(`[ScenarioEngine] Запуск сценария "${scenarioDefinition.name}" (ID: ${instanceId})`, { module: 'ScenarioEngine' });

        try {
            await scenarioDefinition.execute(context);
            context.log(`[ScenarioEngine] Сценарий "${scenarioDefinition.name}" успешно завершен.`, { module: 'ScenarioEngine' });
        } catch (error) {
            if (error.message === 'Сценарий остановлен пользователем.') {
                context.log(`[ScenarioEngine] Сценарий "${scenarioDefinition.name}" остановлен пользователем.`, { module: 'ScenarioEngine', level: 'warn' });
            } else {
                context.log(`[ScenarioEngine] Ошибка в сценарии "${scenarioDefinition.name}": ${error.message}`, { module: 'ScenarioEngine', level: 'error' });
                logger.error(`Ошибка в сценарии "${scenarioDefinition.name}": ${error.stack}`, { module: 'ScenarioEngine', contextId: instanceId });
            }
        } finally {
            this.#runningScenarios.delete(instanceId);

            // 👇 Уведомляем popup о завершении сценария
            // Теперь мы можем получить доступ к controller через context
            const isAborted = context.controller.signal.aborted;
            const finalStatus = isAborted ? "stopped" : "finished";
            const finalMessage = isAborted ?
                `[ScenarioEngine] Сценарий "${scenarioDefinition.name}" (ID: ${instanceId}) был остановлен.` :
                `[ScenarioEngine] Сценарий "${scenarioDefinition.name}" (ID: ${instanceId}) завершен.`;

            console.log(`[ScenarioEngine] Отправка финального статуса "${finalStatus}" для сценария ID: ${instanceId}`); // <-- Лог

            if (typeof chrome !== 'undefined' && chrome.runtime) {
                chrome.runtime.sendMessage({
                    type: "scenarioStatus",
                    status: finalStatus,
                    message: finalMessage,
                    level: "info"
                }).catch(err => {
                    console.debug("Не удалось отправить сообщение о завершении сценария в popup:", err);
                });
            }
            console.log(`[ScenarioEngine] Финальный статус "${finalStatus}" для сценария ID: ${instanceId} отправлен (или попытка отправки завершена).`); // <-- Лог
        }
        return instanceId;
    }

    /**
     * Останавливает запущенный сценарий.
     * @param {string} instanceId
     * @returns {boolean} true, если сценарий был найден и остановлен.
     */
    stop(instanceId) {
        const scenarioInstance = this.#runningScenarios.get(instanceId);
        if (scenarioInstance) {
            scenarioInstance.controller.abort();
            scenarioInstance.context.log(`[ScenarioEngine] Запрошена остановка сценария.`, { module: 'ScenarioEngine', level: 'warn' });
            return true;
        }
        logger.warn(`[ScenarioEngine] Попытка остановить несуществующий сценарий (ID: ${instanceId})`, { module: 'ScenarioEngine' });
        return false;
    }

    /**
     * Возвращает список запущенных сценариев.
     * @returns {Array<{id: string, name: string}>}
     */
    getRunningScenarios() {
        return Array.from(this.#runningScenarios.entries()).map(([id, { definition }]) => ({
            id,
            name: definition.name
        }));
    }

    /**
     * Генерирует уникальный ID для экземпляра сценария.
     * @returns {string}
     */
    #generateId() {
        return `scenario_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    }
}
