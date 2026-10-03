/**
 * 試用版（`vite build --mode trial`）：包成單一網頁分享給人在手機上試用。
 * 不連 AI 伺服器、一律用內建示範內容；沒有 Service Worker、麥克風與系統分享。
 */
export const TRIAL = import.meta.env.MODE === "trial";
