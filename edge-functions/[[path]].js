export default async function onRequest(context) {
  const { request } = context;
  const url = new URL(request.url);

  // 1. 处理 TV 端播放器特有的 OPTIONS 跨域预检
  if (request.method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET, HEAD, POST, OPTIONS",
        "Access-Control-Allow-Headers": "*",
        "Access-Control-Max-Age": "86400",
      }
    });
  }

  // =====================================================================
  // 核心路由配置表 (可以随时在这里新增更多源)
  // =====================================================================
  const ROUTE_MAP = {
    // 前两个源的代理前缀刚好等于真实文件夹路径，不需要 strip
    '/live/': { target: 'https://video10.letaocm.top', referer: 'https://688zb24.com/' },
    '/ssports/': { target: 'https://hls.zb.ssports.com', referer: 'https://shinaisports.com/' },
    // 新增的源为了防止和上面重名冲突，使用了自定义前缀 /qinl/，需要 strip: true 抹去该前缀
    '/qinl/': { target: 'https://qinl-play.agiaexpress.com', referer: 'https://www.hbzb27.com/', strip: true }
  };

  // =====================================================================
  // 路由 A：专门处理 M3U8 内部的 TS 切片代理
  // =====================================================================
  if (url.pathname === "/ts_proxy") {
    const actualTsUrl = url.searchParams.get("url");
    const routeKey = url.searchParams.get("route"); // 获取此切片所属的路由前缀
    
    if (!actualTsUrl) return new Response("Missing TS URL", { status: 400 });

    // 根据传入的 routeKey 找到对应的 referer，防错兜底
    const config = ROUTE_MAP[routeKey] || { referer: "https://shinaisports.com/" };

    const tsHeaders = new Headers();
    tsHeaders.set("Referer", config.referer);
    tsHeaders.set("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36");

    try {
      // 代理请求真实的 TS 切片
      const tsResponse = await fetch(actualTsUrl, { method: "GET", headers: tsHeaders });
      const responseHeaders = new Headers(tsResponse.headers);
      responseHeaders.set("Access-Control-Allow-Origin", "*");
      
      return new Response(tsResponse.body, { status: tsResponse.status, headers: responseHeaders });
    } catch (e) {
      return new Response("TS Proxy Error", { status: 500 });
    }
  }

  // =====================================================================
  // 路由 B：处理主 M3U8 入口请求
  // =====================================================================
  
  // 匹配请求路径是否在我们定义的路由表里
  let matchedRoute = Object.keys(ROUTE_MAP).find(path => url.pathname.startsWith(path));

  if (!matchedRoute) {
    return new Response("Route Not Found or Invalid Path", { status: 404 });
  }

  const config = ROUTE_MAP[matchedRoute];
  const fakeHeaders = new Headers();
  fakeHeaders.set("Referer", config.referer);
  fakeHeaders.set("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36");

  // 拼接目标URL
  let targetPath = url.pathname;
  // 如果配置了 strip，就把请求路径里的前缀替换为 '/'
  // 比如 /qinl/live/123.m3u8 变成 /live/123.m3u8
  if (config.strip) {
      targetPath = targetPath.replace(matchedRoute, '/');
  }
  const targetUrl = config.target + targetPath + url.search;

  try {
    const response = await fetch(targetUrl, {
      method: "GET",
      headers: fakeHeaders,
      redirect: "follow" // 跟随源站的重定向
    });

    // 🚨 核心修复点：针对 EdgeOne 环境没有发生重定向时 response.url 为空的兼容性兜底
    const finalUrl = response.url || targetUrl; 

    const responseHeaders = new Headers(response.headers);
    responseHeaders.set("Access-Control-Allow-Origin", "*");
    const contentType = responseHeaders.get("Content-Type") || "";

    // 如果返回的是 M3U8 文本
    if (url.pathname.endsWith(".m3u8") || contentType.includes("mpegurl")) {
      const m3u8Text = await response.text();

      // 动态逐行重写，把 ts 请求全部劫持回我们的 /ts_proxy
      const rewrittenText = m3u8Text.split('\n').map(line => {
        line = line.trim();
        if (!line || (line.startsWith('#') && !line.includes('URI='))) return line;

        // 处理带加密密钥或外部音轨的 URI
        if (line.includes('URI="')) {
          return line.replace(/URI="([^"]+)"/, (match, p1) => {
            const absoluteUri = new URL(p1, finalUrl).href;
            return `URI="${url.origin}/ts_proxy?route=${matchedRoute}&url=${encodeURIComponent(absoluteUri)}"`;
          });
        }

        // 处理普通的 TS 切片行
        const absoluteTsUrl = new URL(line, finalUrl).href;
        return `${url.origin}/ts_proxy?route=${matchedRoute}&url=${encodeURIComponent(absoluteTsUrl)}`;
      }).join('\n');

      responseHeaders.delete("Content-Length");
      responseHeaders.delete("Content-Encoding"); 
      responseHeaders.set("Content-Type", "application/vnd.apple.mpegurl; charset=utf-8");

      return new Response(rewrittenText, {
        status: response.status,
        headers: responseHeaders
      });
    }

    // 非 M3U8 文件兜底透传（比如直接请求某个 ts 或 key）
    return new Response(response.body, { status: response.status, headers: responseHeaders });

  } catch (err) {
    return new Response("M3U8 Proxy Error: " + err.message, { status: 500 });
  }
}
