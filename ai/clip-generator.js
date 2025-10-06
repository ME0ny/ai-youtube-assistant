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

    return await askGPT(prompt);
}

/**
 * Парсит результат GPT в массив объектов.
 * @param {string} gptResponse - Ответ GPT.
 * @returns {Array<{ start: string, end: string, title: string }>}
 */
export function parseClips(gptResponse) {
    const lines = gptResponse.split('\n').filter(l => l.trim() !== '');
    const clips = [];

    for (const line of lines) {
        const match = line.match(/Start: (\d+:\d+) – End: (\d+:\d+) \| (.+)/);
        if (match) {
            const [, start, end, title] = match;
            clips.push({ start, end, title });
        }
    }

    return clips;
}