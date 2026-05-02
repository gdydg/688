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

  // 2. 核心：构造【绝对纯净】的请求头，彻底屏蔽 OK影视/TVBox 的 okhttp 特征
  const fakeHeaders = new Headers();
  fakeHeaders.set("Referer", "https://688zb24.com");
  fakeHeaders.set("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36");

  // =====================================================================
  // 路由 A：专门处理 M3U8 内部的 TS 切片代理 (防 CDN 漂移)
  // =====================================================================
  if (url.pathname === "/ts_proxy") {
    const actualTsUrl = url.searchParams.get("url");
    if (!actualTsUrl) return new Response("Missing TS URL", { status: 400 });

    try {
      // 代理请求真实的 TS 切片
      const tsResponse = await fetch(actualTsUrl, { method: "GET", headers: fakeHeaders });
      const tsHeaders = new Headers(tsResponse.headers);
      tsHeaders.set("Access-Control-Allow-Origin", "*");
      // TV端对 TS 切片的 Content-Length 极其敏感，绝不修改它
      return new Response(tsResponse.body, { status: tsResponse.status, headers: tsHeaders });
    } catch (e) {
      return new Response("TS Proxy Error", { status: 500 });
    }
  }

  // =====================================================================
  // 路由 B：处理你请求的干净 M3U8 入口 (例如 /live/sd-1-xxx.m3u8)
  // =====================================================================
  const TARGET_DOMAIN = "https://video10.letaocm.top";
  const targetUrl = TARGET_DOMAIN + url.pathname + url.search;

  try {
    const response = await fetch(targetUrl, {
      method: "GET",
      headers: fakeHeaders,
      redirect: "follow" // 极其重要：必须跟随源站的 301/302 CDN 重定向
    });

    const finalUrl = response.url; // 获取重定向后真正的 CDN 节点链接
    const responseHeaders = new Headers(response.headers);
    responseHeaders.set("Access-Control-Allow-Origin", "*");
    const contentType = responseHeaders.get("Content-Type") || "";

    // 如果返回的是 M3U8 文本
    if (url.pathname.endsWith(".m3u8") || contentType.includes("mpegurl")) {
      const m3u8Text = await response.text();

      // 动态逐行重写，无视源站的相对/绝对路径或重定向
      const rewrittenText = m3u8Text.split('\n').map(line => {
        line = line.trim();
        // 忽略空行和非 URI 注释行
        if (!line || (line.startsWith('#') && !line.includes('URI='))) return line;

        // 处理加密的 KEY URI
        if (line.includes('URI="')) {
          return line.replace(/URI="([^"]+)"/, (match, p1) => {
            const absoluteUri = new URL(p1, finalUrl).href;
            return `URI="${url.origin}/ts_proxy?url=${encodeURIComponent(absoluteUri)}"`;
          });
        }

        // 将所有 TS 链接解析为真实绝对地址，并挂载到我们的 /ts_proxy 路由下
        const absoluteTsUrl = new URL(line, finalUrl).href;
        return `${url.origin}/ts_proxy?url=${encodeURIComponent(absoluteTsUrl)}`;
      }).join('\n');

      // 清理导致 TV 端 ExoPlayer 崩溃的响应头
      responseHeaders.delete("Content-Length");
      responseHeaders.delete("Content-Encoding"); // 杀掉 Gzip 冲突
      responseHeaders.set("Content-Type", "application/vnd.apple.mpegurl; charset=utf-8");

      return new Response(rewrittenText, {
        status: response.status,
        headers: responseHeaders
      });
    }

    // 非 M3U8 文件兜底透传
    return new Response(response.body, { status: response.status, headers: responseHeaders });

  } catch (err) {
    return new Response("M3U8 Proxy Error: " + err.message, { status: 500 });
  }
}
