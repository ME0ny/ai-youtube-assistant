// background/background.js

// 1. Импортируем Logger и адаптер
import { Logger } from '../core/logger.js';
import { ChromeStorageLogAdapter } from '../adapters/ChromeStorageLogAdapter.js';

// 2. Создаём глобальный экземпляр логгера
export const logger = new Logger({
    maxSize: 1000,
    enableConsole: true,
    defaultLevel: 'info'
});

// 3. (Опционально) Добавляем дополнительные адаптеры — например, ConsoleLogAdapter
// import { ConsoleLogAdapter } from '../adapters/ConsoleLogAdapter.js';
// logger.addAdapter(new ConsoleLogAdapter());

// 4. Логируем факт запуска background
logger.info("🚀 Background service worker запущен.", { module: 'Background' });

// 5. Слушаем сообщения от popup и content
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    // Обработка логов из content-скрипта (если понадобится)
    if (request.type === "contentLog") {
        logger.log(
            request.message,
            request.level || 'info',
            {
                module: request.module || 'ContentScript',
            }
        );
        return false;
    }

    // Обработка команды очистки лога
    if (request.action === "clearLog") {
        logger.clear().then(() => {
            sendResponse({ status: "success" });
        });
        return true;
    }

    // Другие обработчики можно добавлять сюда по мере разработки
});