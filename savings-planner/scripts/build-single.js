// index.html + styles.css + planner.js + app.js → dist/moaplan.html (파일 하나로 열리는 버전)
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
const r = (f) => readFileSync(new URL(`../${f}`, import.meta.url), 'utf8');
const html = r('index.html');
const body = html.slice(html.indexOf('<!--BODY-START-->') + 17, html.indexOf('<!--BODY-END-->'));
const planner = r('planner.js').replace(/^export /gm, '');
const app = r('app.js').replace(/^import .*$/m, '');
const fonts = html.match(/<link rel="stylesheet" href="https:\/\/fonts[^>]+>/)[0];
const fragment = process.argv.includes('--fragment');
const head = `<title>모아플랜</title>\n<meta name="claude:viewport-fit-sides" content="cover">\n${fonts}\n<style>\n${r('styles.css')}\n</style>`;
const script = `<script type="module">\n${planner}\n${app}\n</script>`;
const out = fragment
  ? `${head}\n${body}\n${script}\n`
  : `<!doctype html>\n<html lang="ko">\n<head>\n<meta charset="utf-8">\n<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">\n${head}\n</head>\n<body>\n${body}\n${script}\n</body>\n</html>\n`;
mkdirSync(new URL('../dist/', import.meta.url), { recursive: true });
const name = fragment ? 'moaplan-fragment.html' : 'moaplan.html';
writeFileSync(new URL(`../dist/${name}`, import.meta.url), out);
console.log(`dist/${name} (${(out.length / 1024).toFixed(1)} KB)`);
