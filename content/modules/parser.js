// content/modules/parser.js

/**
 * Парсит все карточки видео на текущей странице YouTube (без Shorts, стримов, плейлистов).
 * @returns {Array<Object>} Массив объектов с данными видео.
 */
function parseAllVideoCards() {
    const allCards = document.querySelectorAll('ytd-rich-item-renderer, ytd-video-renderer, .yt-lockup-view-model');
    const seenVideoIds = new Set();
    const videoData = [];

    for (const card of allCards) {
        // --- Исключаем Shorts, LIVE, Reels ---
        if (
            card.querySelector('[href*="/shorts/"]') ||
            card.querySelector('[aria-label*="Shorts" i]') ||
            card.querySelector('[aria-label*="LIVE" i]') ||
            card.closest('[is-shorts]') ||
            card.classList.contains('ytd-reel-item-renderer')
        ) {
            continue;
        }

        // --- Ссылка на видео ---
        const videoLink = card.querySelector('a[href*="/watch?v="]');
        if (!videoLink) continue;

        try {
            const url = new URL(videoLink.href, 'https://www.youtube.com');
            const videoId = url.searchParams.get('v');
            if (!videoId || seenVideoIds.has(videoId)) continue;
            seenVideoIds.add(videoId);

            // --- Название ---
            const titleEl = card.querySelector('h3 a span, #video-title, .yt-lockup-metadata-view-model__title');
            const title = titleEl ? titleEl.textContent?.trim() || '—' : '—';

            // --- Длительность ---
            const durationEl = card.querySelector('.ytd-thumbnail-overlay-time-status-renderer .style-scope, .yt-badge-shape__text');
            const duration = durationEl ? durationEl.textContent?.trim() || '—' : '—';

            // --- Миниатюра ---
            const imgEl = card.querySelector('img[src*="i.ytimg.com/vi/"]');
            const thumbnailUrl = imgEl ? imgEl.src.split('?')[0] : '';

            // --- Канал и ID канала ---
            let channelName = '—';
            let channelId = '';
            const channelLink = card.querySelector('a[href^="/@"], a[href^="/channel/"], a[href^="/c/"], .yt-lockup-byline a');
            if (channelLink) {
                channelName = channelLink.textContent?.trim() || '—';
                const href = channelLink.getAttribute('href');
                if (href) {
                    if (href.startsWith('/@')) {
                        // Например, /@PodcastBar
                        channelId = href.substring(2);
                    } else if (href.startsWith('/channel/')) {
                        // Например, /channel/UCxxx
                        channelId = href.substring(9);
                    } else if (href.startsWith('/c/')) {
                        // Например, /c/ChannelName
                        channelId = href.substring(3);
                    }
                }
            }

            // --- Просмотры и дата публикации ---
            let views = '—';
            let published = '—';

            // Ищем метаданные: обычно это строка вида "155K views • 11 months ago"
            const metadataElements = card.querySelectorAll('.yt-content-metadata-view-model__metadata-row, #metadata-line span');
            if (metadataElements.length >= 2) {
                const metadataTexts = Array.from(metadataElements)
                    .map(el => el.textContent?.trim())
                    .filter(t => t && t !== '•');

                // Объединяем все строки и разбиваем по "•"
                const combinedText = metadataTexts.join(' • ');
                const parts = combinedText.split(' • ').map(p => p.trim());

                // Ищем "views" и "published" по шаблону: "155K views • 11 months ago"
                // Или "11 months ago • 155K views" — может меняться порядок
                for (const part of parts) {
                    if (part.includes('view') || part.includes('watched')) {
                        views = part;
                    } else if (part.includes('ago') || part.includes('premiered') || part.includes('streamed')) {
                        published = part;
                    }
                }
            }

            videoData.push({
                thumbnailUrl,
                title,
                duration,
                channelName,
                views,
                published,
                videoId,
                channelId
            });
        } catch (e) {
            console.warn("[Parser] Ошибка парсинга карточки:", e);
            continue;
        }
    }

    console.log(`[Parser] Успешно спарсено ${videoData.length} видео.`);
    return videoData;
}

// Экспортируем в глобальную область
window.ytParser = window.ytParser || {};
window.ytParser.parseAllVideoCards = parseAllVideoCards;

console.log("[Content Module Parser] parseAllVideoCards загружен в window.ytParser");