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
  const downloads = [];

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
        const linkText = (node.textContent || '').trim().substring(0, 80);
        // 识别下载链接（GitHub releases/archive、codeload、压缩包、可执行文件等）
        const dlInfo = identifyDownload(href, node);
        if (dlInfo) {
          downloads.push({
            url: href,
            name: linkText || getFileName(href) || dlInfo.suggestedName,
            text: linkText,
            source: dlInfo.source,
            size: 0
          });
        } else {
          links.push({ url: href, name: linkText || getFileName(href), text: linkText });
        }
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

  return { images: [...images], videos: [...videos], audios: [...audios], links, downloads, texts };
}

// 识别下载链接：GitHub releases/archive、codeload、GitLab、压缩包、可执行文件等
// 返回 { source, suggestedName } 或 null
function identifyDownload(href, anchorNode) {
  if (!href || typeof href !== 'string') return null;
  const lower = href.toLowerCase();

  // 1. download 属性（HTML5 显式下载标记）
  if (anchorNode && anchorNode.getAttribute && anchorNode.getAttribute('download') !== null) {
    return { source: 'download-attr', suggestedName: anchorNode.getAttribute('download') || getFileName(href) };
  }

  // 2. GitHub 下载链接
  // - /releases/download/v1.0/file.zip
  // - /archive/refs/heads/main.zip
  // - /archive/refs/tags/v1.0.zip
  // - codeload.github.com/...
  if (lower.includes('github.com') && /\/(releases\/download|archive\/refs)\//i.test(href)) {
    return { source: 'GitHub', suggestedName: getFileName(href) };
  }
  if (lower.includes('codeload.github.com')) {
    return { source: 'GitHub', suggestedName: getFileName(href) };
  }

  // 3. GitLab 下载
  if (lower.includes('gitlab.com') && /\/(-\/archive\/|repository\/(archive|raw)\b)/i.test(href)) {
    return { source: 'GitLab', suggestedName: getFileName(href) };
  }

  // 4. Gitee 下载
  if (lower.includes('gitee.com') && /\/(repository\/archive|releases\/download)\//i.test(href)) {
    return { source: 'Gitee', suggestedName: getFileName(href) };
  }

  // 5. 压缩包扩展名
  if (/\.(zip|rar|7z|tar|gz|bz2|xz|tgz|tbz2)(\?|#|$)/i.test(href)) {
    return { source: '压缩包', suggestedName: getFileName(href) };
  }

  // 6. 可执行文件 / 安装包
  if (/\.(exe|msi|deb|rpm|dmg|pkg|appimage|snap|flatpak|apk|xapk)(\?|#|$)/i.test(href)) {
    return { source: '安装包', suggestedName: getFileName(href) };
  }

  // 7. 镜像 ISO / 文档
  if (/\.(iso|img|dmg|pdf|doc|docx|xls|xlsx|ppt|pptx|epub|mob)(\?|#|$)/i.test(href)) {
    return { source: '文档', suggestedName: getFileName(href) };
  }

  // 8. URL 路径包含 /download/ 或 /downloads/
  if (/\/downloads?\/(file|attachment|release|archive)?/i.test(href) && !/\/(downloads?\/?$)/i.test(href)) {
    // 排除主页 /downloads 链接（太宽泛）
    return { source: '下载页', suggestedName: getFileName(href) };
  }

  return null;
}

// 提取指定元素及其子树中的资源（优化版：单次遍历）
function extractResourcesFromElement(el) {
  const images = new Set();
  const videos = new Set();
  const audios = new Set();
  const links = [];
  const downloads = [];
  const texts = [];
  const pageUrl = location.href;

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
          videos.add({ url: node.src, streamType: '流媒体视频', pageUrl });
        } else {
          const st = isStreamExt(node.src) ? '流媒体片段' : undefined;
          videos.add({ url: node.src, streamType: st, pageUrl });
        }
      }
      // 检查 video 的 <source> 子元素的 src 属性
      const sources = node.querySelectorAll('source');
      for (let i = 0; i < sources.length; i++) {
        const src = sources[i].src;
        if (src) {
          if (src.startsWith('blob:')) {
            videos.add({ url: src, streamType: '流媒体视频', pageUrl });
          } else {
            const st = isStreamExt(src) ? '流媒体片段' : undefined;
            videos.add({ url: src, streamType: st, pageUrl });
          }
        }
      }
      // 检查 video.currentSrc 属性（对于 MSE 视频）
      if (node.currentSrc && node.currentSrc !== node.src) {
        if (node.currentSrc.startsWith('blob:')) {
          videos.add({ url: node.currentSrc, streamType: '流媒体视频', pageUrl });
        } else {
          const st = isStreamExt(node.currentSrc) ? '流媒体片段' : undefined;
          videos.add({ url: node.currentSrc, streamType: st, pageUrl });
        }
      }
    } else if (tag === 'AUDIO') {
      if (node.src) audios.add({ url: node.src, pageUrl });
      const sources = node.querySelectorAll('source');
      for (let i = 0; i < sources.length; i++) {
        if (sources[i].src) audios.add({ url: sources[i].src, pageUrl });
      }
    } else if (tag === 'A') {
      const href = node.href;
      if (href && !href.startsWith('javascript:') && href !== '#') {
        const linkText = (node.textContent || '').trim().substring(0, 80);
        const dlInfo = identifyDownload(href, node);
        if (dlInfo) {
          downloads.push({
            url: href,
            name: linkText || getFileName(href) || dlInfo.suggestedName,
            text: linkText,
            source: dlInfo.source,
            size: 0,
            pageUrl
          });
        } else {
          links.push({ url: href, name: linkText || getFileName(href), text: linkText });
        }
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
          videos.add({ url: video.src, streamType: '流媒体视频', pageUrl });
        } else {
          const st = isStreamExt(video.src) ? '流媒体片段' : undefined;
          videos.add({ url: video.src, streamType: st, pageUrl });
        }
      }
      if (video.currentSrc && video.currentSrc !== video.src) {
        if (video.currentSrc.startsWith('blob:')) {
          videos.add({ url: video.currentSrc, streamType: '流媒体视频', pageUrl });
        } else {
          const st = isStreamExt(video.currentSrc) ? '流媒体片段' : undefined;
          videos.add({ url: video.currentSrc, streamType: st, pageUrl });
        }
      }
    }
  }

  return { images: [...images], videos: [...videos], audios: [...audios], links, downloads, texts };
}

// === 元素检查模式（融合方案：可视化标记 + 点击预览 + 点击提取） ===
let inspectMode = false;
let highlightEl = null;   // 悬停高亮边框
let selectedEl = null;    // 选中的元素
let mediaBadges = [];     // 媒体元素上的可视化标记
let hoverTooltip = null;  // 悬停提示框

// ===== Task 9: 拾取模式（用于 AI 工作流向导中选择器拾取） =====
let pickerMode = false;          // 是否处于拾取模式
let pickerOverlay = null;        // 拾取模式提示浮层
let pickerResultOverlay = null;  // 拾取结果浮层（显示匹配数 + 确认/取消）
let pickerContextMenu = null;    // 右键工具菜单浮层
let pickerHighlightedEls = [];   // 拾取模式下高亮的所有匹配元素
let pickerCurrentSelector = null; // 当前生成的选择器
let pickerCurrentEl = null;      // 当前拾取的元素
let pickerSelectedEls = [];      // 多元素拾取模式：用户依次点击的元素列表
let pickerSelectedBadges = [];   // 已选元素的角标（× 取消按钮）
let pickerMultiMode = false;     // 多字段模式（末端抓取）：提交时按 multiSelectors 发送

// 生成 CSS 选择器：优先 #id，其次唯一 class 组合，最后 tag + nth-child 路径
function generateSelector(el) {
  if (!el || !el.tagName) return null;
  // 跳过 body/html/document
  if (el === document.body) return 'body';
  if (el === document.documentElement) return 'html';

  // 1. 优先用 id（需唯一）
  if (el.id) {
    try {
      const idCount = document.querySelectorAll('#' + CSS.escape(el.id)).length;
      if (idCount === 1) {
        return '#' + CSS.escape(el.id);
      }
    } catch (e) { /* id 含特殊字符时降级 */ }
  }

  // 2. 用唯一 class 组合
  if (typeof el.className === 'string' && el.className.trim()) {
    const classes = el.className.trim().split(/\s+/);
    if (classes.length > 0) {
      // 尝试用所有 class 组合找到唯一选择器
      try {
        const selector = '.' + classes.map(c => CSS.escape(c)).join('.');
        const matches = document.querySelectorAll(selector);
        if (matches.length === 1) {
          return selector;
        }
      } catch (e) { /* 降级到路径方式 */ }
    }
  }

  // 3. 生成 tag + nth-child 路径
  const parts = [];
  let node = el;
  let depth = 0;
  const MAX_DEPTH = 10;
  while (node && node !== document.body && node !== document.documentElement && depth < MAX_DEPTH) {
    const tag = node.tagName.toLowerCase();
    const parent = node.parentElement;
    if (!parent) {
      parts.unshift(tag);
      break;
    }
    // 计算 nth-child
    let nth = 1;
    let sibling = node.previousElementSibling;
    while (sibling) {
      nth++;
      sibling = sibling.previousElementSibling;
    }
    parts.unshift(tag + ':nth-child(' + nth + ')');
    node = parent;
    depth++;
  }
  if (!parts.length) return el.tagName.toLowerCase();
  // 在路径前加 body 锚点（更稳定）
  if (node === document.body) {
    parts.unshift('body');
  }
  return parts.join(' > ');
}

// ===== Task 9 改进: 多元素智能选择器生成 =====
function findCommonSelector(elements) {
  if (!elements || elements.length === 0) return null;
  if (elements.length === 1) return generateSelector(elements[0]);

  // 1. 找最低公共祖先 (LCA)
  const lca = findLowestCommonAncestor(elements);
  if (!lca) return generateSelector(elements[0]);

  // 验证选择器：用 document.querySelectorAll 确保全局匹配
  function verifySelector(selector) {
    try {
      const matches = document.querySelectorAll(selector);
      if (matches.length < elements.length) return { ok: false, count: matches.length };
      const matchSet = new Set();
      for (let i = 0; i < matches.length; i++) matchSet.add(matches[i]);
      for (const el of elements) {
        if (!matchSet.has(el)) return { ok: false, count: matches.length };
      }
      return { ok: true, count: matches.length };
    } catch (e) {
      return { ok: false, count: 0 };
    }
  }

  // 2. 尝试共同 class
  const commonClasses = findCommonClasses(elements);
  if (commonClasses.length > 0) {
    const selector = '.' + commonClasses.map(c => CSS.escape(c)).join('.');
    const v = verifySelector(selector);
    if (v.ok) return selector;
  }

  // 3. 尝试共同 data-属性
  const commonDataAttrs = findCommonDataAttributes(elements);
  if (commonDataAttrs.length > 0) {
    for (const {attr, value} of commonDataAttrs) {
      const selector = `[${CSS.escape(attr)}="${CSS.escape(value)}"]`;
      const v = verifySelector(selector);
      if (v.ok) return selector;
    }
  }

  // 4. 尝试共同标签名 + 共同 class
  const tag = elements[0].tagName.toLowerCase();
  const sameTag = elements.every(el => el.tagName.toLowerCase() === tag);
  if (sameTag && commonClasses.length > 0) {
    const selector = tag + '.' + commonClasses.map(c => CSS.escape(c)).join('.');
    const v = verifySelector(selector);
    if (v.ok) return selector;
  }

  // 5. 尝试共同父元素 + 子元素标签
  const parents = elements.map(el => el.parentElement);
  const sameParent = parents.every(p => p === parents[0]);
  if (sameParent && parents[0]) {
    const parentSelector = generateSelector(parents[0]);
    if (sameTag) {
      const selector = parentSelector + ' > ' + tag;
      const v = verifySelector(selector);
      if (v.ok) return selector;
    }
  }

  // 6. 尝试 LCA 的直接子元素模式
  const paths = elements.map(el => getPathFromLCA(el, lca));
  if (paths.every(p => p.length === 1) && sameTag) {
    const lcaSelector = generateSelector(lca);
    const selector = lcaSelector + ' > ' + tag;
    const v = verifySelector(selector);
    if (v.ok) return selector;
  }

  // 7. 尝试共同 class 组合的子集（去掉一些 class 使选择器更通用）
  if (commonClasses.length > 1) {
    // 尝试去掉最后一个 class
    for (let i = commonClasses.length - 1; i >= 1; i--) {
      const subset = commonClasses.slice(0, i);
      const selector = '.' + subset.map(c => CSS.escape(c)).join('.');
      const v = verifySelector(selector);
      if (v.ok) return selector;
    }
  }

  // 8. 降级：使用 LCA 选择器 + 路径
  const lcaSelector = generateSelector(lca);
  const firstPath = getPathFromLCA(elements[0], lca);
  if (firstPath.length > 0) {
    const pathSelector = firstPath.map((step, i) => {
      if (i === firstPath.length - 1) {
        const siblings = Array.from(step.parentElement.children).filter(c => c.tagName === step.tagName);
        const idx = siblings.indexOf(step) + 1;
        return step.tagName.toLowerCase() + ':nth-of-type(' + idx + ')';
      }
      return step.tagName.toLowerCase();
    }).join(' > ');
    return lcaSelector + ' ' + pathSelector;
  }

  return generateSelector(elements[0]);
}

// 滚动页面到底部，触发懒加载（不自动滚回顶部，由调用方决定）
// options: { maxScrolls: 最大滚动次数(默认30), maxTimeMs: 最大耗时ms(默认15000), onProgress: 进度回调 }
async function scrollPageToBottom(options) {
  options = options || {};
  const scrollDelay = 300;
  const maxScrolls = options.maxScrolls || 30;
  const maxTimeMs = options.maxTimeMs || 15000;
  const onProgress = options.onProgress || null;
  let lastHeight = document.body.scrollHeight;
  let stableCount = 0;
  let scrollCount = 0;
  const startTime = Date.now();
  while (stableCount < 3 && scrollCount < maxScrolls && (Date.now() - startTime) < maxTimeMs) {
    window.scrollTo(0, document.body.scrollHeight);
    await new Promise(r => setTimeout(r, scrollDelay));
    scrollCount++;
    const newHeight = document.body.scrollHeight;
    if (onProgress) onProgress({ scrollCount, height: newHeight, stable: false });
    if (newHeight === lastHeight) {
      stableCount++;
    } else {
      stableCount = 0;
      lastHeight = newHeight;
    }
  }
  if (onProgress) onProgress({ scrollCount, height: document.body.scrollHeight, stable: true, stopped: stableCount >= 3 || scrollCount >= maxScrolls || (Date.now() - startTime) >= maxTimeMs });
}

function findLowestCommonAncestor(elements) {
  if (elements.length === 0) return null;
  if (elements.length === 1) return elements[0].parentElement;

  // 获取第一个元素的所有祖先
  const ancestors = new Set();
  let node = elements[0];
  while (node) {
    ancestors.add(node);
    node = node.parentElement;
  }

  // 从第二个元素开始向上找，第一个出现在 ancestors 中的就是 LCA
  for (let i = 1; i < elements.length; i++) {
    node = elements[i];
    while (node) {
      if (ancestors.has(node)) return node;
      node = node.parentElement;
    }
  }
  return document.body;
}

function findCommonClasses(elements) {
  if (elements.length === 0) return [];
  const classSets = elements.map(el => {
    if (typeof el.className === 'string' && el.className.trim()) {
      return new Set(el.className.trim().split(/\s+/));
    }
    return new Set();
  });
  let common = new Set(classSets[0]);
  for (let i = 1; i < classSets.length; i++) {
    for (const cls of common) {
      if (!classSets[i].has(cls)) common.delete(cls);
    }
  }
  // 过滤掉太通用的 class
  const genericClasses = new Set(['active', 'selected', 'current', 'open', 'show', 'hide', 'hidden', 'visible', 'disabled', 'enabled', 'focus', 'hover']);
  for (const cls of common) {
    if (genericClasses.has(cls)) common.delete(cls);
  }
  return [...common];
}

function findCommonDataAttributes(elements) {
  if (elements.length === 0) return [];
  const results = [];
  const firstEl = elements[0];
  for (let i = 0; i < firstEl.attributes.length; i++) {
    const attr = firstEl.attributes[i];
    if (attr.name.startsWith('data-')) {
      const allSame = elements.every(el => el.getAttribute(attr.name) === attr.value);
      if (allSame && attr.value) {
        results.push({ attr: attr.name, value: attr.value });
      }
    }
  }
  return results;
}

function getPathFromLCA(el, lca) {
  const path = [];
  let node = el;
  while (node && node !== lca) {
    path.unshift(node);
    node = node.parentElement;
  }
  return path;
}

// 创建/显示拾取模式提示浮层
function showPickerOverlay() {
  if (!pickerOverlay) {
    pickerOverlay = document.createElement('div');
    pickerOverlay.style.cssText = `
      position: fixed;
      top: 12px;
      left: 50%;
      transform: translateX(-50%);
      padding: 8px 16px;
      background: rgba(15,15,26,0.95);
      color: #ffd54f;
      border: 1px solid #ffd54f;
      border-radius: 6px;
      font-size: 13px;
      z-index: 1000000;
      pointer-events: none;
      box-shadow: 0 2px 8px rgba(0,0,0,0.5);
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
    `;
    document.body.appendChild(pickerOverlay);
  }
  pickerOverlay.textContent = '🎯 拾取模式：点击元素生成选择器（ESC 退出）';
  pickerOverlay.style.display = 'block';
}

function hidePickerOverlay() {
  if (pickerOverlay) pickerOverlay.style.display = 'none';
}

// 清除所有拾取高亮（仅清除 outline，不清除角标）
function clearPickerHighlights() {
  for (const el of pickerHighlightedEls) {
    try {
      if (el && el.style) {
        el.style.outline = el._pickerOriginalOutline || '';
        delete el._pickerOriginalOutline;
      }
    } catch (e) { /* ignore */ }
  }
  pickerHighlightedEls = [];
}

// 给已选元素添加 × 取消角标
function addPickerSelectedBadge(el, index) {
  try {
    const badge = document.createElement('div');
    badge.className = '__wsw_picker_badge__';
    badge.textContent = '×';
    badge.dataset.index = index;
    badge.style.cssText = `
      position: absolute; top: -8px; right: -8px;
      width: 20px; height: 20px; border-radius: 50%;
      background: #ef5350; color: #fff; font-size: 14px;
      display: flex; align-items: center; justify-content: center;
      cursor: pointer; z-index: 1000001; font-weight: 700;
      box-shadow: 0 1px 4px rgba(0,0,0,0.4);
      pointer-events: auto; line-height: 1;
    `;
    badge.onclick = (e) => {
      e.preventDefault();
      e.stopPropagation();
      removePickerSelectedEl(index);
    };
    // 确保父元素有 position
    const parent = el.offsetParent || document.body;
    const rect = el.getBoundingClientRect();
    const parentRect = parent.getBoundingClientRect();
    badge.style.left = (rect.right - parentRect.left - 8) + 'px';
    badge.style.top = (rect.top - parentRect.top - 8) + 'px';
    parent.style.position = parent.style.position || 'relative';
    parent.appendChild(badge);
    pickerSelectedBadges.push(badge);
  } catch (e) { /* ignore */ }
}

function clearPickerSelectedBadges() {
  for (const badge of pickerSelectedBadges) {
    try { badge.remove(); } catch (e) {}
  }
  pickerSelectedBadges = [];
}

// 取消某个已选元素
function removePickerSelectedEl(index) {
  if (index < 0 || index >= pickerSelectedEls.length) return;
  const el = pickerSelectedEls[index];
  // 清除该元素的高亮
  try {
    if (el && el.style) {
      el.style.outline = el._pickerOriginalOutline || '';
      delete el._pickerOriginalOutline;
    }
  } catch (e) {}
  // 从数组中移除
  pickerSelectedEls.splice(index, 1);
  // 重建角标
  clearPickerSelectedBadges();
  pickerSelectedEls.forEach((selEl, i) => addPickerSelectedBadge(selEl, i));
  // 重新生成选择器
  clearPickerHighlights();
  hidePickerResultOverlay();
  if (pickerSelectedEls.length === 0) {
    pickerCurrentSelector = null;
    pickerCurrentEl = null;
    if (pickerOverlay) {
      pickerOverlay.textContent = '🎯 拾取模式：点击元素生成选择器（ESC 退出）';
    }
  } else if (pickerSelectedEls.length === 1) {
    pickerCurrentSelector = null;
    pickerCurrentEl = null;
    const target = pickerSelectedEls[0];
    target._pickerOriginalOutline = target.style.outline;
    target.style.outline = '2px solid #4caf50';
    pickerHighlightedEls.push(target);
    if (pickerOverlay) {
      pickerOverlay.textContent = `🎯 已选 1 个元素，继续点击同类元素（最多5个），或按 Enter 确认`;
    }
  } else {
    const selector = findCommonSelector(pickerSelectedEls);
    if (selector) {
      pickerCurrentSelector = selector;
      pickerCurrentEl = pickerSelectedEls[0];
      let matchCount = 0;
      try {
        const matches = document.querySelectorAll(selector);
        matchCount = matches.length;
        matches.forEach(m => {
          m._pickerOriginalOutline = m.style.outline;
          m.style.outline = '2px solid #ff5252';
          pickerHighlightedEls.push(m);
        });
      } catch (err) {}
      showPickerResultOverlay(selector, matchCount, pickerSelectedEls[0], pickerSelectedEls.length);
    }
  }
}

// 显示拾取结果浮层（匹配 N 个元素 + 确认/取消按钮）
function showPickerResultOverlay(selector, matchCount, sampleEl, selectedCount) {
  hidePickerResultOverlay();
  pickerResultOverlay = document.createElement('div');
  pickerResultOverlay.style.cssText = `
    position: fixed;
    bottom: 24px;
    left: 50%;
    transform: translateX(-50%);
    padding: 12px 18px;
    background: rgba(15,15,26,0.97);
    color: #e0e0e0;
    border: 1px solid #00d2ff;
    border-radius: 8px;
    font-size: 13px;
    z-index: 1000000;
    box-shadow: 0 4px 16px rgba(0,0,0,0.6);
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
    max-width: 90vw;
    display: flex;
    align-items: center;
    gap: 14px;
  `;

  const info = document.createElement('div');
  const infoText = selectedCount > 1 ? `基于 ${selectedCount} 个元素生成` : '';
  info.innerHTML = `<div style="font-weight:600;color:#00d2ff;margin-bottom:4px;">匹配 <span style="font-size:15px;">${matchCount}</span> 个元素 ${infoText ? '<span style="font-size:11px;color:#8888aa;">(' + infoText + ')</span>' : ''}</div>` +
    `<div style="font-size:11px;color:#8888aa;max-width:420px;word-break:break-all;white-space:normal;">${escapeHtmlForPicker(selector)}</div>`;
  pickerResultOverlay.appendChild(info);

  const btns = document.createElement('div');
  btns.style.cssText = 'display:flex;gap:8px;flex-shrink:0;flex-wrap:wrap;';

  // "滚动到底"按钮：触发懒加载后重新匹配（支持停止）
  const scrollBtn = document.createElement('button');
  scrollBtn.textContent = '⬇ 滚动到底';
  scrollBtn.style.cssText = 'padding:6px 14px;background:transparent;color:#ffa726;border:1px solid #ffa726;border-radius:4px;cursor:pointer;font-size:12px;';
  let scrollAborted = false;
  scrollBtn.onclick = async (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (scrollBtn.dataset.scrolling === '1') {
      // 第二次点击 = 停止滚动
      scrollAborted = true;
      scrollBtn.textContent = ' 滚动到底';
      scrollBtn.dataset.scrolling = '0';
      return;
    }
    scrollAborted = false;
    scrollBtn.textContent = '⏹ 点击停止';
    scrollBtn.dataset.scrolling = '1';
    await scrollPageToBottom({
      maxScrolls: 50,
      maxTimeMs: 20000,
      onProgress: ({ scrollCount, height }) => {
        scrollBtn.textContent = `⏳ 滚动 ${scrollCount} 次...`;
        if (scrollAborted) throw new Error('aborted');
      }
    }).catch(() => {});
    scrollBtn.textContent = '⬇ 滚动到底';
    scrollBtn.dataset.scrolling = '0';
    // 滚回顶部，方便用户全局选取
    window.scrollTo(0, 0);
    // 重新匹配
    const newSelector = findCommonSelector(pickerSelectedEls);
    if (newSelector) {
      pickerCurrentSelector = newSelector;
      clearPickerHighlights();
      hidePickerResultOverlay();
      // 高亮新匹配
      let newCount = 0;
      try {
        const matches = document.querySelectorAll(newSelector);
        newCount = matches.length;
        matches.forEach(el => {
          el._pickerOriginalOutline = el.style.outline;
          el.style.outline = '2px solid #ff5252';
          pickerHighlightedEls.push(el);
        });
      } catch (err) {}
      showPickerResultOverlay(newSelector, newCount, pickerSelectedEls[0], pickerSelectedEls.length);
    }
  };
  btns.appendChild(scrollBtn);

  // 如果 selectedCount < 5，添加"继续添加"按钮
  if (selectedCount < 5) {
    const addBtn = document.createElement('button');
    addBtn.textContent = '+ 继续添加';
    addBtn.style.cssText = 'padding:6px 14px;background:transparent;color:#4caf50;border:1px solid #4caf50;border-radius:4px;cursor:pointer;font-size:12px;';
    addBtn.onclick = (e) => {
      e.preventDefault();
      e.stopPropagation();
      clearPickerHighlights();
      hidePickerResultOverlay();
      pickerCurrentSelector = null;
      pickerCurrentEl = null;
      if (pickerOverlay) {
        pickerOverlay.textContent = `🎯 已选 ${selectedCount} 个元素，继续点击同类元素，或按 Enter 确认`;
      }
    };
    btns.appendChild(addBtn);
  }

  const confirmBtn = document.createElement('button');
  confirmBtn.textContent = '✓ 确认';
  confirmBtn.style.cssText = 'padding:6px 14px;background:#00d2ff;color:#0f0f1a;border:none;border-radius:4px;cursor:pointer;font-size:12px;font-weight:600;';
  confirmBtn.onclick = (e) => {
    e.preventDefault();
    e.stopPropagation();
    confirmPickerResult(selector, sampleEl);
  };

  const cancelBtn = document.createElement('button');
  cancelBtn.textContent = '✗ 重选';
  cancelBtn.style.cssText = 'padding:6px 14px;background:transparent;color:#e0e0e0;border:1px solid #555;border-radius:4px;cursor:pointer;font-size:12px;';
  cancelBtn.onclick = (e) => {
    e.preventDefault();
    e.stopPropagation();
    clearPickerHighlights();
    hidePickerResultOverlay();
    pickerCurrentSelector = null;
    pickerCurrentEl = null;
    pickerSelectedEls = [];
    // 发送取消信号，让wizard回调正常触发
    ipcRenderer.send('picker-result', null);
    // 必须退出picker模式，移除事件监听器，否则后续点击会触发picker逻辑导致闪退
    exitPickerModeInternal();
  };

  btns.appendChild(confirmBtn);
  btns.appendChild(cancelBtn);
  pickerResultOverlay.appendChild(btns);

  document.body.appendChild(pickerResultOverlay);
}

function hidePickerResultOverlay() {
  if (pickerResultOverlay) {
    pickerResultOverlay.remove();
    pickerResultOverlay = null;
  }
}

function escapeHtmlForPicker(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// 确认拾取结果：发送给主进程并退出拾取模式
// multiMode=true 时按 multiSelectors 模式提交（每个已选元素一个独立 selector，用于末端抓取多字段场景）
function confirmPickerResult(selector, sampleEl, multiMode) {
  // ===== multiSelectors 模式：每个已选元素生成一个独立 selector =====
  if (multiMode && pickerSelectedEls.length > 0) {
    const multiSelectors = [];
    const previews = [];
    pickerSelectedEls.forEach((el, idx) => {
      const sel = generateSelector(el);
      if (!sel) return;
      multiSelectors.push({ selector: sel, index: idx });
      const text = (el.textContent || '').trim().slice(0, 200);
      const href = el.getAttribute('href') || '';
      previews.push({
        index: idx,
        tag: (el.tagName || '').toLowerCase(),
        text: text,
        href: href,
        class: (typeof el.className === 'string' ? el.className : '') || ''
      });
    });
    ipcRenderer.send('picker-result', {
      selector: multiSelectors[0] ? multiSelectors[0].selector : selector,
      multiSelectors: multiSelectors,
      sample: previews[0] ? { text: previews[0].text, tagName: previews[0].tag } : null,
      matchCount: multiSelectors.length,
      previews: previews
    });
    pickerSelectedEls = [];
    exitPickerModeInternal();
    return;
  }

  let sample = null;
  if (sampleEl) {
    const attrs = {};
    if (sampleEl.attributes) {
      for (let i = 0; i < sampleEl.attributes.length; i++) {
        const a = sampleEl.attributes[i];
        attrs[a.name] = a.value;
      }
    }
    sample = {
      text: (sampleEl.textContent || '').slice(0, 200),
      html: sampleEl.outerHTML ? sampleEl.outerHTML.slice(0, 500) : '',
      attrs: attrs,
      tagName: (sampleEl.tagName || '').toLowerCase()
    };
  }

  // 从当前页面提取匹配元素的预览数据（包含超链接）
  let previews = [];
  let matchCount = 0;
  try {
    const els = document.querySelectorAll(selector);
    matchCount = els.length;
    const maxPreview = Math.min(matchCount, 20);
    for (let i = 0; i < maxPreview; i++) {
      const el = els[i];
      const text = (el.textContent || '').trim().slice(0, 200);
      const href = el.getAttribute('href') || '';
      const tag = el.tagName.toLowerCase();
      const cls = (typeof el.className === 'string' ? el.className : '') || '';

      // 提取子元素中的超链接（增强：去重 + 绝对 URL + 向上找祖先<a> + 元素自身 + area + data-href，上限 50）
      const childLinks = [];
      const seenHref = {};
      const pushLink = (node) => {
        try {
          const href = node.href || node.getAttribute('href') || '';
          if (!href || href === '#' || href.indexOf('javascript:') === 0) return;
          if (seenHref[href]) return;
          seenHref[href] = true;
          const text = (node.textContent || '').trim().slice(0, 120);
          childLinks.push({ href: href, text: text });
        } catch (e) {}
      };
      // 0. 向上查找最近的 <a href> 祖先（百度新闻等：拾取到 <span>，链接在父 <a> 上）
      let p = el.parentElement;
      while (p) {
        if (p.tagName && p.tagName.toLowerCase() === 'a' && p.getAttribute('href')) {
          pushLink(p);
          break;
        }
        p = p.parentElement;
      }
      // 1. 元素自身是 <a>
      if (el.tagName && el.tagName.toLowerCase() === 'a' && el.getAttribute('href')) {
        pushLink(el);
      }
      // 2. 后代 <a href>
      const links = el.querySelectorAll('a[href]');
      for (let j = 0; j < links.length && childLinks.length < 50; j++) {
        pushLink(links[j]);
      }
      // 3. <area href>（图片热点）
      const areas = el.querySelectorAll('area[href]');
      for (let k = 0; k < areas.length && childLinks.length < 50; k++) {
        pushLink(areas[k]);
      }
      // 4. data-href / data-url
      const dataEls = el.querySelectorAll('[data-href], [data-url]');
      for (let m = 0; m < dataEls.length && childLinks.length < 50; m++) {
        const de = dataEls[m];
        const dhref = de.getAttribute('data-href') || de.getAttribute('data-url') || '';
        if (dhref && /^https?:|^\/\//.test(dhref) && !seenHref[dhref]) {
          seenHref[dhref] = true;
          const dtext = (de.textContent || '').trim().slice(0, 120);
          childLinks.push({ href: dhref, text: dtext });
        }
      }

      previews.push({
        index: i,
        tag: tag,
        text: text,
        href: href,
        class: cls,
        childLinks: childLinks
      });
    }
  } catch (e) {
    console.error('提取预览失败:', e);
  }

  ipcRenderer.send('picker-result', {
    selector: selector,
    sample: sample,
    matchCount: matchCount,
    previews: previews
  });
  pickerSelectedEls = [];  // 清理多选状态
  exitPickerModeInternal();
}

// 内部退出拾取模式（不发送 null，仅清理 UI 状态）
function exitPickerModeInternal() {
  pickerMode = false;
  pickerMultiMode = false;
  try { ipcRenderer.send('picker-mode-changed', false); } catch (e) {}
  clearPickerHighlights();
  clearPickerSelectedBadges();
  hidePickerOverlay();
  hidePickerResultOverlay();
  hidePickerContextMenu();
  pickerCurrentSelector = null;
  pickerCurrentEl = null;
  pickerSelectedEls = [];  // 清理多选状态
  document.body.style.cursor = '';
}

// 进入拾取模式
function enterPickerModeInternal() {
  pickerMode = true;
  try { ipcRenderer.send('picker-mode-changed', true); } catch (e) {}
  // 如果当前在 inspect 模式，先退出（避免冲突）
  if (inspectMode) {
    inspectMode = false;
    hideHighlight();
    hideTooltip();
    clearSelected();
    removeMediaBadges();
    document.body.style.cursor = '';
  }
  document.body.style.cursor = 'crosshair';
  showPickerOverlay();
}

// 监听主进程的拾取模式指令
ipcRenderer.on('enter-picker-mode', () => {
  enterPickerModeInternal();
});

ipcRenderer.on('exit-picker-mode', () => {
  // 主进程要求退出，发送 null 表示取消
  if (pickerMode) {
    ipcRenderer.send('picker-result', null);
    exitPickerModeInternal();
  }
});

// ===== 右键工具菜单（picker 模式下） =====
// 阻止默认右键菜单，弹出工具菜单：复数选取/清空/完成/退出
document.addEventListener('contextmenu', (e) => {
  if (!pickerMode) return;
  e.preventDefault();
  e.stopPropagation();
  // 点击的是浮层内元素，不弹出工具菜单
  if (pickerResultOverlay && (pickerResultOverlay === e.target || pickerResultOverlay.contains(e.target))) return;
  if (pickerContextMenu && (pickerContextMenu === e.target || pickerContextMenu.contains(e.target))) return;
  showPickerContextMenu(e.clientX, e.clientY);
}, true);

function hidePickerContextMenu() {
  if (pickerContextMenu) {
    pickerContextMenu.remove();
    pickerContextMenu = null;
  }
}

function showPickerContextMenu(x, y) {
  hidePickerContextMenu();
  const menu = document.createElement('div');
  menu.style.cssText = `
    position: fixed;
    left: ${x}px;
    top: ${y}px;
    background: rgba(15,15,26,0.98);
    color: #e0e0e0;
    border: 1px solid #00d2ff;
    border-radius: 6px;
    padding: 4px 0;
    font-size: 13px;
    z-index: 1000002;
    box-shadow: 0 4px 16px rgba(0,0,0,0.6);
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
    min-width: 220px;
  `;
  const selectedCount = pickerSelectedEls.length;
  const hasSelection = selectedCount > 0;

  const items = [
    {
      label: '🎯 复数选取（自动匹配同类）',
      hint: hasSelection ? `基于已选 ${selectedCount} 个元素生成共同选择器` : '需先左键选取 1+ 个元素',
      enabled: hasSelection,
      onClick: () => {
        if (!hasSelection) return;
        // 用 findCommonSelector 生成共同选择器并高亮所有匹配
        const selector = findCommonSelector(pickerSelectedEls);
        if (!selector) {
          if (pickerOverlay) pickerOverlay.textContent = '⚠ 无法生成共同选择器，请多选几个同类元素';
          return;
        }
        pickerCurrentSelector = selector;
        pickerCurrentEl = pickerSelectedEls[0];
        clearPickerHighlights();
        let matchCount = 0;
        try {
          const matches = document.querySelectorAll(selector);
          matchCount = matches.length;
          matches.forEach(el => {
            el._pickerOriginalOutline = el.style.outline;
            el.style.outline = '2px solid #ff5252';
            pickerHighlightedEls.push(el);
          });
        } catch (err) {}
        showPickerResultOverlay(selector, matchCount, pickerSelectedEls[0], pickerSelectedEls.length);
        if (pickerOverlay) {
          pickerOverlay.textContent = `🎯 复数选取：匹配 ${matchCount} 个元素（基于 ${selectedCount} 个已选）`;
        }
      }
    },
    {
      label: '✓ 完成选取（多字段模式）',
      hint: hasSelection ? `将 ${selectedCount} 个元素作为独立字段提交` : '需先左键选取 1+ 个元素',
      enabled: hasSelection,
      onClick: () => {
        if (!hasSelection) return;
        // 多字段模式：每个已选元素一个独立 selector
        confirmPickerResult(null, pickerSelectedEls[0], true);
      }
    },
    {
      label: '✓ 完成选取（单选择器）',
      hint: pickerCurrentSelector ? '提交当前共同选择器' : (hasSelection ? '基于已选元素生成选择器并提交' : '需先选取元素'),
      enabled: hasSelection,
      onClick: () => {
        if (!hasSelection) return;
        let sel = pickerCurrentSelector;
        let sample = pickerSelectedEls[0];
        if (!sel) {
          if (pickerSelectedEls.length === 1) {
            sel = generateSelector(pickerSelectedEls[0]);
          } else {
            sel = findCommonSelector(pickerSelectedEls);
          }
        }
        if (sel) confirmPickerResult(sel, sample, false);
      }
    },
    {
      label: '🗑 清空已选',
      hint: hasSelection ? `清除 ${selectedCount} 个已选元素` : '当前无已选元素',
      enabled: hasSelection,
      onClick: () => {
        clearPickerHighlights();
        clearPickerSelectedBadges();
        hidePickerResultOverlay();
        pickerSelectedEls = [];
        pickerCurrentSelector = null;
        pickerCurrentEl = null;
        if (pickerOverlay) {
          pickerOverlay.textContent = '🎯 拾取模式：点击元素生成选择器（ESC 退出，右键工具菜单）';
        }
      }
    },
    {
      label: '✗ 退出拾取',
      hint: '取消并退出拾取模式',
      enabled: true,
      onClick: () => {
        ipcRenderer.send('picker-result', null);
        exitPickerModeInternal();
      }
    }
  ];

  items.forEach(item => {
    const row = document.createElement('div');
    row.style.cssText = `
      padding: 8px 14px;
      cursor: ${item.enabled ? 'pointer' : 'not-allowed'};
      color: ${item.enabled ? '#e0e0e0' : '#555'};
      border-bottom: 1px solid rgba(255,255,255,0.05);
      transition: background 0.15s;
    `;
    if (item.enabled) {
      row.addEventListener('mouseenter', () => { row.style.background = 'rgba(0,210,255,0.15)'; });
      row.addEventListener('mouseleave', () => { row.style.background = ''; });
    }
    row.innerHTML = `
      <div style="font-weight:600;">${item.label}</div>
      <div style="font-size:11px;color:#8888aa;margin-top:2px;">${item.hint}</div>
    `;
    row.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      hidePickerContextMenu();
      if (item.enabled) {
        try { item.onClick(); } catch (err) { console.error('picker menu action failed:', err); }
      }
    });
    menu.appendChild(row);
  });

  document.body.appendChild(menu);
  pickerContextMenu = menu;

  // 防止菜单超出视口
  const rect = menu.getBoundingClientRect();
  if (rect.right > window.innerWidth) {
    menu.style.left = (window.innerWidth - rect.width - 8) + 'px';
  }
  if (rect.bottom > window.innerHeight) {
    menu.style.top = (window.innerHeight - rect.height - 8) + 'px';
  }
}

// 点击菜单外区域关闭工具菜单
document.addEventListener('click', (e) => {
  if (!pickerContextMenu) return;
  if (pickerContextMenu === e.target || pickerContextMenu.contains(e.target)) return;
  hidePickerContextMenu();
}, true);


// 提取元素资源（用于预览）
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

// 鼠标移动时仅高亮 + 显示提示（不发送预览，预览由点击触发）
let hoverDebounce = null;
document.addEventListener('mousemove', (e) => {
  if (!inspectMode) return;
  const target = e.target;
  if (target === highlightEl || target === hoverTooltip || target.classList.contains('__ws_badge')) return;
  // 空白区域（body/html/document）不高亮
  if (target === document.body || target === document.documentElement || target === document) {
    hideHighlight();
    hideTooltip();
    return;
  }
  updateHighlight(target);
  // 提示框稍作延迟避免闪烁
  clearTimeout(hoverDebounce);
  hoverDebounce = setTimeout(() => {
    showTooltip(target, e.clientX, e.clientY);
  }, 200);
}, true);

// 鼠标离开窗口时清除高亮和提示
document.addEventListener('mouseleave', () => {
  if (!inspectMode) return;
  hideHighlight();
  hideTooltip();
}, true);

// 点击事件处理
document.addEventListener('click', (e) => {
  // ===== Task 9 改进: 拾取模式支持多元素选择 =====
  if (pickerMode) {
    const target = e.target;
    // 放行：结果浮层内的按钮（让它们的 onclick 触发）
    if (pickerResultOverlay && (pickerResultOverlay === target || pickerResultOverlay.contains(target))) {
      return;
    }
    // 放行：工具菜单内的点击（让菜单项 onclick 触发）
    if (pickerContextMenu && (pickerContextMenu === target || pickerContextMenu.contains(target))) {
      return;
    }
    // 放行：角标 × 取消按钮（让 onclick 触发 removePickerSelectedEl）
    if (target.classList && target.classList.contains('__wsw_picker_badge__')) return;
    if (target.closest && target.closest('.__wsw_picker_badge__')) return;
    // 跳过浮层和高亮元素（不处理但也不阻止默认）
    if (target === pickerOverlay || target === pickerResultOverlay || target === highlightEl) return;
    // 跳过 body/html
    if (target === document.body || target === document.documentElement || target === document) return;

    // 剩下的点击：阻止默认行为并处理选取
    e.preventDefault();
    e.stopPropagation();

    // 清除上一次的高亮（保留已选元素的绿色边框）
    clearPickerHighlights();
    hidePickerResultOverlay();
    hidePickerContextMenu();

    // 累积选中的元素（最多20个，支持更多字段）
    if (!pickerSelectedEls.includes(target)) {
      if (pickerSelectedEls.length >= 20) {
        if (pickerOverlay) pickerOverlay.textContent = '⚠ 已达上限 20 个元素，请右键完成选取或清空';
        return;
      }
      pickerSelectedEls.push(target);
      // 添加取消角标
      addPickerSelectedBadge(target, pickerSelectedEls.length - 1);
    }

    // 高亮所有已选元素（绿色边框表示已选）
    pickerSelectedEls.forEach(el => {
      el._pickerOriginalOutline = el.style.outline;
      el.style.outline = '2px solid #4caf50';
      pickerHighlightedEls.push(el);
    });

    // 更新顶部提示：引导用户使用右键菜单
    if (pickerOverlay) {
      const n = pickerSelectedEls.length;
      pickerOverlay.textContent = `🎯 已选 ${n} 个元素（左键继续选取 / 右键工具菜单：复数选取·完成·清空）`;
    }
    return;
  }

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
      // 发送点击预览数据
      const tag = linkTarget.tagName.toLowerCase();
      const id = linkTarget.id ? '#' + linkTarget.id : '';
      const cls = linkTarget.className && typeof linkTarget.className === 'string'
        ? '.' + linkTarget.className.trim().split(/\s+/).slice(0, 2).join('.') : '';
      const textPreview = (linkTarget.textContent || '').replace(/\s+/g, ' ').trim().substring(0, 80);
      ipcRenderer.send('element-hover-preview', {
        element: {
          tagName: linkTarget.tagName, id: linkTarget.id,
          className: typeof linkTarget.className === 'string' ? linkTarget.className : '',
          textContent: textPreview
        },
        selector: `<${tag}${id}${cls}>`,
        counts: counts,
        textPreview: textPreview,
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

  // 发送点击预览数据
  const tag = target.tagName.toLowerCase();
  const id = target.id ? '#' + target.id : '';
  const cls = target.className && typeof target.className === 'string'
    ? '.' + target.className.trim().split(/\s+/).slice(0, 2).join('.') : '';
  const textPreview = (target.textContent || '').replace(/\s+/g, ' ').trim().substring(0, 80);

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

  // 发送点击预览数据到悬停预览栏
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
}, true);

// ESC退出检查模式或拾取模式，Enter确认拾取
document.addEventListener('keydown', (e) => {
  // 拾取模式下 Enter 确认
  if (pickerMode && e.key === 'Enter') {
    e.preventDefault();
    if (pickerSelectedEls.length === 0) return;
    // 新流程：Enter 默认按"多字段模式"提交（每个已选元素一个独立 selector）
    // 如果用户已通过右键"复数选取"生成了共同 selector，则按单选择器提交
    if (pickerCurrentSelector) {
      confirmPickerResult(pickerCurrentSelector, pickerCurrentEl, false);
    } else {
      confirmPickerResult(null, pickerSelectedEls[0], true);
    }
    return;
  }

  if (e.key !== 'Escape') return;

  // 优先处理拾取模式
  if (pickerMode) {
    // 退出拾取模式并发送 null 表示取消
    ipcRenderer.send('picker-result', null);
    exitPickerModeInternal();
    return;
  }

  if (inspectMode) {
    inspectMode = false;
    hideHighlight();
    hideTooltip();
    clearSelected();
    removeMediaBadges();
    document.body.style.cursor = '';
    ipcRenderer.send('element-hover-clear');
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
    // 确保高亮元素完全移除
    if (highlightEl) {
      highlightEl.style.display = 'none';
      highlightEl.style.outline = '';
    }
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

// 页面加载完成后自动提取（同时支持主进程 did-finish-load 触发的 extract-all）
function autoExtract() {
  setTimeout(() => {
    checkPerformanceEntries();
    const resources = extractAllResources();
    ipcRenderer.send('resources-extracted', resources);
    ipcRenderer.send('page-title', document.title);
  }, 1000);
}

if (document.readyState === 'complete') {
  autoExtract();
} else {
  window.addEventListener('load', autoExtract);
}

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
