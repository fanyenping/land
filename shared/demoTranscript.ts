/**
 * 示範用逐字稿（虛構個案，非真實病人資料）。
 * 模擬一次約 24 分鐘、分兩段錄音的居家訪視：護理師、個案女兒、印尼籍看護。
 * 刻意保留一個常見的語音辨識錯誤（「三十六點八」被轉成「十六點八」），用來示範數值核對。
 */
export interface DemoSegment {
  startMs: number;
  endMs: number;
  speaker: string;
  text: string;
  confidence: number;
}

const s = (min: number, sec: number) => (min * 60 + sec) * 1000;

export const DEMO_SPEAKERS: Record<string, string> = {
  S1: "護理師",
  S2: "家屬（女兒）",
  S3: "看護",
};

export const DEMO_SEGMENTS: DemoSegment[] = [
  { startMs: s(0, 4), endMs: s(0, 12), speaker: "S1", text: "阿嬤午安，我是居護所的護理師，今天來幫你換鼻胃管，順便看一下屁股的傷口喔。", confidence: 0.94 },
  { startMs: s(0, 13), endMs: s(0, 24), speaker: "S2", text: "好，謝謝你。她這禮拜痰比較多，晚上咳得比較厲害，我有點擔心。", confidence: 0.92 },
  { startMs: s(0, 25), endMs: s(0, 31), speaker: "S1", text: "痰是什麼顏色？比較黏還是比較稀？", confidence: 0.95 },
  { startMs: s(0, 32), endMs: s(0, 41), speaker: "S3", text: "黃黃的，有點黏，一天大概抽四五次。", confidence: 0.86 },
  { startMs: s(1, 10), endMs: s(1, 32), speaker: "S1", text: "我先量生命徵象。體溫十六點八度，脈搏八十八下，呼吸十八次，血壓一百四十二之八十六，血氧九十六趴，沒有用氧氣。", confidence: 0.62 },
  { startMs: s(1, 33), endMs: s(1, 41), speaker: "S1", text: "飯前血糖剛剛測是一百六十八。", confidence: 0.83 },
  { startMs: s(1, 42), endMs: s(1, 52), speaker: "S2", text: "早上灌食之前測的，她最近灌完有時候會嗆到。", confidence: 0.9 },
  { startMs: s(2, 5), endMs: s(2, 20), speaker: "S1", text: "阿嬤叫得醒，眼睛會張開看我，問她會點頭，但是講話還是講不清楚，跟上次差不多。", confidence: 0.91 },
  { startMs: s(3, 0), endMs: s(3, 18), speaker: "S1", text: "肺音聽起來右下肺有一些痰音，左邊還好。等一下我教妳們怎麼拍背，抽痰前先拍一拍比較好抽。", confidence: 0.89 },
  { startMs: s(5, 30), endMs: s(5, 52), speaker: "S1", text: "鼻胃管今天換新的，十四號，放在左邊鼻孔，固定在五十五公分，反抽有胃液，空針打氣聽診有聲音，位置確認好了。", confidence: 0.88 },
  { startMs: s(5, 53), endMs: s(6, 8), speaker: "S1", text: "灌食的時候床頭一定要搖高三十到四十五度，灌完至少坐三十分鐘再躺下來，這樣比較不會嗆到。", confidence: 0.93 },
  { startMs: s(8, 40), endMs: s(9, 5), speaker: "S1", text: "薦骨這邊的壓傷大概兩公分乘一點五公分，表面有一點點黃色滲液，周圍皮膚有一點紅，沒有臭味。", confidence: 0.87 },
  { startMs: s(9, 6), endMs: s(9, 16), speaker: "S3", text: "我晚上有時候睡著了，翻身可能沒有每兩個小時。", confidence: 0.84 },
  { startMs: s(9, 17), endMs: s(9, 35), speaker: "S1", text: "沒關係，我們一起想辦法。可以用手機設鬧鐘，翻身的時候順便看一下皮膚有沒有變紅。我今天用生理食鹽水清潔，換上泡棉敷料。", confidence: 0.9 },
  { startMs: s(11, 0), endMs: s(11, 14), speaker: "S2", text: "還有她已經三天沒有大便了，肚子摸起來有點脹。", confidence: 0.93 },
  { startMs: s(11, 15), endMs: s(11, 34), speaker: "S1", text: "腸音有，但是比較少。可以先順時鐘按摩肚子，水分每天再多加兩百西西，如果明天還沒有解，打電話給我，我們再看要不要用軟便藥。", confidence: 0.9 },
  { startMs: s(12, 2), endMs: s(12, 15), speaker: "S2", text: "阿這個尿管什麼時候要換？", confidence: 0.88 },
  { startMs: s(12, 16), endMs: s(12, 30), speaker: "S1", text: "導尿管是九月二十號換的，下次是十月二十號左右。尿液顏色淡黃、清澈，量夠，沒有沉澱。", confidence: 0.86 },
  { startMs: s(14, 1), endMs: s(14, 20), speaker: "S1", text: "如果發燒超過三十八度、呼吸很喘、痰變成綠色或有血，或是鼻胃管滑出來，不要自己放回去，要馬上打電話給我或是去急診。", confidence: 0.94 },
  { startMs: s(14, 21), endMs: s(14, 27), speaker: "S2", text: "好，我會跟看護說，她中文比較聽得懂慢慢講的。", confidence: 0.91 },
  { startMs: s(14, 28), endMs: s(14, 36), speaker: "S1", text: "那我把衛教傳到 LINE，也可以翻成印尼文給她看。", confidence: 0.92 },
  // 第二段錄音（同次訪視，約 20 分鐘後接續）
  { startMs: s(20, 2), endMs: s(20, 18), speaker: "S1", text: "我再確認一次，剛剛拍背抽痰之後，血氧現在九十七趴，呼吸聲比較清楚了。", confidence: 0.9 },
  { startMs: s(20, 19), endMs: s(20, 31), speaker: "S3", text: "我這樣拍對嗎？手要彎起來像碗一樣？", confidence: 0.85 },
  { startMs: s(20, 32), endMs: s(20, 46), speaker: "S1", text: "對，手弓起來，由下往上、由外往內拍，避開脊椎和腰的地方，每邊拍三到五分鐘。", confidence: 0.92 },
  { startMs: s(23, 10), endMs: s(23, 24), speaker: "S2", text: "下次你什麼時候會再來？", confidence: 0.95 },
  { startMs: s(23, 25), endMs: s(23, 40), speaker: "S1", text: "兩個禮拜後再來看傷口，有任何問題隨時打電話給居護所。", confidence: 0.94 },
];

export const DEMO_DURATION_MS = s(23, 45);

export function demoTranscriptText(): string {
  return DEMO_SEGMENTS.map((seg) => `${DEMO_SPEAKERS[seg.speaker] ?? seg.speaker}：${seg.text}`).join("\n");
}
