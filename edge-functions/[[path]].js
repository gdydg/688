export default async function onRequest(context) {
  const { request } = context;
  const url = new URL(request.url);

  // 1. 固定你的目标源站域名
  const TARGET_DOMAIN = "https://video10.letaocm.top";

  // 2. 拼接出真实的请求地址
  // 比如访问 https://你的域名.run/live/xxx.m3u8
  // url.pathname 就是 /live/xxx.m3u8
  // 拼接后直接变成 https://video10.letaocm.top/live/xxx.m3u8
  const targetUrl = TARGET_DOMAIN + url.pathname + url.search;

  // 3. 构造突破防盗链的伪造头
  const proxyHeaders = new Headers(request.headers);
  proxyHeaders.set("Referer", "https://688zb24.com");
  proxyHeaders.set("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36");
  proxyHeaders.delete("Host");
  proxyHeaders.delete("Origin");

  try {
    const response = await fetch(targetUrl, {
      method: request.method,
      headers: proxyHeaders
    });

    const responseHeaders = new Headers(response.headers);
    responseHeaders.set("Access-Control-Allow-Origin", "*"); // 允许跨域播放

    const contentType = responseHeaders.get("Content-Type") || "";

    // 4. 如果是 M3U8 文件
    if (url.pathname.endsWith(".m3u8") || contentType.includes("mpegurl")) {
      let m3u8Text = await response.text();

      // 【极其精简的重写逻辑】
      // 因为我们保留了原始的路径层级，如果 M3U8 里是相对路径(如 seg-1.ts)，播放器会自动请求你的域名，无需重写！
      // 只有当源站下发了带有完整域名的绝对路径时，才将其暴力替换为你的 Pages 域名。
      const escapedDomain = TARGET_DOMAIN.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const regex = new RegExp(escapedDomain, 'g');
      m3u8Text = m3u8Text.replace(regex, url.origin);

      responseHeaders.delete("Content-Length"); // 内容可能变化，删掉原始长度

      return new Response(m3u8Text, {
        status: response.status,
        headers: responseHeaders
      });
    }

    // 5. 如果是 TS 切片，直接透传数据流
    return new Response(response.body, {
      status: response.status,
      headers: responseHeaders
    });

  } catch (err) {
    return new Response("边缘代理内部错误: " + err.message, { status: 500 });
  }
}
