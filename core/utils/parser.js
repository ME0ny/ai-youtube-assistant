// core/utils/parser.js

/**
 * Отправляет команду в content script для парсинга всех видео на странице (без подсветки).
 * @param {Object} context - Контекст сценария (для tabId и логов).
 * @returns {Promise<{status: string, data?: any[], message?: string}>}
 */
export async function parseAllVideoCards(context) {
    const { log, tabId } = context;

    if (typeof tabId !== 'number' || tabId < 0) {
        const errorMsg = `Недействительный tabId для парсинга: ${tabId}`;
        log(`❌ ${errorMsg}`, { module: 'Parser', level: 'error' });
        throw new Error(errorMsg);
    }

    log(`🔍 Отправка запроса на парсинг всех видео на странице...`, { module: 'Parser' });

    try {
        const response = await chrome.tabs.sendMessage(tabId, {
            action: "parseAllVideoCards"
        });

        if (response && response.status === "success") {
            const count = response.data?.length || 0;
            log(`✅ Успешно спарсено ${count} видео.`, { module: 'Parser', level: 'success' });
            return { status: "success", data: response.data };
        } else {
            const errorMsg = response?.message || 'Неизвестная ошибка в content script';
            log(`❌ Ошибка от content script: ${errorMsg}`, { module: 'Parser', level: 'error' });
            throw new Error(errorMsg);
        }
    } catch (err) {
        const errorMsg = err.message || 'Ошибка связи с content script';
        log(`❌ Ошибка при отправке команды парсинга: ${errorMsg}`, { module: 'Parser', level: 'error' });
        throw err; // Пробрасываем для обработки выше
    }
}