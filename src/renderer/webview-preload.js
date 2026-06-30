const { ipcRenderer } = require('electron');

// === 扩展名快速匹配（用 Set 替代 Array.includes） ===
const videoExtSet = new Set(['mp4','webm','flv','avi','mov','wmv','mkv','m3u8','ts','f4v']);
const audioExtSet = new Set(['mp3','wav','ogg','aac','flac','m4a','wma']);
const imgExtSet = new Set(['jpg','jpeg','png','gif','webp','bmp','svg','ico','tiff']);
const allMediaExtSet = new Set([...videoExtSet, ...audioExtSet, ...imgExtSet]);

// URL 媒体类型快速正则（避免完整 URL 解析）
const mediaExtRe = /\.(mp4|webm|flv|avi|mov|wmv|mkv|m3u8|ts|f4v|mp3|wav|ogg|aac|flac|m4a|wma|jpg|jpeg|png|gif|webp|bmp|svg)(\?|$)/i;

function getExt(url) {
  // 快速路径：从URL末尾提取扩展名，避免 new URL() 开销
  const q = url.indexOf('?');
  const path = q > -1 ? url.substring(0, q) : url;
  const dot = path.lastIndexOf('.');
  const slash = path.lastIndexOf('/');
  if (dot > slash && dot > -1) return path.substring(dot + 1).toLowerCase();
  return '';
}

function getFileName(url) {
  const q = url.indexOf('?');
  const path = q > -1 ? url.substring(0, q) : url;
  const slash = path.lastIndexOf('/');
  if (slash > -1 && slash < path.length - 1) {
    try { return decodeURIComponent(path.substring(slash + 1)); } catch { return path.substring(slash + 1); }
  }
  return 'resource';
}

// === 视频CDN域名 & URL模式 ===
const videoCdnDomains = new Set([
  'bilivideo.com', 'bilivideo.cn', 'hdslb.com',
  'iqiyi.com', 'qiyipic.com',
  'youku.com', 'ykimg.com',
  'v.qq.com', 'qqvideo.com',
  'douyinvod.com', 'douyinstatic.com',
  'weibocdn.com', 'sinaimg.cn'
]);

const videoPathPatterns = [
  /\/video\//i, /\/play\//i, /\/stream\//i,
  /\/media\//i, /\/vod\//i, /\/clip\//i
];

function isVideoUrl(url) {
  if (!url) return false;
  // blob URL（MSE 流媒体）
  if (url.startsWith('blob:')) return true;
  // 视频CDN域名
  try {
    const hostname = new URL(url).hostname;
    for (const domain of videoCdnDomains) {
      if (hostname.endsWith(domain) || hostname === domain) return true;
    }
  } catch {}
  // 视频路径模式
  for (const pattern of videoPathPatterns) {
    if (pattern.test(url)) return true;
  }
  // 视频文件扩展名
  if (mediaExtRe.test(url)) {
    const ext = getExt(url);
    if (videoExtSet.has(ext)) return true;
  }
  return false;
}

function isMediaUrl(url) {
  if (!url || url.charCodeAt(0) === 100 /* d */ && url.startsWith('data:')) return null;
  // 优先检测视频（包括 blob URL 和 CDN URL）
  if (isVideoUrl(url)) return 'video';
  // 检测音频/图片（仅扩展名匹配）
  if (mediaExtRe.test(url)) {
    const ext = getExt(url);
    if (audioExtSet.has(ext)) return 'audio';
    if (imgExtSet.has(ext)) return 'image';
  }
  return null;
}

// === 流媒体扩展名集合 ===
const streamExtSet = new Set(['m3u8','ts','f4v']);
function isStreamExt(url) {
  const ext = getExt(url);
  return streamExtSet.has(ext);
}

// === 批量 IPC 发送（减少 IPC 开销） ===
let mediaBatch = [];
let mediaBatchTimer = null;
function sendMediaBatch() {
  if (mediaBatch.length > 0) {
    ipcRenderer.send('media-batch', mediaBatch);
    mediaBatch = [];
  }
  mediaBatchTimer = null;
}
function queueMedia(type, url, streamType) {
  const item = {
    type, url,
    name: getFileName(url),
    format: (getExt(url) || type).toUpperCase()
  };
  if (streamType) item.streamType = streamType;
  mediaBatch.push(item);
  if (!mediaBatchTimer) {
    mediaBatchTimer = setTimeout(sendMediaBatch, 100);
  }
}

// === 网络请求拦截 ===
const originalXHROpen = XMLHttpRequest.prototype.open;
const originalXHRSend = XMLHttpRequest.prototype.send;

XMLHttpRequest.prototype.open = function(method, url) {
  this._interceptUrl = url;
  return originalXHROpen.call(this, method, url);
};

XMLHttpRequest.prototype.send = function() {
  const url = this._interceptUrl;
  if (url) {
    const t = isMediaUrl(url);
    if (t) queueMedia(t, url);
  }
  // 监听响应以检测视频内容类型
  this.addEventListener('load', function() {
    try {
      const responseUrl = this.responseURL;
      const contentType = this.getResponseHeader('Content-Type');
      
      // 检测响应 URL 是否包含视频关键词
      if (responseUrl && isVideoUrl(responseUrl)) {
        queueMedia('video', responseUrl);
      }
      // 检测 Content-Type 是否为视频类型
      else if (contentType && (contentType.startsWith('video/') || contentType.includes('mpegurl'))) {
        const finalUrl = responseUrl || url;
        if (finalUrl) queueMedia('video', finalUrl);
      }
    } catch (e) {}
  });
  return originalXHRSend.apply(this, arguments);
};

const originalFetch = window.fetch;
window.fetch = function(input, init) {
  const url = typeof input === 'string' ? input : (input && input.url);
  if (url) {
    const t = isMediaUrl(url);
    if (t) queueMedia(t, url);
  }
  const promise = originalFetch.apply(this, arguments);
  // 监听响应以检测视频内容类型
  promise.then(response => {
    try {
      const responseUrl = response.url;
      const contentType = response.headers.get('Content-Type');
      
      // 检测响应 URL 是否包含视频关键词
      if (responseUrl && isVideoUrl(responseUrl)) {
        queueMedia('video', responseUrl);
      }
      // 检测 Content-Type 是否为视频类型
      else if (contentType && (contentType.startsWith('video/') || contentType.includes('mpegurl'))) {
        const finalUrl = responseUrl || url;
        if (finalUrl) queueMedia('video', finalUrl);
      }
    } catch (e) {}
  }).catch(() => {});
  return promise;
};

// === Performance API 轮询（间隔缩短到 500ms） ===
let lastPerformanceCheck = 0;
function checkPerformanceEntries() {
  try {
    const entries = performance.getEntriesByType('resource');
    for (let i = lastPerformanceCheck, len = entries.length; i < len; i++) {
      const name = entries[i].name;
      const t = isMediaUrl(name);
      if (t) queueMedia(t, name);
    }
    lastPerformanceCheck = entries.length;
  } catch (e) {}
}
setInterval(checkPerformanceEntries, 500);

// === 背景图缓存（避免重复 getComputedStyle） ===
const bgImageCache = new WeakMap();
function getCachedBgImage(el) {
  if (bgImageCache.has(el)) return bgImageCache.get(el);
  try {
    const bg = getComputedStyle(el).backgroundImage;
    const url = (bg && bg !== 'none') ? extractBgUrl(bg) : null;
    bgImageCache.set(el, url);
    return url;
  } catch { return null; }
}
function extractBgUrl(bg) {
  const m = bg.match(/url\(["']?([^"')]+)["']?\)/);
  if (m && m[1] && !m[1].startsWith('data:')) return m[1];
  return null;
}

// === 单次 DOM 遍历提取所有资源（核心优化） ===
function extractAllResources() {
  const images = new Set();
  const videos = new Set();
  const audios = new Set();
  const links = [];

  // 用 TreeWalker 做单次遍历，替代多次 querySelectorAll
  const walker = document.createTreeWalker(
    document.body || document.documentElement,
    NodeFilter.SHOW_ELEMENT,
    null
  );

  let node = walker.currentNode;
  while (node) {
    const tag = node.tagName;
    // img
    if (tag === 'IMG') {
      const src = node.src; if (src && !src.startsWith('data:')) images.add(src);
      const ds = node.getAttribute('data-src'); if (ds && !ds.startsWith('data:')) images.add(ds);
      const dorig = node.getAttribute('data-original'); if (dorig && !dorig.startsWith('data:')) images.add(dorig);
      const dlazy = node.getAttribute('data-lazy-src'); if (dlazy && !dlazy.startsWith('data:')) images.add(dlazy);
    }
    // video
    else if (tag === 'VIDEO') {
      // 检查 video.src 属性
      if (node.src) {
        if (node.src.startsWith('blob:')) {
          videos.add({ url: node.src, streamType: '流媒体视频' });
        } else {
          const st = isStreamExt(node.src) ? '流媒体片段' : undefined;
          videos.add({ url: node.src, streamType: st });
        }
      }
      // 检查 video 的 <source> 子元素的 src 属性
      const sources = node.querySelectorAll('source');
      for (let i = 0; i < sources.length; i++) {
        const src = sources[i].src;
        if (src) {
          if (src.startsWith('blob:')) {
            videos.add({ url: src, streamType: '流媒体视频' });
          } else {
            const st = isStreamExt(src) ? '流媒体片段' : undefined;
            videos.add({ url: src, streamType: st });
          }
        }
      }
      // 检查 video.currentSrc 属性（对于 MSE 视频）
      if (node.currentSrc && node.currentSrc !== node.src) {
        if (node.currentSrc.startsWith('blob:')) {
          videos.add({ url: node.currentSrc, streamType: '流媒体视频' });
        } else {
          const st = isStreamExt(node.currentSrc) ? '流媒体片段' : undefined;
          videos.add({ url: node.currentSrc, streamType: st });
        }
      }
    }
    // audio
    else if (tag === 'AUDIO') {
      if (node.src) audios.add(node.src);
      const sources = node.querySelectorAll('source');
      for (let i = 0; i < sources.length; i++) {
        if (sources[i].src) audios.add(sources[i].src);
      }
    }
    // link
    else if (tag === 'A') {
      const href = node.href;
      if (href && !href.startsWith('javascript:') && href !== '#') {
        links.push({ url: href, text: (node.textContent || '').trim().substring(0, 80) });
      }
    }
    // 背景图（用缓存避免重复 getComputedStyle）
    const bgUrl = getCachedBgImage(node);
    if (bgUrl) {
      const mt = isMediaUrl(bgUrl);
      if (mt === 'video') videos.add({ url: bgUrl, streamType: isStreamExt(bgUrl) ? '流媒体片段' : undefined });
      else if (mt === 'audio') audios.add(bgUrl);
      else images.add(bgUrl);
    }

    node = walker.nextNode();
  }

  // script 标签提取嵌入媒体 URL（合并正则，单次遍历）
  const scripts = document.querySelectorAll('script');
  const combinedVideoRe = /["']([^"']*\.(mp4|webm|flv|avi|mov|wmv|mkv|m3u8|ts|f4v)(\?[^"']*)?)["']/gi;
  const combinedAudioRe = /["']([^"']*\.(mp3|wav|ogg|aac|flac|m4a)(\?[^"']*)?)["']/gi;
  const kvVideoRe = /["']?(video[_-]?url|video[_-]?src|play[_-]?url|video[_-]?path|playurl|play_url|video_url|video_src|videoUrl|playUrl|videoPath|durl|playurl)["']?\s*[:=]\s*["']([^"']+)["']/gi;
  const kvAudioRe = /["']?(audio[_-]?url|audio[_-]?src|music[_-]?url|audioUrl|audioSrc|musicUrl)["']?\s*[:=]\s*["']([^"']+)["']/gi;
  // B站 __playinfo__ 及其他平台视频数据检测
  const playinfoRe = /__playinfo__\s*=\s*(\{[\s\S]*?\})\s*;?\s*<\/script/i;
  const cdnVideoUrlRe = /["'](https?:\/\/[^"']*(?:bilivideo|hdslb|iqiyi|qiyipic|youku|ykimg|douyinvod|douyinstatic)[^"']*)["']/gi;

  for (let i = 0; i < scripts.length; i++) {
    const content = scripts[i].textContent || '';
    if (content.length < 20) continue; // 跳过太短的 script

    let m;
    combinedVideoRe.lastIndex = 0;
    while ((m = combinedVideoRe.exec(content)) !== null) {
      const url = m[1];
      if (url.startsWith('http') || url.startsWith('//')) {
        const st = isStreamExt(url) ? '流媒体片段' : undefined;
        videos.add({ url, streamType: st });
      }
    }
    kvVideoRe.lastIndex = 0;
    while ((m = kvVideoRe.exec(content)) !== null) {
      const url = m[2];
      if (url.startsWith('http') || url.startsWith('//')) {
        const st = isStreamExt(url) ? '流媒体片段' : undefined;
        videos.add({ url, streamType: st });
      }
    }
    // 检测 CDN 视频 URL（无扩展名的视频流）
    cdnVideoUrlRe.lastIndex = 0;
    while ((m = cdnVideoUrlRe.exec(content)) !== null) {
      const url = m[1];
      if (isVideoUrl(url)) {
        videos.add({ url, streamType: 'CDN视频流' });
      }
    }
    // 检测 B站 __playinfo__ 数据
    if (content.includes('__playinfo__')) {
      try {
        const match = content.match(/window\.__playinfo__\s*=\s*(\{[\s\S]*?\})\s*;?\s*(?:<\/script>|$)/);
        if (match) {
          const jsonStr = match[1];
          // 提取 durl 数组中的视频 URL
          const durlRe = /"url"\s*:\s*"([^"]+)"/g;
          let dm;
          while ((dm = durlRe.exec(jsonStr)) !== null) {
            const url = dm[1].replace(/\\u002F/g, '/');
            if (url.startsWith('http')) {
              videos.add({ url, streamType: 'B站视频流' });
            }
          }
          // 提取 backup_url
          const backupRe = /"backup_url"\s*:\s*\[([\s\S]*?)\]/g;
          while ((dm = backupRe.exec(jsonStr)) !== null) {
            const urlMatches = dm[1].match(/"([^"]+)"/g);
            if (urlMatches) {
              for (const um of urlMatches) {
                const url = um.slice(1, -1).replace(/\\u002F/g, '/');
                if (url.startsWith('http')) {
                  videos.add({ url, streamType: 'B站视频备份流' });
                }
              }
            }
          }
        }
      } catch (e) {}
    }
    combinedAudioRe.lastIndex = 0;
    while ((m = combinedAudioRe.exec(content)) !== null) {
      const url = m[1];
      if (url.startsWith('http') || url.startsWith('//')) audios.add(url);
    }
    kvAudioRe.lastIndex = 0;
    while ((m = kvAudioRe.exec(content)) !== null) {
      const url = m[2];
      if (url.startsWith('http') || url.startsWith('//')) audios.add(url);
    }
  }

  // 提取页面文本内容（按块级元素拆分）
  const texts = [];
  const textBlocks = document.querySelectorAll('p, h1, h2, h3, h4, h5, h6, li, blockquote, article, section, main, div, span, td, th, figcaption, summary, dt, dd');
  const seenTexts = new Set();
  for (let i = 0; i < textBlocks.length; i++) {
    const el = textBlocks[i];
    // 跳过不可见元素、script/style、以及已处理的嵌套子元素
    if (!el.offsetParent && el.tagName !== 'BODY') continue;
    if (el.closest('script, style, noscript')) continue;
    // 只取直接文本（跳过包含大量子块级元素的容器）
    const directText = Array.from(el.childNodes)
      .filter(n => n.nodeType === Node.TEXT_NODE)
      .map(n => n.textContent.trim())
      .join(' ');
    const fullText = (el.textContent || '').replace(/\s+/g, ' ').trim();
    const text = directText || fullText;
    if (!text || text.length < 5) continue;
    // 去重：跳过已被更长文本包含的短文本
    const truncated = text.length > 500 ? text.substring(0, 500) : text;
    const key = truncated.substring(0, 60);
    if (seenTexts.has(key)) continue;
    seenTexts.add(key);
    // 生成有意义的名称
    const tag = el.tagName.toLowerCase();
    const id = el.id ? `#${el.id}` : '';
    const name = id ? `<${tag}${id}>` : `<${tag}>`;
    texts.push({ name: name, content: truncated, length: truncated.length });
    if (texts.length >= 100) break; // 限制数量
  }

  return { images: [...images], videos: [...videos], audios: [...audios], links, texts };
}

// 提取指定元素及其子树中的资源（优化版：单次遍历）
function extractResourcesFromElement(el) {
  const images = new Set();
  const videos = new Set();
  const audios = new Set();
  const links = [];
  const texts = [];

  // 提取选中元素的文字内容
  const textContent = (el.textContent || '').replace(/\s+/g, ' ').trim();
  if (textContent) {
    const truncated = textContent.length > 500 ? textContent.substring(0, 500) : textContent;
    texts.push({ name: '元素文字', content: truncated, length: truncated.length });
  }

  // B站视频页面特殊处理：如果点击的元素在视频播放器区域内，向上查找video元素
  const isBilibiliPage = location.href.includes('bilibili.com/video/');
  let targetEl = el;
  
  if (isBilibiliPage) {
    // 检查点击的元素是否在视频播放器容器内
    const playerContainer = el.closest('.bpx-player-container, .bilibili-player, #bilibili-player, .video-player');
    if (playerContainer) {
      // 尝试找到video元素
      const videoEl = playerContainer.querySelector('video');
      if (videoEl) {
        targetEl = videoEl; // 直接使用video元素作为提取目标
      }
    }
  }

  const walker = document.createTreeWalker(targetEl, NodeFilter.SHOW_ELEMENT, null);
  let node = walker.currentNode;
  while (node) {
    const tag = node.tagName;
    if (tag === 'IMG') {
      const src = node.src; if (src && !src.startsWith('data:')) images.add(src);
      const ds = node.getAttribute('data-src'); if (ds && !ds.startsWith('data:')) images.add(ds);
      const dorig = node.getAttribute('data-original'); if (dorig && !dorig.startsWith('data:')) images.add(dorig);
      const dlazy = node.getAttribute('data-lazy-src'); if (dlazy && !dlazy.startsWith('data:')) images.add(dlazy);
    } else if (tag === 'VIDEO') {
      // 检查 video.src 属性
      if (node.src) {
        if (node.src.startsWith('blob:')) {
          videos.add({ url: node.src, streamType: '流媒体视频' });
        } else {
          const st = isStreamExt(node.src) ? '流媒体片段' : undefined;
          videos.add({ url: node.src, streamType: st });
        }
      }
      // 检查 video 的 <source> 子元素的 src 属性
      const sources = node.querySelectorAll('source');
      for (let i = 0; i < sources.length; i++) {
        const src = sources[i].src;
        if (src) {
          if (src.startsWith('blob:')) {
            videos.add({ url: src, streamType: '流媒体视频' });
          } else {
            const st = isStreamExt(src) ? '流媒体片段' : undefined;
            videos.add({ url: src, streamType: st });
          }
        }
      }
      // 检查 video.currentSrc 属性（对于 MSE 视频）
      if (node.currentSrc && node.currentSrc !== node.src) {
        if (node.currentSrc.startsWith('blob:')) {
          videos.add({ url: node.currentSrc, streamType: '流媒体视频' });
        } else {
          const st = isStreamExt(node.currentSrc) ? '流媒体片段' : undefined;
          videos.add({ url: node.currentSrc, streamType: st });
        }
      }
    } else if (tag === 'AUDIO') {
      if (node.src) audios.add(node.src);
      const sources = node.querySelectorAll('source');
      for (let i = 0; i < sources.length; i++) if (sources[i].src) audios.add(sources[i].src);
    } else if (tag === 'A') {
      const href = node.href;
      if (href && !href.startsWith('javascript:') && href !== '#') {
        links.push({ url: href, text: (node.textContent || '').trim().substring(0, 80) });
      }
    }
    const bgUrl = getCachedBgImage(node);
    if (bgUrl) {
      const mt = isMediaUrl(bgUrl);
      if (mt === 'video') videos.add({ url: bgUrl, streamType: isStreamExt(bgUrl) ? '流媒体片段' : undefined });
      else if (mt === 'audio') audios.add(bgUrl);
      else images.add(bgUrl);
    }
    node = walker.nextNode();
  }

  // B站页面特殊处理：如果没有找到视频，尝试从整个页面提取
  if (isBilibiliPage && videos.size === 0) {
    const allVideos = document.querySelectorAll('video');
    for (let i = 0; i < allVideos.length; i++) {
      const video = allVideos[i];
      if (video.src) {
        if (video.src.startsWith('blob:')) {
          videos.add({ url: video.src, streamType: '流媒体视频' });
        } else {
          const st = isStreamExt(video.src) ? '流媒体片段' : undefined;
          videos.add({ url: video.src, streamType: st });
        }
      }
      if (video.currentSrc && video.currentSrc !== video.src) {
        if (video.currentSrc.startsWith('blob:')) {
          videos.add({ url: video.currentSrc, streamType: '流媒体视频' });
        } else {
          const st = isStreamExt(video.currentSrc) ? '流媒体片段' : undefined;
          videos.add({ url: video.currentSrc, streamType: st });
        }
      }
    }
  }

  return { images: [...images], videos: [...videos], audios: [...audios], links, texts };
}

// === 元素检查模式（融合方案：可视化标记 + hover预览 + 点击提取） ===
let inspectMode = false;
let highlightEl = null;   // 悬停高亮边框
let selectedEl = null;    // 选中的元素
let mediaBadges = [];     // 媒体元素上的可视化标记
let hoverTooltip = null;  // 悬停提示框

// Hover 预览防抖
let hoverPreviewTimer = null;
let lastHoveredElement = null;
const HOVER_PREVIEW_DELAY = 300; // 300ms 防抖

// 提取元素资源（用于 hover 预览）
function extractElementResourcesForPreview(el) {
  return extractResourcesFromElement(el);
}

// 检测一个元素是否直接关联媒体资源（用缓存）
function getElementMediaType(el) {
  if (!el || !el.tagName) return null;
  const tag = el.tagName;
  if (tag === 'IMG') return 'image';
  if (tag === 'VIDEO') return 'video';
  if (tag === 'AUDIO') return 'audio';
  if (tag === 'SOURCE') {
    const parent = el.parentElement;
    if (parent) return getElementMediaType(parent);
  }
  const bgUrl = getCachedBgImage(el);
  if (bgUrl) return 'image';
  if (el.querySelector && el.querySelector('img,video,audio')) return 'container';
  return null;
}

// 统计元素及其子树中的媒体资源数量（优化：单次遍历）
function countMediaInElement(el) {
  const counts = { images: 0, videos: 0, audios: 0 };
  const walker = document.createTreeWalker(el, NodeFilter.SHOW_ELEMENT, null);
  let node = walker.currentNode;
  while (node) {
    const tag = node.tagName;
    if (tag === 'IMG') counts.images++;
    else if (tag === 'VIDEO') counts.videos++;
    else if (tag === 'AUDIO') counts.audios++;
    else if (getCachedBgImage(node)) counts.images++;
    node = walker.nextNode();
  }
  return counts;
}

// 创建可视化标记（优化：跳过不可见元素，用缓存）
function createMediaBadges() {
  removeMediaBadges();
  const vw = window.innerWidth;
  const vh = window.innerHeight;

  // 标记 img/video/audio 元素
  const mediaEls = document.querySelectorAll('img,video,audio');
  for (let i = 0; i < mediaEls.length; i++) {
    const el = mediaEls[i];
    const rect = el.getBoundingClientRect();
    if (rect.width < 20 || rect.height < 20 || rect.top < 0 || rect.left < 0 || rect.top > vh || rect.left > vw) continue;

    const type = getElementMediaType(el);
    const icon = type === 'video' ? '🎬' : type === 'audio' ? '🎵' : '🖼';
    const badge = document.createElement('div');
    badge.className = '__ws_badge';
    badge.textContent = icon;
    badge.style.cssText = `position:fixed;top:${rect.top+2}px;left:${rect.right-22}px;width:20px;height:20px;background:rgba(0,210,255,0.85);border-radius:4px;display:flex;align-items:center;justify-content:center;font-size:12px;z-index:999998;pointer-events:none;box-shadow:0 1px 4px rgba(0,0,0,0.4);`;
    badge._targetEl = el;
    document.body.appendChild(badge);
    mediaBadges.push(badge);
  }
}

// 移除所有标记
function removeMediaBadges() {
  mediaBadges.forEach(b => b.remove());
  mediaBadges = [];
}

// 更新标记位置（滚动/resize时）
function updateBadgePositions() {
  mediaBadges.forEach(badge => {
    const el = badge._targetEl;
    if (!el || !el.getBoundingClientRect) return;
    const rect = el.getBoundingClientRect();
    badge.style.top = (rect.top + 2) + 'px';
    badge.style.left = (rect.right - 22) + 'px';
  });
}

// 创建悬停提示框
function createTooltip() {
  if (!hoverTooltip) {
    hoverTooltip = document.createElement('div');
    hoverTooltip.style.cssText = `
      position: fixed;
      padding: 6px 10px;
      background: rgba(15,15,26,0.95);
      color: #e0e0e0;
      border: 1px solid #00d2ff;
      border-radius: 6px;
      font-size: 11px;
      z-index: 999999;
      pointer-events: none;
      display: none;
      max-width: 260px;
      line-height: 1.5;
      box-shadow: 0 2px 8px rgba(0,0,0,0.5);
    `;
    document.body.appendChild(hoverTooltip);
  }
  return hoverTooltip;
}

// 显示悬停提示
function showTooltip(el, x, y) {
  const tip = createTooltip();
  const counts = countMediaInElement(el);
  const tag = el.tagName.toLowerCase();
  const id = el.id ? '#' + el.id : '';
  const cls = el.className && typeof el.className === 'string'
    ? '.' + el.className.trim().split(/\s+/).slice(0, 2).join('.')
    : '';

  let html = `<b style="color:#00d2ff">&lt;${tag}${id}${cls}&gt;</b><br>`;
  const parts = [];
  if (counts.images > 0) parts.push(`🖼 ${counts.images} 图片`);
  if (counts.videos > 0) parts.push(`🎬 ${counts.videos} 视频`);
  if (counts.audios > 0) parts.push(`🎵 ${counts.audios} 音频`);
  if (parts.length === 0) {
    html += '<span style="color:#8888aa">无媒体资源</span>';
  } else {
    html += parts.join(' | ');
  }
  html += '<br><span style="color:#8888aa;font-size:10px">点击提取此区域资源</span>';

  tip.innerHTML = html;
  tip.style.display = 'block';

  // 定位：避免超出视口
  const tipRect = tip.getBoundingClientRect();
  let tx = x + 14;
  let ty = y + 14;
  if (tx + tipRect.width > window.innerWidth - 10) tx = x - tipRect.width - 10;
  if (ty + tipRect.height > window.innerHeight - 10) ty = y - tipRect.height - 10;
  tip.style.left = tx + 'px';
  tip.style.top = ty + 'px';
}

function hideTooltip() {
  if (hoverTooltip) hoverTooltip.style.display = 'none';
}

// 创建高亮边框元素
function createHighlight() {
  if (!highlightEl) {
    highlightEl = document.createElement('div');
    highlightEl.style.cssText = `
      position: fixed;
      pointer-events: none;
      border: 2px solid #00d2ff;
      background: rgba(0, 210, 255, 0.08);
      z-index: 999997;
      transition: all 0.08s ease;
      display: none;
    `;
    document.body.appendChild(highlightEl);
  }
  return highlightEl;
}

// 更新高亮位置
function updateHighlight(el) {
  const hl = createHighlight();
  const rect = el.getBoundingClientRect();
  hl.style.left = rect.left + 'px';
  hl.style.top = rect.top + 'px';
  hl.style.width = rect.width + 'px';
  hl.style.height = rect.height + 'px';
  hl.style.display = 'block';
}

// 隐藏高亮
function hideHighlight() {
  if (highlightEl) {
    highlightEl.style.display = 'none';
  }
}

// 标记选中元素
function markSelected(el) {
  if (selectedEl) {
    selectedEl.style.outline = selectedEl._originalOutline || '';
  }
  selectedEl = el;
  if (el) {
    el._originalOutline = el.style.outline;
    el.style.outline = '3px solid #00cec9';
  }
}

// 清除选中
function clearSelected() {
  if (selectedEl) {
    selectedEl.style.outline = selectedEl._originalOutline || '';
    selectedEl = null;
  }
}

// 鼠标移动时高亮 + 显示提示 + 发送预览（含完整资源数据）
let hoverDebounce = null;
document.addEventListener('mousemove', (e) => {
  if (!inspectMode) return;
  const target = e.target;
  if (target === highlightEl || target === hoverTooltip || target.classList.contains('__ws_badge')) return;
  updateHighlight(target);
  // 提示框稍作延迟避免闪烁
  clearTimeout(hoverDebounce);
  hoverDebounce = setTimeout(() => {
    showTooltip(target, e.clientX, e.clientY);
    // 发送悬停预览数据（含完整资源，用于已选面板预览）
    if (target !== lastHoveredElement) {
      lastHoveredElement = target;
      clearTimeout(hoverPreviewTimer);
      hoverPreviewTimer = setTimeout(() => {
        const counts = countMediaInElement(target);
        const tag = target.tagName.toLowerCase();
        const id = target.id ? '#' + target.id : '';
        const cls = target.className && typeof target.className === 'string'
          ? '.' + target.className.trim().split(/\s+/).slice(0, 2).join('.') : '';
        const textPreview = (target.textContent || '').replace(/\s+/g, ' ').trim().substring(0, 80);
        // 提取完整资源数据用于预览
        const resources = extractElementResourcesForPreview(target);
        ipcRenderer.send('element-hover-preview', {
          element: {
            tagName: target.tagName, id: target.id,
            className: typeof target.className === 'string' ? target.className : '',
            textContent: textPreview
          },
          selector: `<${tag}${id}${cls}>`,
          counts: counts,
          textPreview: textPreview,
          resources: resources
        });
      }, HOVER_PREVIEW_DELAY);
    }
  }, 200);
}, true);

// 鼠标离开时清除预览
document.addEventListener('mouseout', (e) => {
  if (!inspectMode) return;
  const target = e.target;
  if (target === highlightEl || target === hoverTooltip || target.classList.contains('__ws_badge')) return;
  // 检查鼠标是否真的离开了元素（不是移到子元素）
  const related = e.relatedTarget;
  if (related && target.contains(related)) return;
  if (target === lastHoveredElement) {
    lastHoveredElement = null;
    clearTimeout(hoverPreviewTimer);
    ipcRenderer.send('element-hover-clear');
  }
}, true);

// 点击事件处理
document.addEventListener('click', (e) => {
  // 查找最近的 a 标签（提取模式和非提取模式共用）
  let linkTarget = e.target;
  while (linkTarget && linkTarget.tagName !== 'A') {
    linkTarget = linkTarget.parentElement;
  }

  // 非提取模式：点击超链接时新建标签页导航，阻止在当前 BrowserView 中导航
  if (!inspectMode) {
    if (linkTarget && linkTarget.tagName === 'A') {
      const href = linkTarget.href;
      // 仅拦截 http/https 链接，跳过 javascript:、#、mailto:、tel: 等
      if (href && (href.startsWith('http://') || href.startsWith('https://'))) {
        e.preventDefault();
        e.stopPropagation();
        ipcRenderer.send('link-clicked', href);
      }
    }
    // 非链接点击：让浏览器默认行为处理
    return;
  }

  // 提取模式下的处理
  if (linkTarget && linkTarget.tagName === 'A') {
    const href = linkTarget.href;
    if (href && href.startsWith('http')) {
      // 提取模式下：阻止导航，提取元素资源
      e.preventDefault();
      e.stopPropagation();
      hideTooltip();
      markSelected(linkTarget);
      const resources = extractResourcesFromElement(linkTarget);
      const counts = countMediaInElement(linkTarget);
      ipcRenderer.send('element-resources', {
        element: {
          tagName: linkTarget.tagName,
          id: linkTarget.id,
          className: typeof linkTarget.className === 'string' ? linkTarget.className : '',
          textContent: (linkTarget.textContent || '').substring(0, 100),
          mediaCounts: counts
        },
        resources: resources
      });
      return;
    }
  }

  // 非链接点击：提取模式下处理
  e.preventDefault();
  e.stopPropagation();

  const target = e.target;
  if (target === highlightEl || target === hoverTooltip || target.classList.contains('__ws_badge')) return;

  hideTooltip();
  markSelected(target);
  const resources = extractResourcesFromElement(target);
  const counts = countMediaInElement(target);

  ipcRenderer.send('element-resources', {
    element: {
      tagName: target.tagName,
      id: target.id,
      className: typeof target.className === 'string' ? target.className : '',
      textContent: (target.textContent || '').substring(0, 100),
      mediaCounts: counts
    },
    resources: resources
  });
}, true);

// ESC退出检查模式
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && inspectMode) {
    inspectMode = false;
    hideHighlight();
    hideTooltip();
    clearSelected();
    removeMediaBadges();
    document.body.style.cursor = '';
    ipcRenderer.send('inspect-mode-changed', false);
  }
});

// 滚动时更新标记位置
window.addEventListener('scroll', () => {
  if (inspectMode) updateBadgePositions();
}, true);

window.addEventListener('resize', () => {
  if (inspectMode) {
    updateBadgePositions();
  }
}, true);

// === 接收渲染进程的指令 ===

// 切换检查模式
ipcRenderer.on('toggle-inspect', (event, enabled) => {
  inspectMode = enabled;
  if (enabled) {
    document.body.style.cursor = 'crosshair';
    createHighlight();
    // 创建可视化标记
    setTimeout(() => createMediaBadges(), 100);
  } else {
    document.body.style.cursor = '';
    hideHighlight();
    hideTooltip();
    clearSelected();
    removeMediaBadges();
  }
});

// 提取所有资源
ipcRenderer.on('extract-all', () => {
  checkPerformanceEntries(); // 先更新 performance entries
  const resources = extractAllResources();
  ipcRenderer.send('resources-extracted', resources);
});

// 获取页面标题
ipcRenderer.on('get-title', () => {
  ipcRenderer.send('page-title', document.title);
});

// 页面加载完成后自动提取
window.addEventListener('load', () => {
  setTimeout(() => {
    const resources = extractAllResources();
    ipcRenderer.send('resources-extracted', resources);
    ipcRenderer.send('page-title', document.title);
  }, 1000);
});

// 监听DOM变化（SPA页面可能动态加载内容）
let mutationTimer = null;
const observer = new MutationObserver(() => {
  // 防抖：2秒内只触发一次
  if (mutationTimer) clearTimeout(mutationTimer);
  mutationTimer = setTimeout(() => {
    if (!inspectMode) {
      const resources = extractAllResources();
      ipcRenderer.send('resources-extracted', resources);
    }
  }, 2000);
});

// 监听来自 executeJavaScript 的 postMessage（用于B站视频下载进度反馈）
window.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'bilibili-download-progress') {
    ipcRenderer.send('bilibili-download-progress-from-webview', {
      fileId: event.data.fileId,
      progress: event.data.progress,
      downloaded: event.data.downloaded,
      total: event.data.total
    });
  }
}, true);

// 开始观察DOM变化
if (document.body) {
  observer.observe(document.body, {
    childList: true,
    subtree: true
  });
} else {
  document.addEventListener('DOMContentLoaded', () => {
    observer.observe(document.body, {
      childList: true,
      subtree: true
    });
  });
}

// 监听页面导航（SPA路由变化）
let lastUrl = location.href;
const urlObserver = new MutationObserver(() => {
  if (location.href !== lastUrl) {
    lastUrl = location.href;
    ipcRenderer.send('page-url-changed', lastUrl);
    // URL变化后重新提取
    setTimeout(() => {
      const resources = extractAllResources();
      ipcRenderer.send('resources-extracted', resources);
    }, 1500);
  }
});

if (document.body) {
  urlObserver.observe(document.body, { subtree: true, childList: true });
}

// 监听popstate（浏览器前进后退）
window.addEventListener('popstate', () => {
  setTimeout(() => {
    const resources = extractAllResources();
    ipcRenderer.send('resources-extracted', resources);
  }, 1000);
});

console.log('[WebScout Preload] 已加载');
