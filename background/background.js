// background/background.js

// 1. Импортируем Logger и адаптер
import { Logger } from '../core/logger.js';
import { ChromeStorageLogAdapter } from '../adapters/ChromeStorageLogAdapter.js';
import { scrollPageNTimes } from '../core/utils/scroller.js';
import { parseAllVideoCards } from '../core/utils/parser.js';
import { askGPT } from '../ai/ai-service.js';
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

    if (request.action === "runGPTAnalyzeStep") {
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
                    log: (msg, opts = {}) => logger.log(msg, opts.level || 'info', { module: 'GPTAnalyzeStep', ...opts }),
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

                // --- 5. Формируем список "Название;Длительность" ---
                const videoList = videos
                    .filter(v => v.title && v.duration && v.duration !== '—')
                    .map(v => `${v.title};${v.duration}`)
                    .join('\n');

                if (!videoList) {
                    throw new Error("Нет подходящих видео для анализа (не найдены длительности).");
                }
                console.log(videoList);
                console.log(userQuery);
                // --- 6. Формируем промпт ---
                const prompt = `you are a precise video-matching assistant. Your input consists of two parts: (1) a user request and (2) a list of available videos in CSV format "Video Title;Duration", where Duration is in HH:MM:SS. First, analyze the user request to determine the topic/intent (e.g., relaxing content, tech news, aviation) and check if the user mentions available viewing time (e.g., "I have 1 hour"). If time is specified, convert it to total seconds and exclude any video whose duration exceeds that time (allow ±2 minutes tolerance). If no time is mentioned, do not filter by duration. For each remaining video, assess how well its title matches the user's topic/intent and assign a relevance score from 0.0 (completely unrelated) to 1.0 (perfect match), based only on the title—do not assume content beyond what the title states. Only include videos with relevance score ≥ 0.4. If no videos meet both relevance and duration criteria, output exactly: No such videos available. Otherwise, output a markdown table with two columns: "Video Title" (exact title from input) and "Relevance Score" (rounded to two decimal places). Do not include durations in the output, and do not add any extra text, explanations, or formatting beyond the table. Use this exact format: Video Title;Relevance Score
Выводи не более 10 названий, они должны быть отсортированы по relevance score по убыванию
User request: ${userQuery}
Available videos: ${videoList}`;

                // --- 7. Отправляем в API через ai-service ---
                const gptResult = await askGPT(prompt);

                logger.info(`✅ Ответ от GPT: ${gptResult}`, { module: 'GPTAnalyzeStep' });

                sendResponse({ status: "success", result: gptResult });
            } catch (err) {
                const errorMsg = err.message || 'Неизвестная ошибка';
                logger.error(`❌ Ошибка этапа GPT-анализа: ${errorMsg}`, { module: 'GPTAnalyzeStep' });
                sendResponse({ status: "error", message: errorMsg });
            }
        })();
        return true;
    }

    // Другие обработчики можно добавлять сюда по мере разработки
});