// 자체 서버(VM·Docker) 운영용: CPU 코어 수만큼 Next.js 워커를 띄워 요청을 나눠 받습니다.
// 1개 프로세스는 약 500 req/s에서 포화되어 동시 접속 200에서 응답 지연 꼬리가 길어졌음(부하 테스트).
// 실행: npm run build && npm run start:cluster   (WEB_CONCURRENCY로 워커 수 지정, PORT 기본 3000)
// Vercel 같은 서버리스에서는 플랫폼이 자동으로 늘려 주므로 필요 없습니다.
const cluster = require("node:cluster");
const os = require("node:os");
const http = require("node:http");

const workers = Number(process.env.WEB_CONCURRENCY) || Math.max(1, os.availableParallelism() - 1);
const port = Number(process.env.PORT) || 3000;

if (cluster.isPrimary) {
  console.log(`PT 브릿지: 워커 ${workers}개, 포트 ${port}`);
  for (let i = 0; i < workers; i++) cluster.fork();
  cluster.on("exit", (w, code) => {
    console.error(`워커 ${w.process.pid} 종료(${code}) — 다시 시작합니다`);
    cluster.fork();
  });
} else {
  const next = require("next");
  const app = next({ dev: false, dir: require("node:path").join(__dirname, "..") });
  app.prepare().then(() => {
    const handle = app.getRequestHandler();
    http.createServer((req, res) => handle(req, res)).listen(port);
  });
}
