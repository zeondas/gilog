// 민원대장 – 조각끼리 함께 쓰는 타입·값(분류 목록·입력 칸 모양·열 거르기 이름·위치 표기).
import { ComplaintInput } from "../../api";
import { FilterKey } from "../../complaints";
import { Settings } from "../../settingsStore";

export const FILTER_LABEL: Record<FilterKey, string> = { intake: "접수유형", ctype: "민원유형", area: "지역", status: "상태" };
export type Lists = Pick<Settings, "status" | "intake" | "ctype">;

// ---------- 입력 칸들 ----------

export type Draft = ComplaintInput;
export type DateKey = "received" | "due" | "done";

export type PlaceStyle = Settings["placeStyle"];

/** 위치 표기(2026-10-25 사용자 ③1안): 법정동이면 동 지역은 행정동을 빼고 "동패동 1234", 리 지역·행정동 표기는 "조리읍 대원리 1234"·"운정3동 동패동 1234" */
export function placeText(area: string, place: string, style: PlaceStyle): string {
  if (!place) return area;
  if (style === "legal" && /동$/.test(area)) return place;
  return [area, place].filter(Boolean).join(" ");
}

export type Bad = { received?: boolean; due?: boolean; done?: boolean; body?: boolean; intake?: boolean; ctype?: boolean; status?: boolean };
