import { Eye, EyeOff } from "lucide-react";
import { hideNames, revealNames, useNamesRevealed } from "../lib/hooks";
import { maskName } from "../lib/format";
import { RoundButton } from "./ui";

/** 個案姓名預設遮罩（陳○蘭），按小眼睛暫時顯示 10 秒。 */
export function Name({ name }: { name: string }) {
  const revealed = useNamesRevealed();
  return <>{revealed ? name : maskName(name)}</>;
}

export function RevealButton({ size = 40, tone = "card" as const }: { size?: number; tone?: "card" | "clear" }) {
  const revealed = useNamesRevealed();
  return (
    <RoundButton
      label={revealed ? "遮住姓名" : "暫時顯示完整姓名（10 秒）"}
      size={size}
      tone={tone}
      onClick={(e) => {
        e.stopPropagation();
        if (revealed) hideNames();
        else revealNames();
      }}
    >
      {revealed ? <EyeOff size={19} strokeWidth={2.4} /> : <Eye size={19} strokeWidth={2.4} />}
    </RoundButton>
  );
}
