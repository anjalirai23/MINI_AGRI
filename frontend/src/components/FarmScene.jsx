import { useId } from "react";

function Stalk({ x, y, h, lean = 0, delay = 0, scale = 1 }) {
  const topX = x + lean;
  const topY = y - h;
  const grains = [];
  for (let i = 0; i < 7; i++) {
    const gy = topY + i * 7 * scale;
    const gx = topX + lean * 0.04 * i;
    grains.push(
      <ellipse key={"l" + i} cx={gx - 4 * scale} cy={gy} rx={2.4 * scale} ry={5.6 * scale} transform={`rotate(-26 ${gx - 4 * scale} ${gy})`} />,
      <ellipse key={"r" + i} cx={gx + 4 * scale} cy={gy + 3} rx={2.4 * scale} ry={5.6 * scale} transform={`rotate(26 ${gx + 4 * scale} ${gy + 3})`} />
    );
  }
  return (
    <g className="fs-sway" style={{ animationDelay: delay + "s", transformOrigin: `${x}px ${y}px` }}>
      <path d={`M${x},${y} Q${x + lean * 0.2},${y - h * 0.55} ${topX},${topY}`} stroke="#6f8a2a" strokeWidth={2.6 * scale} fill="none" strokeLinecap="round" />
      <g fill="url(#grain)">{grains}</g>
      <path d={`M${topX},${topY - 4} l${-2 * scale},${-16 * scale} M${topX},${topY - 4} l${3 * scale},${-15 * scale}`} stroke="#e8c060" strokeWidth={1} />
    </g>
  );
}

function Tree({ x, y, s = 1, tone = "#12402a" }) {
  return (
    <g transform={`translate(${x} ${y}) scale(${s})`}>
      <rect x="-1.5" y="0" width="3" height="14" fill="#2b1d12" />
      <circle cx="0" cy="-6" r="13" fill={tone} />
      <circle cx="-9" cy="2" r="9" fill={tone} />
      <circle cx="9" cy="2" r="9" fill={tone} />
    </g>
  );
}

export default function FarmScene({ className = "", sunX = 1330, align = "xMidYMax slice", viewBox = "0 0 1440 640" }) {
  const uid = useId().replace(/:/g, "");
  const id = (n) => `${n}-${uid}`;

  const vx = 720;
  const vy = 372;
  const rows = [];
  for (let i = -14; i <= 14; i++) {
    rows.push(<line key={i} x1={vx + i * 7} y1={vy} x2={vx + i * 150} y2={620} />);
  }

  const stalksLeft = [
    [22, 640, 170, -10, 0], [64, 640, 205, 12, 0.4], [108, 640, 150, -8, 0.9], [150, 640, 185, 10, 0.2],
  ];
  const stalksRight = [
    [1290, 640, 160, -10, 0.3], [1332, 640, 210, 12, 0.8], [1376, 640, 150, -12, 0.1], [1418, 640, 195, 10, 0.6],
  ];

  return (
    <svg
      className={"farm-scene " + className}
      viewBox={viewBox}
      preserveAspectRatio={align}
      aria-hidden="true"
      focusable="false"
    >
      <defs>
        <radialGradient id={id("sun")} cx="50%" cy="50%" r="50%">
          <stop offset="0" stopColor="#fff6c9" />
          <stop offset="0.35" stopColor="#ffd45e" />
          <stop offset="1" stopColor="#ff9d2e" />
        </radialGradient>
        <radialGradient id={id("glow")} cx="50%" cy="50%" r="50%">
          <stop offset="0" stopColor="#ffc04d" stopOpacity="0.85" />
          <stop offset="0.45" stopColor="#ff9a3c" stopOpacity="0.28" />
          <stop offset="1" stopColor="#ff7a2a" stopOpacity="0" />
        </radialGradient>
        <linearGradient id={id("far")} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#3f9a74" />
          <stop offset="1" stopColor="#1f6f52" />
        </linearGradient>
        <linearGradient id={id("mid")} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#2a8a4c" />
          <stop offset="1" stopColor="#15663a" />
        </linearGradient>
        <linearGradient id={id("wheat")} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#f6d36b" />
          <stop offset="0.55" stopColor="#e5a928" />
          <stop offset="1" stopColor="#b9771a" />
        </linearGradient>
        <linearGradient id={id("green")} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#7cc443" />
          <stop offset="1" stopColor="#2f8f3a" />
        </linearGradient>
        <linearGradient id={id("fg")} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#12361f" />
          <stop offset="1" stopColor="#0a1f12" />
        </linearGradient>
        <linearGradient id="grain" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#ffe08a" />
          <stop offset="1" stopColor="#d49a22" />
        </linearGradient>
        <filter id={id("soft")} x="-30%" y="-300%" width="160%" height="700%">
          <feGaussianBlur stdDeviation="10" />
        </filter>
        <clipPath id={id("fieldclip")}>
          <path d="M0,372 L1440,372 L1440,640 L0,640 Z" />
        </clipPath>
      </defs>

      <circle cx={sunX} cy="352" r="330" fill={`url(#${id("glow")})`} />
      <circle cx={sunX} cy="352" r="62" fill={`url(#${id("sun")})`} />

      <g filter={`url(#${id("soft")})`}>
        <g className="fs-cloud fs-cloud-a" fill="#ffd9a6" opacity="0.34">
          <ellipse cx="1060" cy="150" rx="190" ry="12" />
          <ellipse cx="1130" cy="132" rx="110" ry="10" />
        </g>
        <g className="fs-cloud fs-cloud-b" fill="#ffc98f" opacity="0.3">
          <ellipse cx="300" cy="215" rx="200" ry="10" />
        </g>
        <g className="fs-cloud fs-cloud-c" fill="#ffe4bd" opacity="0.26">
          <ellipse cx="640" cy="290" rx="150" ry="8" />
          <ellipse cx="1260" cy="262" rx="130" ry="8" />
        </g>
      </g>

      <g stroke="#2a1b12" strokeWidth="1.6" fill="none" opacity="0.55" strokeLinecap="round">
        <path d="M660,256 q8,-9 16,0 q8,-9 16,0" />
        <path d="M705,232 q6,-7 12,0 q6,-7 12,0" />
        <path d="M628,226 q5,-6 10,0 q5,-6 10,0" />
      </g>

      <path d="M0,360 C140,318 250,332 380,350 C520,372 600,326 760,334 C920,342 1040,310 1180,334 C1300,354 1380,336 1440,330 L1440,640 L0,640 Z" fill={`url(#${id("far")})`} opacity="0.9" />
      <path d="M0,382 C180,350 300,368 460,380 C640,394 760,352 940,366 C1100,378 1260,356 1440,372 L1440,640 L0,640 Z" fill={`url(#${id("mid")})`} />

      <g>
        <Tree x={90} y={364} s={1.1} />
        <Tree x={128} y={368} s={0.8} tone="#17512f" />
        <Tree x={410} y={372} s={0.9} />
        <Tree x={448} y={376} s={0.7} tone="#17512f" />
        <Tree x={1180} y={366} s={1} />
        <Tree x={1222} y={370} s={0.8} tone="#17512f" />
        <Tree x={1330} y={362} s={1.2} />
        <g transform="translate(560 346)">
          <rect x="0" y="12" width="46" height="26" fill="#f1e2c4" />
          <path d="M-5,14 L23,-6 L51,14 Z" fill="#a8452a" />
          <rect x="19" y="22" width="9" height="16" fill="#6a3b22" />
          <rect x="6" y="20" width="8" height="8" fill="#ffd36b" />
          <rect x="34" y="20" width="8" height="8" fill="#ffd36b" />
          <rect x="58" y="4" width="14" height="34" fill="#cfd6d2" />
          <path d="M58,4 q7,-12 14,0 Z" fill="#8e9a94" />
        </g>
      </g>

      <g clipPath={`url(#${id("fieldclip")})`}>
        <path d="M0,386 C260,372 520,382 720,380 C940,378 1180,372 1440,388 L1440,640 L0,640 Z" fill={`url(#${id("wheat")})`} />
        <path d="M0,452 C300,430 560,440 760,436 C980,432 1200,428 1440,448 L1440,640 L0,640 Z" fill={`url(#${id("green")})`} opacity="0.92" />
        <path d="M0,520 C300,500 700,508 1000,504 C1200,502 1340,508 1440,516 L1440,640 L0,640 Z" fill={`url(#${id("wheat")})`} />
        <g stroke="#7a4a10" strokeOpacity="0.28" strokeWidth="1.4">{rows}</g>
        <path d="M0,572 L1440,572 L1440,640 L0,640 Z" fill="#000" opacity="0.08" />
      </g>

      <path d="M0,640 L0,590 C160,572 300,606 470,596 C680,584 780,612 960,600 C1160,588 1300,606 1440,586 L1440,640 Z" fill={`url(#${id("fg")})`} />
      <g>
        {stalksLeft.map((s, i) => <Stalk key={"l" + i} x={s[0]} y={s[1]} h={s[2]} lean={s[3]} delay={s[4]} scale={1} />)}
        {stalksRight.map((s, i) => <Stalk key={"r" + i} x={s[0]} y={s[1]} h={s[2]} lean={s[3]} delay={s[4]} scale={1} />)}
      </g>
    </svg>
  );
}
