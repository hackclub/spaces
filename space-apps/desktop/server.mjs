import http from "http";
import net from "net";
import crypto from "crypto";

const PORT = Number.parseInt(process.env.PORT, 10) || 3000;
const TARGET_PORT = Number.parseInt(process.env.TARGET_PORT, 10) || 3001;
const TARGET_HOST = "127.0.0.1";
const PASSWORD = process.env.SPACE_PASSWORD || "";
const USERNAME = process.env.DESKTOP_USERNAME || "abc";
const SESSION_COOKIE = "spaces_desktop_session";
const SESSION_MAX_AGE_SECONDS = 30 * 24 * 60 * 60;
const FAILED_LOGIN_LIMIT = 20;
const FAILED_LOGIN_WINDOW_MS = 15 * 60 * 1000;

const digest = (value) => crypto.createHash("sha256").update(value).digest();
const matches = (given, expected) => crypto.timingSafeEqual(digest(String(given)), digest(expected));
const sessionToken = crypto.createHmac("sha256", PASSWORD).update("desktop-session").digest("hex");
const upstreamAuth = `Basic ${Buffer.from(`${USERNAME}:${PASSWORD}`).toString("base64")}`;
const failedLogins = new Map();

const clientIp = (req) => String(req.headers["x-forwarded-for"] || "").split(",")[0].trim() || req.socket.remoteAddress || "";

const cookieValue = (req, name) => {
  for (const part of String(req.headers.cookie || "").split(";")) {
    const [key, ...rest] = part.trim().split("=");
    if (key === name) return rest.join("=");
  }
  return "";
};

const withoutSessionCookie = (header) => String(header || "")
  .split(";")
  .map((part) => part.trim())
  .filter((part) => part && !part.startsWith(`${SESSION_COOKIE}=`))
  .join("; ");

const basicAuthMatches = (req) => {
  const header = String(req.headers.authorization || "");
  if (!header.toLowerCase().startsWith("basic ")) return false;
  const decoded = Buffer.from(header.slice(6).trim(), "base64").toString("utf8");
  const split = decoded.indexOf(":");
  if (split < 0) return false;
  return matches(decoded.slice(0, split), USERNAME) && matches(decoded.slice(split + 1), PASSWORD);
};

const loggedIn = (req) => Boolean(PASSWORD) && (matches(cookieValue(req, SESSION_COOKIE), sessionToken) || basicAuthMatches(req));

const sessionCookie = (req) => {
  const secure = String(req.headers["x-forwarded-proto"] || "").split(",")[0].trim() === "https" ? "; Secure" : "";
  return `${SESSION_COOKIE}=${sessionToken}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_MAX_AGE_SECONDS}${secure}`;
};

const loginPage = (message = "") => `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Log in to your space</title>
<meta name="color-scheme" content="dark light">
<link rel="icon" href="data:,">
<style>
  :root { --bg: #fff; --text: #1f2d3d; --muted: #5c6b7a; --line: #c9d2dc; --accent: #ec3750; }
  @media (prefers-color-scheme: dark) { :root { --bg: #17171d; --text: #f2f4f7; --muted: #a3acb8; --line: #3a3a46; } }
  body { margin: 0; min-height: 100vh; display: grid; place-items: center; background: var(--bg); color: var(--text); font: 16px/1.5 system-ui, -apple-system, "Segoe UI", sans-serif; }
  form { width: min(360px, 100% - 32px); }
  h1 { margin: 0 0 8px; font-size: 24px; }
  p { margin: 0 0 16px; color: var(--muted); }
  .error { color: var(--accent); }
  input { box-sizing: border-box; width: 100%; padding: 10px 12px; margin-bottom: 12px; border: 1px solid var(--line); border-radius: 6px; background: transparent; color: inherit; font: inherit; }
  button { width: 100%; padding: 10px 18px; border: 0; border-radius: 6px; background: var(--accent); color: #fff; font: inherit; font-weight: 600; cursor: pointer; }
</style>
</head>
<body>
<form method="POST" action="/login">
  <h1>Your space</h1>
  <p>Enter the password shown for this space on your Spaces dashboard.</p>
  ${message ? `<p class="error" role="alert">${message}</p>` : ""}
  <input type="password" name="password" autocomplete="current-password" aria-label="Password" required autofocus>
  <button type="submit">Log in</button>
</form>
</body>
</html>`;

const tooManyFailures = (ip) => {
  const entry = failedLogins.get(ip);
  if (!entry) return false;
  if (Date.now() - entry.since > FAILED_LOGIN_WINDOW_MS) {
    failedLogins.delete(ip);
    return false;
  }
  return entry.count >= FAILED_LOGIN_LIMIT;
};

const recordFailure = (ip) => {
  const entry = failedLogins.get(ip);
  if (!entry || Date.now() - entry.since > FAILED_LOGIN_WINDOW_MS) failedLogins.set(ip, { count: 1, since: Date.now() });
  else entry.count += 1;
};

const readForm = (req) => new Promise((resolve, reject) => {
  let body = "";
  req.setEncoding("utf8");
  req.on("data", (chunk) => {
    body += chunk;
    if (body.length > 10 * 1024) {
      reject(new Error("too long"));
      req.destroy();
    }
  });
  req.on("end", () => resolve(new URLSearchParams(body)));
  req.on("error", reject);
});

const sendHtml = (res, status, html, headers = {}) => {
  res.writeHead(status, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store", ...headers });
  res.end(html);
};

const handleLogin = async (req, res) => {
  const ip = clientIp(req);
  if (req.method === "GET") return sendHtml(res, 200, loginPage());
  if (req.method !== "POST") return sendHtml(res, 405, loginPage());
  if (tooManyFailures(ip)) return sendHtml(res, 429, loginPage("Too many wrong passwords. Try again in 15 minutes."), { "Retry-After": "900" });
  const form = await readForm(req);
  if (PASSWORD && matches(form.get("password") || "", PASSWORD)) {
    failedLogins.delete(ip);
    res.writeHead(302, { "Set-Cookie": sessionCookie(req), Location: "/", "Cache-Control": "no-store" });
    return res.end();
  }
  recordFailure(ip);
  return sendHtml(res, 401, loginPage("That password isn't right."));
};

const upstreamHeaders = (req) => {
  const headers = { ...req.headers, authorization: upstreamAuth };
  const cookie = withoutSessionCookie(req.headers.cookie);
  if (cookie) headers.cookie = cookie;
  else delete headers.cookie;
  return headers;
};

const sameOrigin = (req) => {
  const origin = req.headers.origin;
  if (!origin) return true;
  try {
    return new URL(origin).host === req.headers.host;
  } catch {
    return false;
  }
};

const server = http.createServer(async (req, res) => {
  const path = new URL(req.url, "http://localhost").pathname;

  if (path === "/healthz") {
    res.writeHead(200, { "Content-Type": "text/plain" });
    return res.end("ok");
  }

  try {
    if (path === "/login") return await handleLogin(req, res);
  } catch {
    if (!res.headersSent) return sendHtml(res, 400, loginPage("Something went wrong. Try again."));
    return res.destroy();
  }

  if (!loggedIn(req)) {
    if (req.method === "GET" && (req.headers["sec-fetch-dest"] === "document" || path === "/")) {
      res.writeHead(302, { Location: "/login", "Cache-Control": "no-store" });
      return res.end();
    }
    res.writeHead(401, { "Content-Type": "text/plain", "Cache-Control": "no-store" });
    return res.end("Log in to your space first.");
  }

  const upstream = http.request({
    host: TARGET_HOST,
    port: TARGET_PORT,
    method: req.method,
    path: req.url,
    headers: upstreamHeaders(req)
  }, (response) => {
    const headers = { ...response.headers };
    delete headers["www-authenticate"];
    res.writeHead(response.statusCode, headers);
    response.pipe(res);
  });
  upstream.on("error", () => {
    if (!res.headersSent) {
      res.writeHead(502, { "Content-Type": "text/plain" });
      res.end("Your desktop is still starting. Refresh in a few seconds.");
    } else {
      res.destroy();
    }
  });
  req.pipe(upstream);
});

server.on("upgrade", (req, socket, head) => {
  socket.on("error", () => socket.destroy());
  if (!loggedIn(req) || !sameOrigin(req)) {
    socket.end("HTTP/1.1 401 Unauthorized\r\nConnection: close\r\nContent-Length: 0\r\n\r\n");
    return;
  }

  const upstream = net.connect(TARGET_PORT, TARGET_HOST, () => {
    const headers = upstreamHeaders(req);
    const lines = [`${req.method} ${req.url} HTTP/1.1`];
    for (const [name, value] of Object.entries(headers)) {
      for (const item of Array.isArray(value) ? value : [value]) lines.push(`${name}: ${item}`);
    }
    upstream.write(lines.join("\r\n") + "\r\n\r\n");
    if (head?.length) upstream.write(head);
    upstream.pipe(socket);
    socket.pipe(upstream);
  });
  upstream.on("error", () => socket.destroy());
  socket.on("close", () => upstream.destroy());
  upstream.on("close", () => socket.destroy());
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(`Desktop login is listening on port ${PORT}`);
});
