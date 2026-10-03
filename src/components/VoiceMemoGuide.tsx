import { Smartphone, Upload } from "lucide-react";
import { Sheet } from "./Sheet";
import { Button } from "./ui";
import { TRIAL } from "../lib/env";

const STEPS = [
  "打開「語音備忘錄」，點這次的錄音。",
  "點「⋯」→「分享」→ 往下滑點「儲存到檔案」。",
  "選「我的 iPhone」→ 點「儲存」。",
  "回到這裡按「從檔案選錄音」→ 跳出選單時點「選擇檔案」→ 在「最近項目」點剛存的錄音。",
];

/** 說明內容（步驟與小提醒）：面板與口述面板內的展開說明共用。 */
export function VoiceMemoGuideContent({ purpose = "visit" }: { purpose?: "visit" | "plan" }) {
  const tips = [
    "分享時不用改「選項」，用預設的 m4a。",
    "用語音備忘錄錄音可以鎖螢幕，但不要同時播音樂或影片。",
    ...(purpose === "plan" ? ["iOS 18 以上也可以在「⋯」點「拷貝逐字稿」，回來按「打字輸入」貼上；台語為主時建議用錄音檔。"] : []),
    ...(TRIAL ? ["試用版：選任何錄音檔都會用示範內容。"] : []),
  ];
  return (
    <>
      <p className="mb-4 flex items-center gap-3 text-[1.05rem] font-bold leading-snug">
        <span className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-ink text-paper" aria-hidden>
          <Smartphone size={22} strokeWidth={2.4} />
        </span>
        語音備忘錄的錄音要先存到「檔案」，這裡才選得到。
      </p>
      <ol className="flex flex-col gap-2.5">
        {STEPS.map((s, i) => (
          <li key={s} className="flex items-start gap-3 rounded-[20px] bg-card p-3.5 outline-ink">
            <span className="num grid h-8 w-8 shrink-0 place-items-center rounded-full bg-ink text-[1rem] font-extrabold text-paper">{i + 1}</span>
            <span className="pt-1 text-[1.05rem] font-bold leading-snug">{s}</span>
          </li>
        ))}
      </ol>
      <section className="mt-4 rounded-[22px] bg-audio-tint p-4">
        <h3 className="mb-2 text-[1rem] font-extrabold">小提醒</h3>
        <ul className="flex flex-col gap-1.5 text-[0.98rem] leading-relaxed">
          {tips.map((t) => (
            <li key={t} className="flex gap-1.5">
              <span aria-hidden>・</span>
              <span>{t}</span>
            </li>
          ))}
        </ul>
      </section>
    </>
  );
}

/**
 * iPhone 語音備忘錄：先「儲存到檔案」，再用檔案選擇器選（沒有可靠的直接連結）。
 * onPick 必須在這次點擊裡同步打開選檔（iOS 只允許使用者手勢觸發）。
 */
export function VoiceMemoGuideSheet({ open, onClose, onPick, purpose = "visit" }: { open: boolean; onClose: () => void; onPick: () => void; purpose?: "visit" | "plan" }) {
  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={purpose === "plan" ? "用 iPhone 語音備忘錄口述計畫" : "從 iPhone 語音備忘錄加入"}
      footer={
        <Button
          variant="primary"
          size="lg"
          block
          data-autofocus
          icon={<Upload size={20} />}
          onClick={() => {
            onPick();
            onClose();
          }}
        >
          從檔案選錄音
        </Button>
      }
    >
      <VoiceMemoGuideContent purpose={purpose} />
    </Sheet>
  );
}
