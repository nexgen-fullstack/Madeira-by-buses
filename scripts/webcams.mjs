// Each of Madeira's webcams' live broadcast now, for the app's "Webcams" button: Portal
// Netmadeira and Madeira-Web broadcast their cameras live on YouTube, and a broadcast gets a
// new video when it is restarted. Their channels' public feeds (and, with a YouTube Data
// API key in YOUTUBE_API_KEY, every live broadcast of theirs) say which video each camera
// is on now; a camera is told by the words of its titles (apps/web/src/lib/webcams.json).
//
//   node scripts/webcams.mjs apps/web/public/data/webcams.json
//
// Writes { fetchedAt, live: { cameraId: { video, title } } }; keeps the file as it was when
// neither feed answers.

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const CHANNELS = {
  netmadeira: 'UCNtxVRy0Nv0U5weQ7PDbgAw',
  madeiraweb: 'UCH_lKz2VXlfLPgYOE3biySg',
};
const UA = 'MadeiraBus webcams (+https://github.com/nexgen-fullstack/Madeira-by-buses)';

/** Plain words: lower case, without accents or signs. */
export const plain = (s) =>
  s
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();

/** A live broadcast's title: "LIVE", "Live", "ao vivo", or the red dot. */
export const isLive = (title) => /\blive\b|ao vivo|🔴/i.test(title);

/**
 * The camera a broadcast of a provider's channel is of: the one whose words its title has,
 * the longest words winning ("câmara de lobos baía" over "câmara de lobos").
 */
export function cameraOf(cameras, provider, title) {
  const words = ` ${plain(title)} `;
  let best;
  let bestLength = 0;
  for (const c of cameras) {
    if (c.provider !== provider) continue;
    const hits = c.match.filter((m) => words.includes(` ${m} `));
    const length = hits.reduce((n, m) => n + m.length, 0);
    if (hits.length === c.match.length && length > bestLength) {
      best = c;
      bestLength = length;
    }
  }
  return best;
}

/** The videos of a channel's public feed, newest first: id, title, published. */
export function readFeed(xml) {
  const out = [];
  for (const entry of xml.split('<entry>').slice(1)) {
    const video = /<yt:videoId>([^<]+)<\/yt:videoId>/.exec(entry)?.[1];
    const title = /<title>([^<]*)<\/title>/.exec(entry)?.[1];
    const published = /<published>([^<]+)<\/published>/.exec(entry)?.[1] ?? '';
    if (video && title) out.push({ video, title: unescape(title), published });
  }
  return out;
}

const unescape = (s) =>
  s
    .replaceAll('&amp;', '&')
    .replaceAll('&quot;', '"')
    .replaceAll('&#39;', "'")
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>');

async function feed(channel) {
  const res = await fetch(`https://www.youtube.com/feeds/videos.xml?channel_id=${channel}`, {
    headers: { 'user-agent': UA },
  });
  if (!res.ok) throw new Error(`feed ${channel}: HTTP ${res.status}`);
  return readFeed(await res.text());
}

/**
 * With a key: every broadcast of the channel live now — its uploads (the newest 200) asked
 * which are live (YouTube Data API, about 10 units; its live search misses them).
 */
async function liveNow(channel, key) {
  const api = async (what, q) => {
    const res = await fetch(
      `https://www.googleapis.com/youtube/v3/${what}?${new URLSearchParams({ ...q, key })}`,
    );
    if (!res.ok) throw new Error(`YouTube API ${what}: HTTP ${res.status}`);
    return res.json();
  };
  const ids = [];
  let pageToken;
  for (let page = 0; page < 4; page++) {
    const list = await api('playlistItems', {
      part: 'contentDetails',
      playlistId: `UU${channel.slice(2)}`,
      maxResults: '50',
      ...(pageToken ? { pageToken } : {}),
    });
    ids.push(...(list.items ?? []).map((i) => i.contentDetails.videoId));
    pageToken = list.nextPageToken;
    if (!pageToken) break;
  }
  const live = [];
  for (let i = 0; i < ids.length; i += 50) {
    const videos = await api('videos', { part: 'snippet', id: ids.slice(i, i + 50).join(',') });
    for (const v of videos.items ?? [])
      if (v.snippet.liveBroadcastContent === 'live')
        live.push({
          video: v.id,
          title: v.snippet.title,
          published: v.snippet.publishedAt,
          live: true,
        });
  }
  return live;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const out = process.argv[2] ?? 'apps/web/public/data/webcams.json';
  const cameras = JSON.parse(
    readFileSync(new URL('../apps/web/src/lib/webcams.json', import.meta.url), 'utf8'),
  );
  const key = process.env.YOUTUBE_API_KEY;
  const live = {};
  let answered = 0;
  for (const [provider, channel] of Object.entries(CHANNELS)) {
    const videos = [];
    if (key) {
      try {
        const now = await liveNow(channel, key);
        console.log(`${provider}: ${now.length} broadcasts live now (YouTube Data API)`);
        for (const v of now) console.log(`  ${v.video} ${v.title}`);
        videos.push(...now);
        answered++;
      } catch (e) {
        console.log(`! ${provider}: ${e.message}`);
      }
    }
    try {
      videos.push(...(await feed(channel)));
      answered++;
    } catch (e) {
      console.log(`! ${provider}: ${e.message}`);
    }
    // The broadcasts live now first, then the newest: each camera's first.
    for (const v of videos) {
      if (!v.live && !isLive(v.title)) continue;
      const camera = cameraOf(cameras, provider, v.title);
      if (camera && !live[camera.id]) live[camera.id] = { video: v.video, title: v.title };
    }
  }
  // Nothing heard, or nothing found: the file stays as it was rather than empty.
  if (answered === 0 || Object.keys(live).length === 0) {
    console.log('No feed answered; the webcams file stays as it was');
    process.exit(0);
  }
  writeFileSync(out, JSON.stringify({ fetchedAt: new Date().toISOString(), live }, null, 1));
  console.log(
    `${Object.keys(live).length} of ${cameras.length} webcams live on YouTube written to ${out}`,
  );
}
