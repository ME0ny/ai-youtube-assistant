// ai/gpt-evaluator.js

import { askGPT } from './ai-service.js';

/**
 * Отправляет видео в GPT для глубокой оценки.
 * @param {string} userQuery - Запрос пользователя.
 * @param {object} video - Объект видео { title, duration, initialScore, transcript }.
 * @returns {Promise<{ revisedScore: number, summary: string }>} Результат.
 */
export async function evaluateVideo(userQuery, video) {
    // Берём только первый чанк транскрипции
    const firstChunk = video.transcript?.[0]?.chunk_text || '';

    const prompt = `You are an expert video analyst helping to refine video recommendations for a personalized YouTube viewing assistant. Your task is to evaluate a single video based on the user's original search intent, the video's title, duration, initial algorithmic score (from 1 to 10), and the first ~3,000 tokens of its transcript.

First, carefully consider the user's query to understand their current mood, interests, or viewing goals. Then, analyze the provided transcript excerpt to assess how well the video aligns with that intent—looking at relevance, depth of content, engagement, clarity, and overall value. Based on this analysis, adjust the initial algorithmic score upward or downward (still on a 1–10 scale), providing a revised score that reflects both the original rating and your qualitative assessment.

If the revised score is 7 or higher, also generate a detailed, objective summary (3–5 sentences) describing what the video is actually about, based solely on the transcript. Focus on key topics, tone, structure, and any unique insights or value it offers. This summary will later be used to create a concise user-facing description. Summary on russian language

Do not compare this video to others—evaluate it in isolation. Do not mention the user’s query in the summary; keep the summary factual and content-focused.

Here is the input format you will receive for each video:
[User Query]:${userQuery}
[Video Title]: ${video.title}
[Duration]: ${video.duration}
[Initial Score]: ${video.initialScore}
[Transcript Excerpt]: ${firstChunk}

Respond strictly in the following format:
Revised Score: {revised_score}
Summary: {detailed_summary_if_score_7_or_higher, otherwise_write_"N/A"}
`;

    const response = await askGPT(prompt);

    // Парсим ответ
    const lines = response.split('\n');
    let revisedScore = 0;
    let summary = 'N/A';

    for (const line of lines) {
        if (line.startsWith('Revised Score:')) {
            const num = parseFloat(line.replace('Revised Score:', '').trim());
            revisedScore = isNaN(num) ? 0 : num;
        }
        if (line.startsWith('Summary:')) {
            summary = line.replace('Summary:', '').trim();
        }
    }

    return { revisedScore, summary };
}