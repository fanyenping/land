import { describe, expect, it } from "vitest";
import { AUDIO_ACCEPT, audioMimeOf, isAudioFile, PLAN_AUDIO_MAX_BYTES, voiceMemoProblem, withAudioMime } from "./audioFiles";

const file = (name: string, type: string, size = 2048) => new File([new Uint8Array(size)], name, { type });

describe("AUDIO_ACCEPT", () => {
  const parts = AUDIO_ACCEPT.split(",");

  it("lists .m4a and the m4a MIME types explicitly", () => {
    for (const want of [".m4a", "audio/x-m4a", "audio/mp4", "audio/m4a", "audio/*"]) expect(parts).toContain(want);
  });

  it("never offers video", () => {
    expect(parts).not.toContain(".mp4");
    expect(parts.some((p) => p.startsWith("video/"))).toBe(false);
  });
});

describe("isAudioFile", () => {
  it("accepts a Voice Memos export with any of the types iOS gives it", () => {
    for (const type of ["", "audio/x-m4a", "audio/mp4", "video/mp4", "application/octet-stream", "video/quicktime"]) {
      expect(isAudioFile(file("新錄音 3.m4a", type)), type).toBe(true);
    }
  });

  it("accepts any audio/* type regardless of the name", () => {
    expect(isAudioFile(file("recording", "audio/mpeg"))).toBe(true);
  });

  it("rejects a real video and unknown files", () => {
    expect(isAudioFile(file("clip.mp4", "video/mp4"))).toBe(false);
    expect(isAudioFile(file("clip.mov", "video/quicktime"))).toBe(false);
    expect(isAudioFile(file("病摘.pdf", "application/pdf"))).toBe(false);
    expect(isAudioFile(file("note.txt", ""))).toBe(false);
  });
});

describe("voiceMemoProblem", () => {
  it("explains an empty file (iCloud placeholder)", () => {
    expect(voiceMemoProblem(file("新錄音 3.m4a", "audio/x-m4a", 0))).toBe("檔案是空的，請改存到「我的 iPhone」再選");
  });

  it("explains the editable .qta format", () => {
    expect(voiceMemoProblem(file("新錄音 3.qta", "video/quicktime"))).toBe("語音備忘錄請用預設 m4a 分享（不要選「可編輯」）");
    expect(voiceMemoProblem(file("新錄音 3.qta", ""))).toBe("語音備忘錄請用預設 m4a 分享（不要選「可編輯」）");
    expect(voiceMemoProblem(file("錄音", "video/quicktime"))).toBe("語音備忘錄請用預設 m4a 分享（不要選「可編輯」）");
  });

  it("is null for a normal m4a", () => {
    expect(voiceMemoProblem(file("新錄音 3.m4a", "video/quicktime"))).toBeNull();
    expect(voiceMemoProblem(file("新錄音 3.m4a", ""))).toBeNull();
  });
});

describe("audio MIME normalization", () => {
  it("keeps audio types and maps odd ones by extension", () => {
    expect(audioMimeOf({ name: "a.m4a", type: "audio/x-m4a" })).toBe("audio/x-m4a");
    expect(audioMimeOf({ name: "新錄音 3.m4a", type: "video/mp4" })).toBe("audio/mp4");
    expect(audioMimeOf({ name: "新錄音 3.m4a", type: "" })).toBe("audio/mp4");
    expect(audioMimeOf({ name: "b.mp3", type: "application/octet-stream" })).toBe("audio/mpeg");
  });

  it("rewraps a file with an odd type without changing its bytes", async () => {
    const f = file("新錄音 3.m4a", "video/quicktime", 10);
    const out = withAudioMime(f, f.name);
    expect(out.type).toBe("audio/mp4");
    expect(out.size).toBe(10);
    const ok = file("a.m4a", "audio/mp4");
    expect(withAudioMime(ok, ok.name)).toBe(ok);
  });

  it("caps plan audio at 50 MB", () => {
    expect(PLAN_AUDIO_MAX_BYTES).toBe(50 * 1024 * 1024);
  });
});
