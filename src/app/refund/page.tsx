import { LegalPage } from "@/components/LegalPage";
import { BUSINESS, REVOKE_DAYS } from "@/lib/config";

export const metadata = { title: "환불 정책" };

export default function Refund() {
  return (
    <LegalPage title="환불 정책" effective="2026년 0월 0일">
      <h2>1. 토큰 충전 취소 (청약철회)</h2>
      <ul>
        <li>충전일로부터 {REVOKE_DAYS}일 이내, 그 충전으로 받은 충전 토큰을 사용하지 않았다면 지갑의 거래 내역에서 바로 결제를 취소할 수 있습니다.</li>
        <li>결제 수단으로 환불되며, 카드사 사정에 따라 3~7영업일이 걸릴 수 있습니다.</li>
        <li>함께 지급된 보너스 토큰은 회수됩니다.</li>
      </ul>
      <h2>2. 일부를 사용한 경우</h2>
      <p>
        충전분을 일부 사용한 뒤의 환불은 고객센터({BUSINESS.email})로 요청해 주세요. 사용하지 않은 충전 토큰에 해당하는 금액에서 결제 수수료 등 법령이 허용하는 비용을
        뺀 금액을 환불합니다.
      </p>
      <h2>3. 질문 토큰</h2>
      <ul>
        <li>답변이 달리기 전 질문 취소, 기한 내 무답변, 운영 정책에 따른 숨김 처리 시 질문에 쓴 토큰은 원래 지갑으로 전액 돌아옵니다.</li>
        <li>답변이 채택된 뒤에는 답변자에게 보상이 지급되므로 환불되지 않습니다.</li>
      </ul>
      <h2>4. 멤버십</h2>
      <ul>
        <li>자동 갱신은 언제든 해지할 수 있으며, 해지해도 남은 기간까지 혜택이 유지됩니다.</li>
        <li>결제 후 {REVOKE_DAYS}일 이내이고 그 달 지급 토큰을 사용하지 않았다면 고객센터를 통해 전액 환불받을 수 있습니다.</li>
      </ul>
      <h2>5. 문의</h2>
      <p>
        {BUSINESS.email} · {BUSINESS.phone}
      </p>
    </LegalPage>
  );
}
