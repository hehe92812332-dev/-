// 건강 소식 기본 글 모음(src/lib/news-library.ts)을 '검수 대기' 상태로 넣습니다. 운영 DB에서도 안전합니다(이미 있는 글은 건너뜀).
// 의료 정보이므로 면허를 가진 전문가가 관리자 콘솔 › 건강 소식에서 내용을 확인하고 승인해야 공개됩니다. 승인하면 비어 있는 날짜에 하루 한 편씩 예약됩니다.
// 실행: npm run news:import
import { NEWS_LIBRARY } from "../src/lib/news-library";
import { importLibrary } from "../src/server/news";

async function main() {
  const n = await importLibrary(NEWS_LIBRARY.map((a) => ({ ...a, status: "review" as const, publishOn: null, authorName: "PT 브릿지 편집팀" })));
  console.log(`건강 소식 ${n}편을 검수 대기로 넣었어요 (전체 ${NEWS_LIBRARY.length}편 중 새 글).`);
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
