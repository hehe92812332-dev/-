import type { Metadata } from "next";
import { Simulator } from "@/components/simulator/Simulator";

export const metadata: Metadata = {
  title: "동작 보상 시뮬레이터",
  description:
    "키·팔·다리·몸통 길이와 발목·햄스트링 가동성을 넣으면 스쿼트·데드리프트·스프린트·체대입시 종목에서 몸이 어떻게 보상하는지 3D로 계산합니다.",
};

export default function SimulatorPage() {
  return <Simulator />;
}
