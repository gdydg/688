export default async function onRequest(context) {
  const { request } = context;
  const url = new URL(request.url);

  // 【关键修复 1】：拦截并直接响应 OPTIONS 预检请求 (解决 TV 端本地代理的严格跨域)
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

  const TARGET_DOMAIN = "https://video10.letaocm.top";
  const targetUrl = TARGET_DOMAIN + url.pathname + url.search;

  const proxyHeaders = new Headers(request.headers);
  proxyHeaders.set("Referer", "https://688zb24.com");
  proxyHeaders.set("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36");
  proxyHeaders.delete("Host");
  proxyHeaders.delete("Origin");
  
  // 【关键修复 2】：删除 Accept-Encoding，强制源站返回明文，防止被透明解压导致的头部异常
  proxyHeaders.delete("Accept-Encoding"); 

  try {
    const response = await fetch(targetUrl, {
      method: request.method,
      headers: proxyHeaders
    });

    const responseHeaders = new Headers(response.headers);
    responseHeaders.set("Access-Control-Allow-Origin", "*");

    const contentType = responseHeaders.get("Content-Type") || "";

    // 判断是否为 M3U8 文件
    if (url.pathname.endsWith(".m3u8") || contentType.includes("mpegurl")) {
      let m3u8Text = await response.text();

      // 替换其中的绝对域名
      const escapedDomain = TARGET_DOMAIN.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const regex = new RegExp(escapedDomain, 'g');
      m3u8Text = m3u8Text.replace(regex, url.origin);

      // 【关键修复 3】：清理并重置关键头部，迎合 IjkPlayer/ExoPlayer 的强校验
      responseHeaders.delete("Content-Length"); 
      responseHeaders.delete("Content-Encoding"); // 彻底掐断压缩冲突的可能
      // 强制统一标准的 M3U8 MIME 类型
      responseHeaders.set("Content-Type", "application/vnd.apple.mpegurl; charset=utf-8");

      return new Response(m3u8Text, {
        status: response.status,
        headers: responseHeaders
      });
    }

    // 对于 TS 切片，直接透传数据流
    return new Response(response.body, {
      status: response.status,
      headers: responseHeaders
    });

  } catch (err) {
    return new Response("代理内部错误: " + err.message, { status: 500 });
  }
}
