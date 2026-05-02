// 文件路径: edge-functions/proxy.js

export default async function onRequest(context) {
  // 从 context 中获取 request 对象
  const { request } = context;
  const url = new URL(request.url);
  const targetUrlStr = url.searchParams.get('url');

  if (!targetUrlStr) {
    return new Response("缺少 'url' 参数。请在请求时加上 ?url=目标链接", { status: 400 });
  }

  // 1. 构造伪造的请求头
  const proxyHeaders = new Headers(request.headers);
  proxyHeaders.set("Referer", "https://688zb24.com"); // 验证通过的 Referer
  proxyHeaders.set("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36");
  
  proxyHeaders.delete("Host"); 
  proxyHeaders.delete("Origin");

  try {
    // 2. 向源站发起请求
    const response = await fetch(targetUrlStr, {
      method: request.method,
      headers: proxyHeaders
    });

    const contentType = response.headers.get("Content-Type") || "";

    // 3. 拦截并重写 M3U8 文件
    if (targetUrlStr.includes(".m3u8") || contentType.includes("mpegurl")) {
      let m3u8Text = await response.text();
      const targetUrlObj = new URL(targetUrlStr);
      // 获取当前函数的完整路径（例如：https://你的pages域名.com/proxy）
      const proxyOrigin = url.origin + url.pathname;

      // 逐行解析并替换 TS 切片链接
      const rewrittenText = m3u8Text.split('\n').map(line => {
        line = line.trim();
        if (!line || (line.startsWith('#') && !line.includes('URI='))) {
          return line;
        }
        
        // 替换加密 KEY 的 URI (如果有)
        if (line.includes('URI="')) {
          return line.replace(/URI="([^"]+)"/, (match, p1) => {
            const absoluteUri = new URL(p1, targetUrlObj.href).href;
            return `URI="${proxyOrigin}?url=${encodeURIComponent(absoluteUri)}"`;
          });
        }

        // 将相对/绝对 TS 路径替换为我们的代理路径
        const absoluteTsUrl = new URL(line, targetUrlObj.href).href;
        return `${proxyOrigin}?url=${encodeURIComponent(absoluteTsUrl)}`;
      }).join('\n');

      const newHeaders = new Headers(response.headers);
      newHeaders.set("Access-Control-Allow-Origin", "*");
      newHeaders.delete("Content-Length"); 

      return new Response(rewrittenText, {
        status: response.status,
        headers: newHeaders
      });
    }

    // 4. TS 切片直接透传
    const streamHeaders = new Headers(response.headers);
    streamHeaders.set("Access-Control-Allow-Origin", "*");
    
    return new Response(response.body, {
      status: response.status,
      headers: streamHeaders
    });

  } catch (e) {
    return new Response("代理请求出错: " + e.message, { status: 500 });
  }
}
