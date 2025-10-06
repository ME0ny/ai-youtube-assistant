// background/background.js

// 1. Импортируем Logger и адаптер
import { Logger } from '../core/logger.js';
import { ChromeStorageLogAdapter } from '../adapters/ChromeStorageLogAdapter.js';
import { scrollPageNTimes } from '../core/utils/scroller.js';
import { parseAllVideoCards } from '../core/utils/parser.js';
import { askGPT } from '../ai/ai-service.js';
import { getProcessedTranscript } from '../ai/transcription-service.js';
import { formatVideoListForGPT, buildTop10ByTitlePrompt, parseGPTTop10Response } from '../core/utils/ai-utils.js';

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

    // background/background.js → внутри chrome.runtime.onMessage.addListener

    if (request.action === "runScrollStep") {
        (async () => {
            try {
                // --- 1. Получаем активную вкладку ---
                const activeTabs = await chrome.tabs.query({ active: true, currentWindow: true });
                if (activeTabs.length === 0) {
                    throw new Error("Нет активной вкладки. Откройте YouTube и попробуйте снова.");
                }
                const tab = activeTabs[0];
                const tabId = tab.id;

                // --- 2. Проверяем, что это YouTube ---
                if (!tab.url || !tab.url.includes('youtube.com')) {
                    throw new Error(`Активная вкладка не является YouTube: ${tab.url || 'URL недоступен'}`);
                }

                // --- 3. Проверяем, загружен ли content script ---
                try {
                    await chrome.tabs.sendMessage(tabId, { action: "ping" });
                } catch (pingErr) {
                    throw new Error("Content script не загружен. Обновите страницу YouTube.");
                }

                // --- 4. Создаём КОРРЕКТНЫЙ контекст с AbortController ---
                const controller = new AbortController();
                const tempContext = {
                    log: (msg, opts = {}) => logger.log(msg, opts.level || 'info', { module: 'ScrollStep', ...opts }),
                    tabId,
                    params: request.params || {},
                    // 👇 Правильная реализация abortSignal
                    abortSignal: async () => {
                        if (controller.signal.aborted) {
                            throw new Error('Сценарий остановлен пользователем.');
                        }
                        // Если не aborted — промис успешно завершается
                        return Promise.resolve();
                    },
                    // 👇 Передаём controller, чтобы можно было вызвать controller.abort()
                    controller
                };

                await scrollPageNTimes(
                    tempContext,
                    request.params.count || 5,
                    request.params.delayMs || 1000,
                    request.params.step || 1000
                );

                sendResponse({ status: "success" });
            } catch (err) {
                const errorMsg = err.message || 'Неизвестная ошибка';
                logger.error(`❌ Ошибка этапа скролла: ${errorMsg}`, { module: 'ScrollStep' });
                sendResponse({ status: "error", message: errorMsg });
            }
        })();
        return true;
    }

    if (request.action === "runParseVideosStep") {
        (async () => {
            try {
                // --- 1. Получаем активную вкладку ---
                const activeTabs = await chrome.tabs.query({ active: true, currentWindow: true });
                if (activeTabs.length === 0) {
                    throw new Error("Нет активной вкладки. Откройте YouTube и попробуйте снова.");
                }
                const tab = activeTabs[0];
                const tabId = tab.id;

                // --- 2. Проверяем, что это YouTube ---
                if (!tab.url || !tab.url.includes('youtube.com')) {
                    throw new Error(`Активная вкладка не является YouTube: ${tab.url || 'URL недоступен'}`);
                }

                // --- 3. Создаём контекст ---
                const tempContext = {
                    log: (msg, opts = {}) => logger.log(msg, opts.level || 'info', { module: 'ParseVideosStep', ...opts }),
                    tabId,
                    params: request.params || {},
                    abortSignal: async () => { },
                    controller: { signal: { aborted: false } }
                };

                // --- 4. Вызываем парсер через уже импортированную функцию ---
                const response = await parseAllVideoCards(tempContext);

                if (response?.status === 'success') {
                    sendResponse({ status: "success", data: response.data });
                } else {
                    throw new Error(response?.message || 'Неизвестная ошибка в parseAllVideoCards');
                }
            } catch (err) {
                const errorMsg = err.message || 'Неизвестная ошибка';
                logger.error(`❌ Ошибка этапа парсинга видео: ${errorMsg}`, { module: 'ParseVideosStep' });
                sendResponse({ status: "error", message: errorMsg });
            }
        })();
        return true;
    }

    if (request.action === "runGPTGetTop10ByTitleStep") { // 👈 Изменено имя
        (async () => {
            try {
                const userQuery = request.params?.userQuery?.trim();
                if (!userQuery) {
                    throw new Error("Пустой запрос пользователя.");
                }

                // --- 1. Получаем активную вкладку ---
                const activeTabs = await chrome.tabs.query({ active: true, currentWindow: true });
                if (activeTabs.length === 0) {
                    throw new Error("Нет активной вкладки. Откройте YouTube и попробуйте снова.");
                }
                const tab = activeTabs[0];
                const tabId = tab.id;

                // --- 2. Проверяем, что это YouTube ---
                if (!tab.url || !tab.url.includes('youtube.com')) {
                    throw new Error(`Активная вкладка не является YouTube: ${tab.url || 'URL недоступен'}`);
                }

                // --- 3. Создаём контекст ---
                const tempContext = {
                    log: (msg, opts = {}) => logger.log(msg, opts.level || 'info', { module: 'GPTGetTop10ByTitleStep', ...opts }),
                    tabId,
                    params: request.params || {},
                    abortSignal: async () => { },
                    controller: { signal: { aborted: false } }
                };

                // --- 4. Вызываем парсер напрямую ---
                const parseResponse = await parseAllVideoCards(tempContext);

                if (parseResponse?.status !== 'success') {
                    throw new Error(`Ошибка парсинга видео: ${parseResponse?.message || 'Неизвестная ошибка'}`);
                }

                const videos = parseResponse.data;

                // --- 5. Формируем список "Название;Длительность" через утилиту ---
                const videoList = formatVideoListForGPT(videos);

                if (!videoList) {
                    throw new Error("Нет подходящих видео для анализа (не найдены длительности).");
                }

                // --- 6. Формируем промпт через утилиту ---
                const prompt = buildTop10ByTitlePrompt(userQuery, videoList);

                // --- 7. Отправляем в API через ai-service ---
                const gptResponse = await askGPT(prompt);

                // --- 8. Обрабатываем ответ от GPT ---
                const top10Results = parseGPTTop10Response(gptResponse, videos);

                logger.info(`✅ Топ-10 видео от GPT:`, { module: 'GPTGetTop10ByTitleStep', data: top10Results });

                sendResponse({ status: "success", data: top10Results });
            } catch (err) {
                const errorMsg = err.message || 'Неизвестная ошибка';
                logger.error(`❌ Ошибка этапа получения топ-10 по названию: ${errorMsg}`, { module: 'GPTGetTop10ByTitleStep' });
                sendResponse({ status: "error", message: errorMsg });
            }
        })();
        return true;
    }

    if (request.action === "runTranscriptionStep") {
        (async () => {
            try {
                const top10Json = request.params?.top10Json?.trim();
                if (!top10Json) {
                    throw new Error("Пустой JSON с топ-10 видео.");
                }

                let top10Data;
                try {
                    top10Data = JSON.parse(top10Json);
                } catch (e) {
                    throw new Error("Неверный формат JSON с топ-10 видео.");
                }

                if (!Array.isArray(top10Data)) {
                    throw new Error("JSON должен содержать массив объектов с видео.");
                }

                logger.info(`🎬 Начинаем обработку транскрипций для ${top10Data.length} видео...`, { module: 'TranscriptionStep' });

                const results = [];

                for (const video of top10Data) {
                    const { title, videoId } = video;
                    if (!title || !videoId) {
                        logger.warn(`⚠️ Пропущено видео без названия или ID: ${JSON.stringify(video)}`, { module: 'TranscriptionStep' });
                        continue;
                    }

                    logger.info(`📝 Обработка транскрипции для: "${title}" (ID: ${videoId})`, { module: 'TranscriptionStep' });

                    try {
                        const chunks = await getProcessedTranscript(videoId);
                        results.push({ title, chunks });
                        logger.success(`✅ Транскрипция для "${title}" готова (${chunks.length} чанков).`, { module: 'TranscriptionStep' });
                    } catch (err) {
                        logger.error(`❌ Ошибка транскрипции для "${title}": ${err.message}`, { module: 'TranscriptionStep' });
                    }
                }

                logger.success(`🎉 Обработка транскрипций завершена.`, { module: 'TranscriptionStep' });

                sendResponse({ status: "success", results });
            } catch (err) {
                const errorMsg = err.message || 'Неизвестная ошибка';
                logger.error(`❌ Ошибка этапа транскрипции: ${errorMsg}`, { module: 'TranscriptionStep' });
                sendResponse({ status: "error", message: errorMsg });
            }
        })();
        return true;
    }

    // Другие обработчики можно добавлять сюда по мере разработки
});