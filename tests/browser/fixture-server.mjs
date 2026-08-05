import { createServer } from "node:http";

const port = Number(process.env.PORT);
const host = process.env.HOST ?? "127.0.0.1";
if (!Number.isInteger(port) || port < 1) throw new Error("PORT is required");

const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width">
<title>Northstar test harness</title><style>
body{font:16px system-ui;background:#f7f8fa;color:#17202a;margin:0}main{max-width:28rem;margin:8vh auto;padding:2rem}
label{display:block;margin:.75rem 0 .25rem}input,button{box-sizing:border-box;font:inherit;width:100%;padding:.7rem}
button{margin-top:1rem;background:#174ea6;color:#fff;border:0;border-radius:.25rem}*:focus-visible{outline:3px solid #b45309;outline-offset:2px}
</style></head><body><main><h1>Sign in to Northstar</h1><form id="login">
<label for="email">Email</label><input id="email" name="email" type="email" autocomplete="username" required>
<label for="password">Password</label><input id="password" name="password" type="password" autocomplete="current-password" required>
<button>Sign in</button></form><p id="status" role="status"></p></main>
<script>document.querySelector('#login').addEventListener('submit',event=>{event.preventDefault();document.querySelector('#status').textContent='Signed in for browser harness verification';});</script>
</body></html>`;

const server = createServer((_request, response) => {
  response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
  response.end(html);
});
server.listen(port, host, () => console.log(`fixture browser server listening on http://${host}:${port}`));
const shutdown = () => server.close(() => process.exit(0));
process.once("SIGINT", shutdown);
process.once("SIGTERM", shutdown);
