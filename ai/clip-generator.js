// ai/clip-generator.js

import { askGPT } from './ai-service.js';

/**
 * Отправляет промпт в GPT для поиска нарезок.
 * @param {string} userQuery - Запрос пользователя.
 * @param {string} fullTranscript - Полный текст транскрипции.
 * @returns {Promise<string>} Ответ GPT.
 */
export async function getVideoClips(userQuery, fullTranscript) {
    const prompt = `You are a skilled video content curator tasked with identifying the three most compelling short segments (each up to 2 minutes long) from a single YouTube video that best justify why this video is worth watching. These segments should function like engaging Shorts, Reels, or TikToks—self-contained, captivating, and clearly understandable on their own. Each segment must have a natural beginning and end, and fall into one of these categories: (1) a clear answer to an interesting or surprising question, (2) a concise personal or illustrative story, or (3) a focused, dynamic debate or exchange of contrasting viewpoints.  

Use the user’s original query to understand their intent and interests, then analyze the full transcript to locate the most relevant, high-impact moments that align with that intent. For each of the three selected segments, provide only the start time (in MM:SS format), end time (in MM:SS format), and a short, catchy title in Russian that captures the essence of the fragment. Do not include any additional explanation, commentary, or formatting—just the three entries, each on a new line, in the exact format:  
Start: MM:SS – End: MM:SS | Заголовок на русском  

Here is the input you will receive:  
[User Query]: ${userQuery}
[Full Transcript]: ${fullTranscript}
Return only the three formatted lines—nothing else.`;
    const response = await askGPT(prompt);
    console.log(`[ClipGenerator] 📥 Ответ от GPT (сырой):`, response);
    return response;
}

/**
 * Парсит результат GPT в массив объектов.
 * Поддерживает форматы MM:SS и HH:MM:SS.
 * @param {string} gptResponse - Ответ GPT.
 * @returns {Array<{ start: string, end: string, title: string }>}
 */
export function parseClips(gptResponse) {
    console.log(`[ClipGenerator] 🧹 Начинаем парсинг ответа GPT...`);
    const lines = gptResponse.split('\n').filter(l => l.trim() !== '');
    console.log(`[ClipGenerator] 📄 Строки для парсинга:`, lines);

    const clips = [];
    // Регулярное выражение, поддерживающее MM:SS и HH:MM:SS
    const timePattern = /(\d{1,2}:\d{2}(?::\d{2})?)/; // например: 5:30, 05:30, 00:05:30
    const fullPattern = new RegExp(
        `^\\s*Start:\\s*${timePattern.source}\\s*–\\s*End:\\s*${timePattern.source}\\s*\\|\\s*(.+?)\\s*$`,
        'i'
    );

    for (const line of lines) {
        const match = line.match(fullPattern);
        if (match) {
            const start = normalizeTime(match[1]); // match[1] = start
            const end = normalizeTime(match[2]);   // match[2] = end
            const title = match[3].trim();         // match[3] = title
            clips.push({ start, end, title });
            console.log(`[ClipGenerator] ✅ Распознана нарезка: ${start} – ${end} | ${title}`);
        } else {
            console.warn(`[ClipGenerator] ❌ Строка не распознана: "${line}"`);
        }
    }

    console.log(`[ClipGenerator] 🎯 Итого распознано нарезок: ${clips.length}`);
    return clips;
}

/**
 * Преобразует время в формат MM:SS (удаляет часы, если они 00).
 * @param {string} timeStr - Время в формате HH:MM:SS или MM:SS
 * @returns {string} Время в формате MM:SS
 */
function normalizeTime(timeStr) {
    const parts = timeStr.split(':').map(Number);
    if (parts.length === 3) {
        // HH:MM:SS → игнорируем часы, если они 0
        const [h, m, s] = parts;
        if (h === 0) {
            return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
        } else {
            // Если часы ≠ 0 — оставляем как есть, но YouTube принимает только до 59:59
            // Можно обрезать или оставить как есть (но iframe не поддерживает > 1 часа в тайминге?)
            // Для безопасности — конвертируем в секунды позже при вставке в iframe
            return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
        }
    } else if (parts.length === 2) {
        const [m, s] = parts;
        return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
    }
    // fallback
    return timeStr;
}