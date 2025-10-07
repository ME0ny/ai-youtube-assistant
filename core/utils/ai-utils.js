// core/utils/ai-utils.js

import { askGPT } from '../../ai/ai-service.js';

/**
 * Формирует список "Название;Длительность" из массива видео.
 * @param {Array} videos - Массив видео из парсера.
 * @returns {string} Строка в формате "Название;Длительность", разделённая новой строкой.
 */
export function formatVideoListForGPT(videos) {
    return videos
        .filter(v => v.title && v.duration && v.duration !== '—')
        .map(v => `${v.title};${v.duration}`)
        .join('\n');
}

/**
 * Формирует промпт для GPT, чтобы получить топ-10 видео по названию.
 * @param {string} userQuery - Запрос пользователя.
 * @param {string} videoList - Список видео в формате "Название;Длительность".
 * @returns {string} Промпт для GPT.
 */
export function buildTop10ByTitlePrompt(userQuery, videoList) {
    return `you are a precise video-matching assistant. Your input consists of two parts: (1) a user request and (2) a list of available videos in CSV format "Video Title;Duration", where Duration is in HH:MM:SS. First, analyze the user request to determine the topic/intent (e.g., relaxing content, tech news, aviation) and check if the user mentions available viewing time (e.g., "I have 1 hour"). If time is specified, convert it to total seconds and exclude any video whose duration exceeds that time (allow ±2 minutes tolerance). If no time is mentioned, do not filter by duration. For each remaining video, assess how well its title matches the user's topic/intent and assign a relevance score from 0.0 (completely unrelated) to 1.0 (perfect match), based only on the title—do not assume content beyond what the title states. Only include videos with relevance score ≥ 0.4. If no videos meet both relevance and duration criteria, output exactly: No such videos available. Otherwise, output a markdown table with two columns: "Video Title" (exact title from input) and "Relevance Score" (rounded to two decimal places). Do not include durations in the output, and do not add any extra text, explanations, or formatting beyond the table. Use this exact format: Video Title;Relevance Score. Другой формат запрещен.
Выводи не более 10 названий, они должны быть отсортированы по relevance score по убыванию
User request: ${userQuery}
Available videos: ${videoList}`;
}

/**
 * Обрабатывает ответ от GPT и возвращает массив { title, videoId, relevanceScore10 }.
 * @param {string} gptResponse - Ответ от GPT API.
 * @param {Array} originalVideos - Оригинальный массив видео для поиска videoId по названию.
 * @returns {Array<{ title: string, videoId: string, relevanceScore10: number }>} Результат.
 */
export function parseGPTTop10Response(gptResponse, originalVideos) {
    // Пример: "Video Title;Relevance Score\nTitle A;0.80\nTitle B;0.75"
    const lines = gptResponse.split('\n');
    const results = [];

    for (const line of lines) {
        if (!line.includes(';')) continue;

        const [title, scoreStr] = line.split(';');
        const score = parseFloat(scoreStr);

        if (isNaN(score)) continue;

        // Находим videoId по названию
        const matchedVideo = originalVideos.find(v => v.title === title.trim());
        const videoId = matchedVideo ? matchedVideo.videoId : 'ID_NOT_FOUND';

        results.push({
            title: title.trim(),
            videoId,
            relevanceScore10: Math.round(score * 10) // Умножаем на 10 и округляем
        });
    }

    return results;
}