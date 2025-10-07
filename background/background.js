// background/background.js

// 1. Импортируем Logger и адаптер
import { Logger } from '../core/logger.js';
import { ChromeStorageLogAdapter } from '../adapters/ChromeStorageLogAdapter.js';
import { ScenarioEngine } from '../core/scenario-engine.js';

import { scrollPageNTimes } from '../core/utils/scroller.js';
import { parseAllVideoCards } from '../core/utils/parser.js';
import { askGPT } from '../ai/ai-service.js';
import { getProcessedTranscript } from '../ai/transcription-service.js';
import { formatVideoListForGPT, buildTop10ByTitlePrompt, parseGPTTop10Response } from '../core/utils/ai-utils.js';
import { evaluateVideo } from '../ai/gpt-evaluator.js';
import { getVideoClips, parseClips } from '../ai/clip-generator.js';
import { aiVideoRecommendationScenario } from '../scenarios/ai-video-recommendation-scenario.js';

// 2. Создаём глобальный экземпляр логгера
export const logger = new Logger({
    maxSize: 1000,
    enableConsole: true,
    defaultLevel: 'info'
});

// 3. Создание экземпляра движка сценариев
export const scenarioEngine = new ScenarioEngine();

scenarioEngine.registerScenario(aiVideoRecommendationScenario);
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

    if (request.action === "runGPTDeepEvalStep") {
        (async () => {
            try {
                const userQuery = request.params?.userQuery?.trim();
                if (!userQuery) {
                    throw new Error("Пустой запрос пользователя.");
                }

                const videoJson = request.params?.videoJson?.trim();
                if (!videoJson) {
                    throw new Error("Пустой JSON с видео и транскрипцией.");
                }

                let videoData;
                try {
                    videoData = JSON.parse(videoJson);
                } catch (e) {
                    logger.error(`❌ Ошибка парсинга JSON: ${e.message}`, { module: 'GPTDeepEvalStep' });
                    logger.error(`📋 Введённый JSON: ${videoJson.substring(0, 200)}...`, { module: 'GPTDeepEvalStep' }); // Показываем начало
                    throw new Error(`Неверный формат JSON: ${e.message}`);
                }

                if (!Array.isArray(videoData)) {
                    throw new Error("JSON должен содержать массив объектов с видео.");
                }

                // Проверим, что каждый элемент массива имеет нужные поля
                for (let i = 0; i < videoData.length; i++) {
                    const video = videoData[i];
                    if (!video.title || !video.duration || video.initialScore == null || !video.videoId || !Array.isArray(video.transcript)) {
                        logger.error(`❌ Неверная структура видео в элементе ${i}: ${JSON.stringify(video)}`, { module: 'GPTDeepEvalStep' });
                        throw new Error(`Видео ${i + 1} имеет неверную структуру: отсутствуют необходимые поля.`);
                    }
                }

                logger.info(`🔍 Начинаем глубокую оценку ${videoData.length} видео...`, { module: 'GPTDeepEvalStep' });

                const results = [];

                for (const video of videoData) {
                    const { title, duration, initialScore, transcript, videoId } = video;
                    logger.info(`📝 Оценка видео: "${title}"`, { module: 'GPTDeepEvalStep' });

                    try {
                        const { revisedScore, summary } = await evaluateVideo(userQuery, video);

                        results.push({
                            title,
                            videoId,
                            revisedScore,
                            summary
                        });

                        logger.success(`✅ Видео "${title}" оценено: ${revisedScore}`, { module: 'GPTDeepEvalStep' });
                    } catch (err) {
                        logger.error(`❌ Ошибка оценки для "${title}": ${err.message}`, { module: 'GPTDeepEvalStep' });
                    }
                }

                logger.success(`🎉 Глубокая оценка завершена.`, { module: 'GPTDeepEvalStep' });

                sendResponse({ status: "success", results });
            } catch (err) {
                const errorMsg = err.message || 'Неизвестная ошибка';
                logger.error(`❌ Ошибка этапа глубокой оценки: ${errorMsg}`, { module: 'GPTDeepEvalStep' });
                sendResponse({ status: "error", message: errorMsg });
            }
        })();
        return true;
    }

    if (request.action === "runClipGenerationStep") {
        (async () => {
            try {
                const { userQuery, transcriptJson, deepEvalJson } = request.params;

                if (!userQuery) {
                    throw new Error("Пустой запрос пользователя.");
                }
                if (!transcriptJson) {
                    throw new Error("Пустой JSON с транскрипцией.");
                }
                if (!deepEvalJson) {
                    throw new Error("Пустой JSON с глубокой оценкой.");
                }

                let transcriptData, deepEvalData;
                try {
                    transcriptData = JSON.parse(transcriptJson);
                    deepEvalData = JSON.parse(deepEvalJson);
                } catch (e) {
                    throw new Error("Неверный формат JSON.");
                }

                if (!Array.isArray(transcriptData) || !Array.isArray(deepEvalData)) {
                    throw new Error("JSON должен содержать массивы.");
                }

                logger.info(`📋 Всего видео с транскрипцией: ${transcriptData.length}`, { module: 'ClipGenerationStep' });
                logger.info(`📋 Всего видео с глубокой оценкой: ${deepEvalData.length}`, { module: 'ClipGenerationStep' });

                // --- Выводим videoID из транскрипции ---
                const transcriptVideoIds = transcriptData.map(v => v.videoId);
                logger.info(`📋 videoID из транскрипции: ${transcriptVideoIds.join(', ')}`, { module: 'ClipGenerationStep' });

                // --- Выводим videoID из глубокой оценки ---
                const deepEvalVideoIds = deepEvalData.map(v => v[1]);
                logger.info(`📋 videoID из глубокой оценки: ${deepEvalVideoIds.join(', ')}`, { module: 'ClipGenerationStep' });

                // --- ПРАВИЛЬНАЯ ЛОГИКА: берём топ-3 из deepEvalJson ---
                const top3 = [...deepEvalData]
                    .sort((a, b) => b[2] - a[2]) // по третьему элементу (оценке)
                    .slice(0, 3);

                if (top3.length === 0) {
                    throw new Error("Нет видео с оценкой для нарезки.");
                }

                logger.info(`🎬 Начинаем формирование нарезок для ${top3.length} видео...`, { module: 'ClipGenerationStep' });

                const results = [];

                for (const [title, videoId, score] of top3) {
                    logger.info(`🔍 Ищем транскрипцию для видео: ${videoId}`, { module: 'ClipGenerationStep' });

                    // --- ИЩЕМ транскрипцию в transcriptData ---
                    const videoTranscript = transcriptData.find(v => v.videoId === videoId);

                    if (!videoTranscript) {
                        logger.warn(`⚠️ Транскрипция не найдена для видео: ${videoId}`, { module: 'ClipGenerationStep' });
                        continue;
                    }

                    logger.success(`✅ Транскрипция найдена для видео: ${videoId}`, { module: 'ClipGenerationStep' });

                    // Собираем текст из чанков 1, 3, 6 (0, 2, 5 в индексах)
                    const chunksToUse = [0, 2, 5].map(i => videoTranscript.transcript[i]?.chunk_text).filter(Boolean);
                    const fullTranscript = chunksToUse.join(' ');

                    logger.info(`📝 Обработка нарезок для видео: "${title}" (ID: ${videoId})`, { module: 'ClipGenerationStep' });

                    // Отправляем в GPT
                    const gptResponse = await getVideoClips(userQuery, fullTranscript);

                    // Парсим результат
                    const clips = parseClips(gptResponse);

                    results.push({
                        title,
                        videoId,
                        score,
                        clips
                    });

                    logger.success(`✅ Нарезки для "${title}" готовы (${clips.length} шт.).`, { module: 'ClipGenerationStep' });
                }

                logger.success(`🎉 Формирование нарезок завершено.`, { module: 'ClipGenerationStep' });

                sendResponse({ status: "success", results });
            } catch (err) {
                const errorMsg = err.message || 'Неизвестная ошибка';
                logger.error(`❌ Ошибка этапа формирования нарезок: ${errorMsg}`, { module: 'ClipGenerationStep' });
                sendResponse({ status: "error", message: errorMsg });
            }
        })();
        return true;
    }

    if (request.action === "runScenario") {
        (async () => {
            // --- ✅ ИЗВЛЕКАЕМ scenarioId ИЗ request ---
            const { scenarioId, params = {} } = request;

            logger.info(`📥 Получена команда на запуск сценария "${scenarioId}"`, { module: 'Background', meta: params });

            // --- ✅ ОПРЕДЕЛЯЕМ, КАКОЙ СЦЕНАРИЙ ЗАПУСКАТЬ ---
            let scenarioToRun;
            if (scenarioId === 'ai-video-recommendation') { // ✅ Теперь scenarioId определена
                scenarioToRun = aiVideoRecommendationScenario;
            } else {
                throw new Error(`Неизвестный ID сценария: ${scenarioId}`); // ✅ Теперь scenarioId определена
            }

            // --- ✅ ПОЛУЧАЕМ tabId ---
            let activeTabId = null;
            logger.debug("Попытка получить активную вкладку...", { module: 'Background' });
            try {
                // Попытка 1: Получить активную вкладку в текущем окне
                const activeTabsCurrentWindow = await chrome.tabs.query({ active: true, currentWindow: true });
                logger.debug(`Результат query({active: true, currentWindow: true}):`, activeTabsCurrentWindow, { module: 'Background' });
                if (activeTabsCurrentWindow.length > 0) {
                    activeTabId = activeTabsCurrentWindow[0].id;
                }
            } catch (queryErr1) {
                logger.warn(`Ошибка при попытке 1 получения активной вкладки: ${queryErr1.message}`, { module: 'Background' });
                // Попытка 2: Получить активную вкладку в любом окне
                try {
                    const activeTabsAnyWindow = await chrome.tabs.query({ active: true });
                    if (activeTabsAnyWindow.length > 0) {
                        activeTabId = activeTabsAnyWindow[0].id;
                    }
                } catch (queryErr2) {
                    logger.warn(`Ошибка при попытке 2 получения активной вкладки: ${queryErr2.message}`, { module: 'Background' });
                }
            }

            // Если все еще null, логируем предупреждение, но продолжаем (сценарий может сам решить, что делать)
            if (activeTabId === null) {
                logger.warn("❌ Не удалось получить активную вкладку. tabId будет null. Сценарий может не работать с контентом страницы.", { module: 'Background' });
            } else {
                logger.info(`✅ Активная вкладка определена: ID=${activeTabId}`, { module: 'Background' });
            }

            // --- ✅ ЗАПУСКАЕМ СЦЕНАРИЙ ---
            // Передаем параметры и tabId в сценарий через context.params и context.tabId
            const instanceId = await scenarioEngine.run(scenarioToRun, params, activeTabId);

            logger.info(`🏁 Сценарий "${scenarioId}" запущен с ID: ${instanceId}`, { module: 'Background' });
            sendResponse({ status: "started", instanceId: instanceId });

        })(); // Конец async функции
        return true; // keep channel open for async response
    }
    // Другие обработчики можно добавлять сюда по мере разработки
});