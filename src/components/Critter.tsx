import type { CSSProperties } from "react";

/**
 * 角色圖示：飽和色的幾何造型＋極簡表情（參考「Check-in time」造型角色）。
 * 每種造型代表 App 中的一種東西，顏色與造型固定，護理師看形狀就知道是什麼。
 */
export type CritterKind =
  | "record"
  | "plan"
  | "edu"
  | "audio"
  | "pdf"
  | "photo"
  | "pending"
  | "processing"
  | "error"
  | "done"
  | "alert"
  | "empty"
  | "brand"
  | "nurse"
  | "offline";

export type Shape = "flower" | "circle" | "dome" | "capsules" | "scallop" | "crown" | "hexagon" | "triangle" | "square" | "quarter" | "heart" | "blob";
export type Face = "calm" | "content" | "lookUp" | "side" | "spiral" | "flat" | "squint" | "sleepy" | "open";

const KINDS: Record<CritterKind, { shape: Shape; face: Face; color: string }> = {
  record: { shape: "flower", face: "calm", color: "var(--record)" },
  plan: { shape: "circle", face: "lookUp", color: "var(--plan)" },
  edu: { shape: "dome", face: "content", color: "var(--edu)" },
  audio: { shape: "capsules", face: "open", color: "var(--audio)" },
  pdf: { shape: "scallop", face: "content", color: "var(--pdf)" },
  photo: { shape: "crown", face: "calm", color: "var(--cobalt)" },
  pending: { shape: "quarter", face: "side", color: "var(--pending)" },
  processing: { shape: "hexagon", face: "spiral", color: "var(--cobalt)" },
  error: { shape: "square", face: "flat", color: "var(--danger)" },
  done: { shape: "circle", face: "calm", color: "var(--bubblegum)" },
  alert: { shape: "triangle", face: "squint", color: "var(--danger)" },
  empty: { shape: "circle", face: "lookUp", color: "var(--forest)" },
  brand: { shape: "heart", face: "calm", color: "var(--coral)" },
  nurse: { shape: "blob", face: "content", color: "var(--grape)" },
  offline: { shape: "square", face: "sleepy", color: "var(--ink-faint)" },
};

/** 個案頭像：依 id 固定挑一種造型與顏色，同一位個案永遠長一樣。 */
const AVATAR_SHAPES: Shape[] = ["flower", "circle", "dome", "scallop", "crown", "hexagon", "square", "quarter", "capsules", "blob"];
const AVATAR_COLORS = ["var(--record)", "var(--plan)", "var(--edu)", "var(--audio)", "var(--pdf)", "var(--pending)", "var(--coral)", "var(--cobalt)", "var(--bubblegum)", "var(--forest)"];
const AVATAR_FACES: Face[] = ["calm", "content", "lookUp", "side", "sleepy", "calm"];

function hash(s: string) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return Math.abs(h);
}

export function avatarSpec(id: string) {
  const h = hash(id);
  return {
    shape: AVATAR_SHAPES[h % AVATAR_SHAPES.length],
    color: AVATAR_COLORS[(h >> 4) % AVATAR_COLORS.length],
    face: AVATAR_FACES[(h >> 8) % AVATAR_FACES.length],
  };
}

const INK = "var(--critter-ink)";

function ShapePath({ shape, color }: { shape: Shape; color: string }) {
  switch (shape) {
    case "flower":
      return (
        <g fill={color}>
          <circle cx="31" cy="31" r="25" />
          <circle cx="69" cy="31" r="25" />
          <circle cx="31" cy="69" r="25" />
          <circle cx="69" cy="69" r="25" />
          <rect x="22" y="22" width="56" height="56" />
        </g>
      );
    case "circle":
      return <circle cx="50" cy="50" r="46" fill={color} />;
    case "dome":
      return <path d="M6 88V52a44 44 0 0 1 88 0v36a6 6 0 0 1-6 6H12a6 6 0 0 1-6-6z" fill={color} />;
    case "capsules":
      return (
        <g fill={color}>
          <rect x="10" y="5" width="80" height="32" rx="16" />
          <rect x="4" y="34" width="86" height="32" rx="16" />
          <rect x="10" y="63" width="80" height="32" rx="16" />
        </g>
      );
    case "scallop":
      return (
        <g fill={color}>
          <rect x="6" y="18" width="88" height="64" rx="16" />
          <circle cx="27" cy="20" r="17" />
          <circle cx="73" cy="20" r="17" />
          <circle cx="27" cy="80" r="17" />
          <circle cx="73" cy="80" r="17" />
        </g>
      );
    case "crown":
      return (
        <g fill={color}>
          <rect x="8" y="26" width="84" height="68" rx="14" />
          <circle cx="23" cy="24" r="15" />
          <circle cx="50" cy="20" r="15" />
          <circle cx="77" cy="24" r="15" />
        </g>
      );
    case "hexagon":
      return (
        <polygon
          points="50,8 90,30 90,70 50,92 10,70 10,30"
          fill={color}
          stroke={color}
          strokeWidth="12"
          strokeLinejoin="round"
        />
      );
    case "triangle":
      return <polygon points="50,12 92,86 8,86" fill={color} stroke={color} strokeWidth="12" strokeLinejoin="round" />;
    case "square":
      return <rect x="6" y="6" width="88" height="88" rx="14" fill={color} />;
    case "quarter":
      return <path d="M8 92V14a6 6 0 0 1 6-6c43 0 78 35 78 78a6 6 0 0 1-6 6z" fill={color} />;
    case "heart":
      return (
        <path
          d="M50 92C45 88 6 64 6 34 6 18 18 7 32 7c8 0 14 4 18 10 4-6 10-10 18-10 14 0 26 11 26 27 0 30-39 54-44 58z"
          fill={color}
        />
      );
    case "blob":
      return (
        <path
          d="M50 6c14 0 20 8 30 12s14 14 14 28-6 22-10 32-16 16-34 16-26-6-32-16S6 60 6 46s8-20 14-26S36 6 50 6z"
          fill={color}
        />
      );
  }
}

function FaceMarks({ face, shape, spin }: { face: Face; shape: Shape; spin?: boolean }) {
  // 依造型微調臉的位置，讓三角形、四分之一圓的臉落在視覺中心。
  const dy = shape === "triangle" ? 14 : shape === "dome" ? 6 : shape === "quarter" ? 12 : shape === "heart" ? -4 : 0;
  const dx = shape === "quarter" ? -6 : 0;
  const stroke = { stroke: INK, strokeWidth: 5, strokeLinecap: "round" as const, fill: "none" };
  return (
    <g transform={`translate(${dx} ${dy})`}>
      {face === "calm" && (
        <>
          <path d="M30 44q6 6 12 0" {...stroke} />
          <path d="M58 44q6 6 12 0" {...stroke} />
          <path d="M36 58q14 12 28 0" {...stroke} />
        </>
      )}
      {face === "content" && (
        <>
          <path d="M31 46q6 6 12 0" {...stroke} />
          <path d="M57 46q6 6 12 0" {...stroke} />
          <path d="M44 60q6 5 12 0" {...stroke} />
        </>
      )}
      {face === "sleepy" && (
        <>
          <path d="M30 48h13" {...stroke} />
          <path d="M57 48h13" {...stroke} />
          <path d="M45 61h10" {...stroke} />
        </>
      )}
      {face === "lookUp" && (
        <>
          <circle cx="36" cy="46" r="11" fill="#fff" />
          <circle cx="64" cy="46" r="11" fill="#fff" />
          <circle cx="37" cy="41" r="5.5" fill={INK} />
          <circle cx="65" cy="41" r="5.5" fill={INK} />
        </>
      )}
      {face === "side" && (
        <>
          <ellipse cx="38" cy="50" rx="11" ry="8" fill="#fff" transform="rotate(-12 38 50)" />
          <ellipse cx="64" cy="48" rx="11" ry="8" fill="#fff" transform="rotate(-12 64 48)" />
          <circle cx="33" cy="51" r="5" fill={INK} />
          <circle cx="59" cy="49" r="5" fill={INK} />
        </>
      )}
      {face === "spiral" && (
        <>
          <circle cx="36" cy="48" r="11" fill="#fff" />
          <circle cx="36" cy="48" r="5.5" fill={INK} />
          <circle cx="64" cy="48" r="11" fill="#fff" />
          <g style={spin ? { transformOrigin: "64px 48px", animation: "critter-spin 1.2s linear infinite" } : undefined}>
            <path d="M64 48m0-1.5a1.5 1.5 0 1 1-1.5 1.5a4 4 0 0 1 4-4a6 6 0 0 1 6 6a8 8 0 0 1-8 8" stroke="var(--audio)" strokeWidth="3.2" fill="none" strokeLinecap="round" />
          </g>
        </>
      )}
      {face === "flat" && (
        <>
          <path d="M28 42h16" {...stroke} />
          <path d="M56 42h16" {...stroke} />
          <circle cx="37" cy="49" r="4.5" fill={INK} />
          <circle cx="63" cy="49" r="4.5" fill={INK} />
          <path d="M40 64h20" {...stroke} />
        </>
      )}
      {face === "squint" && (
        <>
          <path d="M32 42l9 5-9 5" {...stroke} />
          <path d="M68 42l-9 5 9 5" {...stroke} />
          <path d="M44 62h12" {...stroke} />
        </>
      )}
      {face === "open" && (
        <>
          <path d="M31 44q6 6 12 0" {...stroke} />
          <path d="M57 44q6 6 12 0" {...stroke} />
          <ellipse cx="50" cy="61" rx="6" ry="7" fill={INK} />
        </>
      )}
    </g>
  );
}

interface CritterProps {
  kind?: CritterKind;
  /** 直接指定造型（導覽列等）。 */
  spec?: { shape: Shape; face: Face; color: string };
  /** 個案頭像：給 id 時忽略 kind，依 id 產生固定造型。 */
  avatarId?: string;
  size?: number;
  className?: string;
  style?: CSSProperties;
  /** 處理中角色的螺旋眼轉動、錄音角色的跳動。 */
  animate?: boolean;
  title?: string;
}

export function Critter({ kind = "brand", spec: custom, avatarId, size = 48, className, style, animate, title }: CritterProps) {
  const spec = custom ?? (avatarId ? avatarSpec(avatarId) : KINDS[kind]);
  return (
    <svg
      viewBox="0 0 100 100"
      width={size}
      height={size}
      className={className}
      style={{
        flexShrink: 0,
        overflow: "visible",
        animation: animate && kind === "audio" && !avatarId ? "critter-bob 0.9s ease-in-out infinite" : undefined,
        ...style,
      }}
      role={title ? "img" : undefined}
      aria-label={title}
      aria-hidden={title ? undefined : true}
    >
      <ShapePath shape={spec.shape} color={spec.color} />
      <FaceMarks face={spec.face} shape={spec.shape} spin={animate} />
    </svg>
  );
}
