// scenarios/ai-video-recommendation-scenario.js

import { logger } from '../background/background.js';
import { scrollPageNTimes } from '../core/utils/scroller.js';
import { parseAllVideoCards } from '../core/utils/parser.js';
import { formatVideoListForGPT, buildTop10ByTitlePrompt, parseGPTTop10Response } from '../core/utils/ai-utils.js';
import { askGPT } from '../ai/ai-service.js';
import { getProcessedTranscript } from '../ai/transcription-service.js';
import { evaluateVideo } from '../ai/gpt-evaluator.js';
import { getVideoClips, parseClips } from '../ai/clip-generator.js';

// --- Вспомогательная функция: MM:SS в секунды ---
function timeToSeconds(timeStr) {
    const [minutes, seconds] = timeStr.split(':').map(Number);
    return minutes * 60 + seconds;
}

export const aiVideoRecommendationScenario = {
    id: 'ai-video-recommendation',
    name: 'AI: Рекомендация видео по запросу',
    description: 'Полный сценарий: скролл -> парсинг -> GPT-топ10 -> транскрипция -> глубокая оценка -> нарезки -> визуализация.',
    async execute(context) {
        const { log, tabId, params, abortSignal } = context;
        const userQuery = params?.userQuery?.trim();

        if (!userQuery) {
            throw new Error("Пустой запрос пользователя в сценарии.");
        }

        log(`🚀 Старт сценария: ${this.name}`, { module: 'AIRecommendationScenario' });
        log(`📝 Запрос пользователя: "${userQuery}"`, { module: 'AIRecommendationScenario' });

        // --- ШАГ 1: Скролл страницы трижды ---
        log(`🔍 Шаг 1: Скролл страницы...`, { module: 'AIRecommendationScenario' });
        await scrollPageNTimes(context, 20, 1000, 1000);
        log(`✅ Шаг 1 завершён.`, { module: 'AIRecommendationScenario' });
        await abortSignal();

        // --- ШАГ 2: Спарсить все видео ---
        log(`🔍 Шаг 2: Парсинг видео...`, { module: 'AIRecommendationScenario' });
        const parseResponse = await parseAllVideoCards(context);
        if (parseResponse?.status !== 'success') {
            throw new Error(`Ошибка парсинга видео: ${parseResponse?.message || 'Неизвестная ошибка'}`);
        }
        const allVideos = parseResponse.data;
        log(`✅ Шаг 2 завершён. Найдено видео: ${allVideos.length}`, { module: 'AIRecommendationScenario' });
        await abortSignal();

        // --- ШАГ 3: GPT — получить топ-10 по названию ---
        log(`🔍 Шаг 3: GPT — получить топ-10 видео по названию...`, { module: 'AIRecommendationScenario' });
        const videoList = formatVideoListForGPT(allVideos);
        if (!videoList) {
            throw new Error("Нет подходящих видео для анализа (не найдены длительности).");
        }

        const prompt = buildTop10ByTitlePrompt(userQuery, videoList);
        const gptResponse = await askGPT(prompt);
        log(`📋 Ответ от GPT (сырой): ${gptResponse}`, { module: 'AIRecommendationScenario' });
        console.log("[AIRecommendationScenario] Ответ от GPT:", gptResponse);
        const top10Results = parseGPTTop10Response(gptResponse, allVideos);

        log(`✅ Шаг 3 завершён. Получено топ-10: ${top10Results.length}`, { module: 'AIRecommendationScenario' });
        await abortSignal();

        // --- ШАГ 4: Формирование транскрипции для топ-10 ---
        log(`🔍 Шаг 4: Формирование транскрипции для топ-10 видео...`, { module: 'AIRecommendationScenario' });
        const transcriptResults = [];
        for (const video of top10Results) {
            const { title, videoId } = video;
            log(`📝 Обработка транскрипции для: "${title}" (ID: ${videoId})`, { module: 'AIRecommendationScenario' });
            try {
                const chunks = await getProcessedTranscript(videoId);
                transcriptResults.push({ title, videoId, transcript: chunks.map((t, i) => ({ chunk: i + 1, chunk_text: t })) });
                log(`✅ Транскрипция для "${title}" готова (${chunks.length} чанков).`, { module: 'AIRecommendationScenario' });
            } catch (err) {
                log(`❌ Ошибка транскрипции для "${title}": ${err.message}`, { module: 'AIRecommendationScenario' });
            }
            await abortSignal();
        }
        log(`✅ Шаг 4 завершён. Обработано транскрипций: ${transcriptResults.length}`, { module: 'AIRecommendationScenario' });

        // --- ШАГ 5: GPT — глубокая оценка ---
        log(`🔍 Шаг 5: GPT — глубокая оценка видео...`, { module: 'AIRecommendationScenario' });
        const evalResults = [];
        for (const video of transcriptResults) {
            const { title, videoId, transcript } = video;
            log(`📝 Оценка видео: "${title}"`, { module: 'AIRecommendationScenario' });
            try {
                const firstChunk = transcript?.[0]?.chunk_text || '';
                const inputForGPT = {
                    title,
                    duration: '00:00', // Не используется, но передаём
                    initialScore: 8, // Условная оценка
                    transcript: [{ chunk: 1, chunk_text: firstChunk }]
                };
                const { revisedScore, summary } = await evaluateVideo(userQuery, inputForGPT);

                evalResults.push({
                    title,
                    videoId,
                    revisedScore,
                    summary
                });

                log(`✅ Видео "${title}" оценено: ${revisedScore}`, { module: 'AIRecommendationScenario' });
            } catch (err) {
                log(`❌ Ошибка оценки для "${title}": ${err.message}`, { module: 'AIRecommendationScenario' });
            }
            await abortSignal();
        }
        log(`✅ Шаг 5 завершён. Обработано оценок: ${evalResults.length}`, { module: 'AIRecommendationScenario' });

        // --- ШАГ 6: Формирование нарезок для топ-3 по оценке ---
        log(`🔍 Шаг 6: Формирование нарезок для топ-3 видео...`, { module: 'AIRecommendationScenario' });
        const top3Eval = [...evalResults].sort((a, b) => b.revisedScore - a.revisedScore).slice(0, 3);

        const clipResults = [];
        for (const video of top3Eval) {
            const { title, videoId, revisedScore } = video;
            log(`📝 Обработка нарезок для видео: "${title}" (ID: ${videoId})`, { module: 'AIRecommendationScenario' });

            // Найдём транскрипцию для этого видео
            const videoTranscript = transcriptResults.find(v => v.videoId === videoId);
            if (!videoTranscript) {
                log(`⚠️ Транскрипция не найдена для видео: ${videoId}`, { module: 'AIRecommendationScenario' });
                continue;
            }

            // Собираем текст из чанков 1, 3, 6 (0, 2, 5 в индексах)
            const chunksToUse = [0, 2, 5].map(i => videoTranscript.transcript[i]?.chunk_text).filter(Boolean);
            const fullTranscript = chunksToUse.join(' ');

            // Отправляем в GPT
            const gptClipResponse = await getVideoClips(userQuery, fullTranscript);
            console.log("gptClipResponse");
            // Парсим результат
            const clips = parseClips(gptClipResponse);

            clipResults.push({
                title,
                videoId,
                score: revisedScore,
                clips
            });

            log(`✅ Нарезки для "${title}" готовы (${clips.length} шт.).`, { module: 'AIRecommendationScenario' });
            await abortSignal();
        }
        log(`✅ Шаг 6 завершён. Сформировано нарезок: ${clipResults.length}`, { module: 'AIRecommendationScenario' });

        // --- ШАГ 7: Визуализация нарезок (сохранение результата для popup) ---
        log(`🔍 Шаг 7: Сохранение результатов для визуализации в popup...`, { module: 'AIRecommendationScenario' });

        // Сохраним результат в chrome.storage.local
        await chrome.storage.local.set({ 'aiScenarioResults': clipResults });

        // (Опционально) Отправим сообщение в popup, чтобы он обновил интерфейс
        // Это можно сделать через chrome.runtime.sendMessage, если popup открыт
        // или через обновление storage, которое popup может слушать
        log(`✅ Результаты сохранены в storage.`, { module: 'AIRecommendationScenario' });

        log(`🎉 Сценарий "${this.name}" завершён. Результаты готовы к визуализации.`, { module: 'AIRecommendationScenario' });
    }
};