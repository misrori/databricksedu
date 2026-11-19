// bhj-scene.jsx — Broadcast-Hash Join, hand-drawn whiteboard explainer.
// Reads timeline globals set by animations.jsx.
const { Stage, Sprite, useSprite, Easing, clamp } = window;

// ── palette ──────────────────────────────────────────────────────────────
const PAPER = '#f3eee1';
const INK   = '#2c2a26';
const SOFT  = '#8f897c';
const ACCENT = '#d1682e';
const RED   = '#bf3b2f';
const HAND = "'Caveat', cursive";
const BODY = "'Kalam', cursive";
const ROUGH = '235px 18px 225px 20px / 20px 220px 22px 235px';

// ── reveal helper: eased 0..1 based on scene-local time ────────────────────
function useAppear(at, dur = 0.5, ease = Easing.easeOutCubic) {
  const { localTime } = useSprite();
  return ease(clamp((localTime - at) / dur, 0, 1));
}
function useLocal() { return useSprite().localTime; }

// ── scene fade wrapper ─────────────────────────────────────────────────────
function Scene({ children, pad = 0.5 }) {
  const { localTime, duration } = useSprite();
  const op = Math.min(clamp(localTime / pad, 0, 1), clamp((duration - localTime) / pad, 0, 1));
  return <div style={{ position: 'absolute', inset: 0, opacity: op }}>{children}</div>;
}

// ── primitives ─────────────────────────────────────────────────────────────
function Box({ x, y, w, h, appear = 1, color = INK, bg = 'transparent', rot = 0, thick = 3, radius = ROUGH, children, style }) {
  return (
    <div style={{
      position: 'absolute', left: x, top: y, width: w, height: h,
      border: `${thick}px solid ${color}`, borderRadius: radius, background: bg,
      transform: `translateY(${(1 - appear) * 10}px) rotate(${rot}deg) scale(${0.97 + 0.03 * appear})`,
      opacity: appear, boxSizing: 'border-box', ...style,
    }}>{children}</div>
  );
}

function T({ x, y, size = 34, children, color = INK, font = BODY, weight = 400, align = 'left', rot = 0, op = 1, width, lh = 1.15, style }) {
  return (
    <div style={{
      position: 'absolute', left: x, top: y, width, fontFamily: font, fontSize: size,
      fontWeight: weight, color, textAlign: align, lineHeight: lh, opacity: op,
      transform: `rotate(${rot}deg)`, whiteSpace: width ? 'normal' : 'pre', ...style,
    }}>{children}</div>
  );
}

// hand-drawn curved arrow (draw-on via normalized pathLength)
function Arrow({ x1, y1, x2, y2, cx, cy, progress = 1, color = INK, w = 3, head = 16, dashed = false }) {
  cx = cx == null ? (x1 + x2) / 2 : cx;
  cy = cy == null ? (y1 + y2) / 2 : cy;
  const d = `M ${x1} ${y1} Q ${cx} ${cy} ${x2} ${y2}`;
  const ang = Math.atan2(y2 - cy, x2 - cx);
  const a1 = ang + Math.PI - 0.42, a2 = ang + Math.PI + 0.42;
  const hx1 = x2 + head * Math.cos(a1), hy1 = y2 + head * Math.sin(a1);
  const hx2 = x2 + head * Math.cos(a2), hy2 = y2 + head * Math.sin(a2);
  const headOp = clamp((progress - 0.75) / 0.25, 0, 1);
  return (
    <svg style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', overflow: 'visible', pointerEvents: 'none' }}>
      <path d={d} fill="none" stroke={color} strokeWidth={w} strokeLinecap="round"
        pathLength="1" strokeDasharray={dashed ? '0.014 0.02' : '1'} strokeDashoffset={dashed ? 0 : 1 - progress}
        opacity={dashed ? progress : 1} />
      {head > 0 && (
        <path d={`M ${hx1} ${hy1} L ${x2} ${y2} L ${hx2} ${hy2}`} fill="none" stroke={color}
          strokeWidth={w} strokeLinecap="round" strokeLinejoin="round" opacity={headOp} />
      )}
    </svg>
  );
}

// underline squiggle
function Squiggle({ x1, y1, x2, dip = 10, progress = 1, color = ACCENT, w = 5 }) {
  return <Arrow x1={x1} y1={y1} x2={x2} y2={y1} cx={(x1 + x2) / 2} cy={y1 + dip} progress={progress} color={color} w={w} head={0} />;
}

// caption block (top-left)
function Caption({ step, title, sub }) {
  const a = useAppear(0.0, 0.5);
  const b = useAppear(0.25, 0.5);
  return (
    <div style={{ position: 'absolute', left: 96, top: 66 }}>
      {step != null && (
        <div style={{ opacity: a, transform: `translateY(${(1 - a) * 8}px)`, fontFamily: BODY, fontSize: 26, letterSpacing: '0.14em', color: ACCENT, fontWeight: 700 }}>
          {step}
        </div>
      )}
      <div style={{ opacity: a, transform: `translateY(${(1 - a) * 10}px)`, fontFamily: HAND, fontSize: 76, color: INK, lineHeight: 1, marginTop: 4 }}>
        {title}
      </div>
      {sub && (
        <div style={{ opacity: b, transform: `translateY(${(1 - b) * 8}px)`, fontFamily: BODY, fontSize: 30, color: SOFT, marginTop: 10 }}>
          {sub}
        </div>
      )}
    </div>
  );
}

// small sketched table (header + rows)
function TableSketch({ x, y, w, title, rows, appear = 1, headBg = INK, color = INK, rowH = 46 }) {
  const h = 62 + rows.length * rowH + 14;
  return (
    <Box x={x} y={y} w={w} h={h} appear={appear} color={color} bg="#fbf8ef">
      <div style={{ position: 'absolute', inset: 0, padding: 12, display: 'flex', flexDirection: 'column' }}>
        <div style={{ fontFamily: HAND, fontSize: 40, color, lineHeight: 1, marginLeft: 6 }}>{title}</div>
        <div style={{ height: 2, background: color, opacity: 0.5, margin: '8px 4px 10px' }} />
        {rows.map((r, i) => (
          <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 12, height: rowH, fontFamily: BODY, fontSize: 27, color: INK, opacity: 0.92, borderBottom: i < rows.length - 1 ? '1.5px dashed rgba(44,42,38,.22)' : 'none' }}>
            {r}
          </div>
        ))}
      </div>
    </Box>
  );
}

// ── the RAM hash table (used in build + probe scenes) ──────────────────────
const BUCKETS = [
  { addr: '0431', empty: true },
  { addr: '1105', pid: '102', name: 'Shirt' },
  { addr: '2860', empty: true },
  { addr: '4832', pid: '101', name: 'Shoe' },
  { addr: '5555', empty: true, tag: '( empty )' },
  { addr: '6207', empty: true },
  { addr: '7642', pid: '205', name: 'Coat' },
];

function HashTable({ x, y, appear = 1, fillAt = {}, highlight = null, glow = null }) {
  const local = useLocal();
  const w = 520, rowH = 84;
  const h = 92 + BUCKETS.length * rowH + 16;
  return (
    <Box x={x} y={y} w={w} h={h} appear={appear} color={INK} bg="#fbf8ef" thick={3.5}>
      <div style={{ position: 'absolute', inset: 0, padding: 18, display: 'flex', flexDirection: 'column' }}>
        <div style={{ fontFamily: HAND, fontSize: 42, color: INK, lineHeight: 1 }}>RAM · hash table</div>
        <div style={{ fontFamily: BODY, fontSize: 22, color: SOFT }}>address (bucket) → value</div>
        <div style={{ height: 2, background: INK, opacity: 0.45, margin: '10px 2px 8px' }} />
        {BUCKETS.map((b, i) => {
          const filled = !b.empty && (fillAt[b.addr] == null || local >= fillAt[b.addr]);
          const isHi = highlight === b.addr;
          const isGlow = glow === b.addr;
          return (
            <div key={i} style={{
              display: 'flex', alignItems: 'center', gap: 16, height: rowH,
              padding: '0 12px', borderRadius: 12,
              background: isHi ? 'rgba(209,104,46,0.14)' : isGlow ? 'rgba(191,59,47,0.10)' : 'transparent',
              border: isHi ? `2.5px solid ${ACCENT}` : isGlow ? `2.5px dashed ${RED}` : '2.5px solid transparent',
              transition: 'none',
            }}>
              <div style={{ fontFamily: BODY, fontSize: 30, color: SOFT, width: 84, fontWeight: 700 }}>{b.addr}</div>
              <div style={{ fontFamily: BODY, fontSize: 26, color: SOFT }}>→</div>
              {b.empty ? (
                <div style={{ fontFamily: BODY, fontSize: 27, color: '#c3bdae' }}>{b.tag || '· · ·'}</div>
              ) : (
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, opacity: filled ? 1 : 0, transform: `scale(${filled ? 1 : 0.7})`, transformOrigin: 'left center' }}>
                  <span style={{ fontFamily: BODY, fontSize: 28, fontWeight: 700, color: INK, background: 'rgba(44,42,38,.08)', padding: '2px 10px', borderRadius: 8 }}>{b.pid}</span>
                  <span style={{ fontFamily: BODY, fontSize: 28, color: INK }}>|</span>
                  <span style={{ fontFamily: HAND, fontSize: 36, color: ACCENT, lineHeight: 1 }}>{b.name}</span>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </Box>
  );
}

// hash() machine bubble
function HashBubble({ x, y, appear = 1, formula, live = false }) {
  const local = useLocal();
  const wob = live ? Math.sin(local * 8) * 1.5 : 0;
  return (
    <>
      <Box x={x} y={y} w={280} h={170} appear={appear} color={INK} bg="#fff8ee" thick={3.5} rot={-1.5}
        radius="60% 40% 55% 45% / 55% 45% 60% 40%">
        <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', transform: `translateX(${wob}px)` }}>
          <div style={{ fontFamily: HAND, fontSize: 58, color: INK, lineHeight: 1 }}>hash()</div>
          <div style={{ fontFamily: BODY, fontSize: 22, color: SOFT, marginTop: 4 }}>MurmurHash3</div>
        </div>
      </Box>
      {formula && (
        <T x={x - 12} y={y + 182} size={34} width={310} align="center" color={ACCENT} font={BODY} weight={700}>{formula}</T>
      )}
    </>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// SCENES
// ═══════════════════════════════════════════════════════════════════════════

function SceneTitle() {
  const t = useLocal();
  const drift = Math.sin(t * 0.7) * 5;
  const u = useAppear(0.9, 1.0);
  return (
    <Scene>
      <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', transform: `translateY(${drift}px)` }}>
        <T x={0} y={0} size={30} width={1920} align="center" color={ACCENT} font={BODY} weight={700} style={{ letterSpacing: '0.22em', position: 'static', marginBottom: 8, opacity: useAppear(0.1) }}>
          APACHE SPARK · JOIN STRATEGIES
        </T>
        <div style={{ fontFamily: HAND, fontSize: 168, color: INK, lineHeight: 0.95, opacity: useAppear(0.2, 0.7), transform: `scale(${0.94 + 0.06 * useAppear(0.2, 0.7)})` }}>
          Broadcast-Hash Join
        </div>
        <div style={{ position: 'relative', width: 1000, height: 30 }}>
          <Squiggle x1={90} y1={14} x2={910} dip={16} progress={u} color={ACCENT} w={7} />
        </div>
        <T x={0} y={0} size={44} width={1920} align="center" color={SOFT} font={BODY} style={{ position: 'static', marginTop: 26, opacity: useAppear(1.4, 0.6) }}>
          Spark's fastest join — sketched out, step by step
        </T>
      </div>
    </Scene>
  );
}

function SceneSetup() {
  const braceP = useAppear(3.0, 0.9);
  return (
    <Scene>
      <Caption title="The setup" sub="Two tables to join — one huge, one tiny" />
      {/* big table */}
      <TableSketch x={150} y={300} w={520} title="Orders  (BIG)"
        appear={useAppear(0.4, 0.6)}
        rows={[
          <span key="a"><b>order</b> · <b>product_id</b></span>,
          <span key="b">#1001 · 101</span>,
          <span key="c">#1002 · 205</span>,
          <span key="d" style={{ color: SOFT }}>… billions of rows …</span>,
        ]} />
      <T x={150} y={302 + 62 + 4 * 46 + 30} size={30} width={520} align="center" color={SOFT}
        op={useAppear(1.0)}>terabytes · lives spread across the cluster</T>

      {/* small table */}
      <TableSketch x={1260} y={330} w={480} title="Products  (small)"
        appear={useAppear(1.4, 0.6)} color={ACCENT}
        rows={[
          <span key="a"><b>id</b> · name</span>,
          <span key="b">101 · Shoe</span>,
          <span key="c">102 · Shirt</span>,
          <span key="d">205 · Coat</span>,
        ]} />
      <T x={1260} y={332 + 62 + 4 * 46 + 30} size={30} width={480} align="center" color={SOFT}
        op={useAppear(2.0)}>only a few MB</T>

      {/* join note */}
      <T x={720} y={470} size={44} width={480} align="center" color={INK} font={HAND}
        op={useAppear(2.4, 0.5)}>join on</T>
      <T x={700} y={528} size={40} width={520} align="center" color={INK} font={BODY} weight={700}
        op={useAppear(2.6, 0.5)}>orders.product_id = products.id</T>
      {/* connecting arrows */}
      <Arrow x1={680} y1={470} x2={430} y2={412} cx={560} cy={410} progress={braceP} color={SOFT} w={3} />
      <Arrow x1={1235} y1={470} x2={1470} y2={445} cx={1360} cy={420} progress={braceP} color={SOFT} w={3} />
    </Scene>
  );
}

function SceneBroadcast() {
  const drv = useAppear(0.4, 0.6);
  const workers = [0, 1, 2].map((i) => useAppear(1.6 + i * 0.25, 0.55));
  const arr = [0, 1, 2].map((i) => useAppear(2.6 + i * 0.45, 0.7));
  const copy = [0, 1, 2].map((i) => useAppear(3.7 + i * 0.35, 0.5));
  const wx = [170, 810, 1450];
  const note = useAppear(5.6, 0.6);
  return (
    <Scene>
      <Caption step="STEP 1 / 5" title="Collect & Broadcast" />
      {/* driver */}
      <Box x={810} y={250} w={300} h={128} appear={drv} bg="#fff8ee" thick={3.5}>
        <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column' }}>
          <div style={{ fontFamily: HAND, fontSize: 52, color: INK, lineHeight: 1 }}>DRIVER</div>
          <div style={{ fontFamily: BODY, fontSize: 22, color: SOFT }}>collects the small table</div>
        </div>
      </Box>
      {/* mini products at driver */}
      <Box x={1140} y={256} w={150} h={116} appear={useAppear(1.0, 0.5)} color={ACCENT} bg="#fdf1e7">
        <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', gap: 3 }}>
          <div style={{ fontFamily: HAND, fontSize: 30, color: ACCENT }}>Products</div>
          <div style={{ fontFamily: BODY, fontSize: 19, color: INK }}>101·102·205</div>
        </div>
      </Box>
      {/* workers */}
      {wx.map((x, i) => (
        <Box key={i} x={x} y={640} w={300} h={300} appear={workers[i]} bg="#fbf8ef" thick={3.5}>
          <div style={{ position: 'absolute', top: 16, left: 0, right: 0, textAlign: 'center', fontFamily: HAND, fontSize: 42, color: INK }}>Worker {i + 1}</div>
          {/* copy lands here */}
          <div style={{ position: 'absolute', left: 60, top: 110, width: 180, opacity: copy[i], transform: `scale(${0.8 + 0.2 * copy[i]})`, transformOrigin: 'center' }}>
            <div style={{ border: `2.5px solid ${ACCENT}`, borderRadius: ROUGH, background: '#fdf1e7', padding: '10px 6px', textAlign: 'center' }}>
              <div style={{ fontFamily: HAND, fontSize: 28, color: ACCENT, lineHeight: 1 }}>Products</div>
              <div style={{ fontFamily: BODY, fontSize: 18, color: INK, marginTop: 2 }}>full copy</div>
            </div>
          </div>
        </Box>
      ))}
      {/* broadcast arrows */}
      {wx.map((x, i) => (
        <Arrow key={i} x1={1080} y1={380} x2={x + 150} y2={632}
          cx={(1080 + x + 150) / 2 + (i - 1) * 40} cy={520} progress={arr[i]} color={ACCENT} w={4} head={20} />
      ))}
      <T x={560} y={520} size={34} width={800} align="center" color={INK} font={HAND} op={note}>
        every worker gets a full copy — sent BitTorrent-style
      </T>
    </Scene>
  );
}

function SceneBuild() {
  const products = [
    { pid: '101', name: 'Shoe', addr: '4832' },
    { pid: '102', name: 'Shirt', addr: '1105' },
    { pid: '205', name: 'Coat', addr: '7642' },
  ];
  const local = useLocal();
  const bubbleAppear = useAppear(1.2, 0.5);
  // per-row schedule
  const base = 2.4, step = 2.0;
  const rowArrow = products.map((_, i) => useAppear(base + i * step, 0.6));
  const rowLand = products.map((_, i) => base + i * step + 1.0); // fill time for hash table
  const fillAt = {};
  products.forEach((p, i) => { fillAt[p.addr] = rowLand[i]; });
  // live formula
  let formula = 'hash(key) → address';
  for (let i = 0; i < products.length; i++) {
    if (local >= base + i * step) formula = `hash(${products[i].pid}) = ${products[i].addr}`;
  }
  const pyBase = 300, pgap = 150;
  return (
    <Scene>
      <Caption step="STEP 2 / 5" title="Build the hash table" sub="hash each key of the small table — once, in memory" />
      {/* products */}
      {products.map((p, i) => {
        const ap = useAppear(0.4 + i * 0.2, 0.5);
        return (
          <Box key={i} x={110} y={pyBase + i * pgap} w={300} h={104} appear={ap} color={ACCENT} bg="#fdf1e7" thick={3}>
            <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', gap: 16, padding: '0 22px' }}>
              <span style={{ fontFamily: BODY, fontSize: 40, fontWeight: 700, color: INK }}>{p.pid}</span>
              <span style={{ fontFamily: BODY, fontSize: 30, color: SOFT }}>|</span>
              <span style={{ fontFamily: HAND, fontSize: 48, color: ACCENT, lineHeight: 1 }}>{p.name}</span>
            </div>
          </Box>
        );
      })}
      {/* hash bubble */}
      <HashBubble x={600} y={470} appear={bubbleAppear} formula={formula} live={local > base && local < base + 3 * step} />
      {/* arrows product -> hash, hash -> bucket */}
      {products.map((p, i) => {
        const by = 260 + [3, 1, 6][i] * 84 + 92 + 18 + 42; // approx bucket y in table
        return (
          <React.Fragment key={i}>
            <Arrow x1={420} y1={pyBase + i * pgap + 52} x2={588} y2={555}
              cx={520} cy={pyBase + i * pgap + 20} progress={rowArrow[i]} color={INK} w={3} />
          </React.Fragment>
        );
      })}
      {/* landing arrow from hash to table (single, follows latest) */}
      <Arrow x1={880} y1={555} x2={1300} y2={470}
        cx={1080} cy={430} progress={useAppear(base + 0.4, 0.6)} color={INK} w={3} dashed />
      {/* hash table */}
      <HashTable x={1300} y={210} appear={useAppear(1.6, 0.6)} fillAt={fillAt} />
      <T x={110} y={pyBase + 3 * pgap + 30} size={30} width={480} align="center" color={SOFT} op={useAppear(9.3)}>
        the small table now lives in RAM, keyed for instant lookup
      </T>
    </Scene>
  );
}

function SceneProbe() {
  const local = useLocal();
  // order 1: 101 -> HIT ; order 2: 999 -> MISS
  const o1in = useAppear(1.0, 0.7);
  const o1hash = useAppear(2.0, 0.5);
  const o1arrow = useAppear(2.6, 0.6);
  const o1hit = useAppear(3.2, 0.5);
  const o1out = useAppear(3.7, 0.5);
  const o2in = useAppear(5.0, 0.7);
  const o2hash = useAppear(6.4, 0.5);
  const o2arrow = useAppear(6.9, 0.6);
  const o2miss = useAppear(7.5, 0.5);
  const o2out = useAppear(8.0, 0.5);
  const stamp = useAppear(9.6, 0.6);

  const phase2 = local >= 5.0;
  const activeOrder = phase2 ? { pid: '999', y: 470 } : { pid: '101', y: 320 };
  const inP = phase2 ? o2in : o1in;
  const formula = phase2 ? (o2hash > 0 ? 'hash(999) = 5555' : '') : (o1hash > 0 ? 'hash(101) = 4832' : '');
  const highlight = (!phase2 && o1arrow > 0.2) ? '4832' : null;
  const glow = (phase2 && o2arrow > 0.2) ? '5555' : null;

  return (
    <Scene>
      <Caption step="STEP 3 / 5" title="Probe the big table" sub="hash each big-table key on the fly → jump straight to the bucket" />
      {/* incoming order card */}
      <Box x={120} y={activeOrder.y} w={340} h={112} appear={inP} color={INK} bg="#fbf8ef" thick={3}
        style={{ transform: `translateX(${(1 - inP) * -60}px)` }}>
        <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', gap: 14, padding: '0 20px' }}>
          <span style={{ fontFamily: HAND, fontSize: 34, color: SOFT }}>order</span>
          <span style={{ fontFamily: BODY, fontSize: 26, color: SOFT }}>·</span>
          <span style={{ fontFamily: BODY, fontSize: 26, color: INK }}>pid</span>
          <span style={{ fontFamily: BODY, fontSize: 44, fontWeight: 700, color: ACCENT }}>{activeOrder.pid}</span>
        </div>
      </Box>
      {/* hash bubble */}
      <HashBubble x={600} y={430} appear={1} formula={formula} live={inP > 0.5} />
      {/* arrow order -> hash */}
      <Arrow x1={470} y1={activeOrder.y + 56} x2={588} y2={515}
        cx={540} cy={activeOrder.y} progress={inP} color={INK} w={3} />
      {/* arrow hash -> table */}
      <Arrow x1={880} y1={515} x2={1300} y2={phase2 ? 560 : 470}
        cx={1080} cy={phase2 ? 620 : 400} progress={phase2 ? o2arrow : o1arrow}
        color={phase2 ? RED : ACCENT} w={4} head={20} />
      {/* result badges */}
      {!phase2 && (
        <>
          <T x={620} y={640} size={54} width={280} align="center" font={HAND} color={ACCENT} op={o1hit}>✓ HIT</T>
          <Box x={560} y={720} w={400} h={90} appear={o1out} color={ACCENT} bg="#fdf1e7">
            <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: BODY, fontSize: 40, color: INK }}>
              101 → <span style={{ fontFamily: HAND, fontSize: 50, color: ACCENT, margin: '0 10px' }}>Shoe</span>
            </div>
          </Box>
        </>
      )}
      {phase2 && (
        <>
          <T x={620} y={640} size={54} width={280} align="center" font={HAND} color={RED} op={o2miss}>✗ MISS</T>
          <Box x={560} y={720} w={400} h={90} appear={o2out} color={RED} bg="#fbeeec">
            <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: BODY, fontSize: 40, color: INK }}>
              999 → <span style={{ fontFamily: BODY, fontSize: 40, fontWeight: 700, color: RED, margin: '0 10px' }}>NULL</span>
            </div>
          </Box>
        </>
      )}
      {/* hash table */}
      <HashTable x={1300} y={190} appear={1} highlight={highlight} glow={glow} />
      {/* O(1) stamp */}
      <div style={{ position: 'absolute', left: 150, top: 900, opacity: stamp, transform: `rotate(-4deg) scale(${0.9 + 0.1 * stamp})` }}>
        <div style={{ display: 'inline-block', border: `4px solid ${INK}`, borderRadius: ROUGH, padding: '10px 26px', fontFamily: HAND, fontSize: 54, color: INK, background: '#fff8ee' }}>
          O(1) — instant, no matter the table size
        </div>
      </div>
    </Scene>
  );
}

function SceneNoShuffle() {
  const wx = [170, 810, 1450];
  const workers = [0, 1, 2].map((i) => useAppear(0.4 + i * 0.2, 0.55));
  const cross = useAppear(1.6, 0.6);
  const stamp = useAppear(2.9, 0.7);
  return (
    <Scene>
      <Caption step="WHY IT WINS" title="Zero shuffle" sub="the huge table never moves across the network" />
      {wx.map((x, i) => (
        <Box key={i} x={x} y={430} w={300} h={330} appear={workers[i]} bg="#fbf8ef" thick={3.5}>
          <div style={{ position: 'absolute', top: 14, left: 0, right: 0, textAlign: 'center', fontFamily: HAND, fontSize: 38, color: INK }}>Worker {i + 1}</div>
          <div style={{ position: 'absolute', left: 30, top: 78, right: 30, border: `2.5px solid ${INK}`, borderRadius: ROUGH, background: '#f2ede1', padding: '8px', textAlign: 'center' }}>
            <div style={{ fontFamily: BODY, fontSize: 24, fontWeight: 700, color: INK }}>Orders chunk</div>
            <div style={{ fontFamily: BODY, fontSize: 18, color: SOFT }}>stays put ✓</div>
          </div>
          <div style={{ position: 'absolute', left: 70, top: 200, right: 70, border: `2.5px solid ${ACCENT}`, borderRadius: ROUGH, background: '#fdf1e7', padding: '6px', textAlign: 'center' }}>
            <div style={{ fontFamily: HAND, fontSize: 28, color: ACCENT }}>Products</div>
          </div>
        </Box>
      ))}
      {/* crossed network arrows between workers */}
      <Arrow x1={470} y1={560} x2={810} y2={560} cx={640} cy={520} progress={cross} color={SOFT} w={3} dashed />
      <Arrow x1={1110} y1={560} x2={1450} y2={560} cx={1280} cy={520} progress={cross} color={SOFT} w={3} dashed />
      {/* big X stamp */}
      <div style={{ position: 'absolute', left: 660, top: 830, opacity: stamp, transform: `rotate(-3deg) scale(${0.9 + 0.1 * stamp})` }}>
        <div style={{ border: `5px solid ${ACCENT}`, borderRadius: ROUGH, padding: '10px 34px', fontFamily: HAND, fontSize: 64, color: ACCENT, background: '#fff8ee' }}>
          NO SHUFFLE!
        </div>
      </div>
    </Scene>
  );
}

function SceneOOM() {
  const local = useLocal();
  const tag = useAppear(0.4, 0.5);
  const inflate = useAppear(1.4, 1.4, Easing.easeInOutCubic);
  const overflow = useAppear(3.2, 0.6);
  const crash = useAppear(4.3, 0.5);
  const shake = local > 3.4 && local < 5.4 ? Math.sin(local * 42) * (5 * (1 - clamp((local - 3.4) / 2, 0, 1))) : 0;
  const note = useAppear(5.6, 0.6);
  const balloon = 130 + inflate * 340;
  return (
    <Scene>
      <Caption step="THE DANGER" title="Out of Memory" sub="what if the 'small' table isn't actually small?" />
      {/* balloon growing */}
      <div style={{ position: 'absolute', left: 300 - balloon / 2, top: 520 - balloon / 2, width: balloon, height: balloon * 0.8, border: `4px solid ${RED}`, borderRadius: '55% 45% 50% 50% / 55% 55% 45% 45%', background: 'rgba(191,59,47,0.08)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column' }}>
        <div style={{ fontFamily: HAND, fontSize: 40 + inflate * 30, color: RED, lineHeight: 1 }}>{inflate < 0.5 ? '5 MB?' : '5 GB!!'}</div>
        <div style={{ fontFamily: BODY, fontSize: 22, color: INK, opacity: tag }}>Products</div>
      </div>
      <T x={80} y={760} size={30} width={520} align="center" color={SOFT} op={tag}>Spark thinks it's tiny…</T>

      {/* worker RAM overflowing */}
      <Box x={1120} y={330} w={560} h={420} appear={useAppear(0.6, 0.6)} color={INK} bg="#fbf8ef" thick={3.5}
        style={{ transform: `translateX(${shake}px)` }}>
        <div style={{ position: 'absolute', top: 18, left: 0, right: 0, textAlign: 'center', fontFamily: HAND, fontSize: 44, color: INK }}>Worker RAM</div>
        {/* fill bar */}
        <div style={{ position: 'absolute', left: 30, right: 30, bottom: 30, top: 90, border: `2.5px dashed ${SOFT}`, borderRadius: 14, overflow: 'hidden' }}>
          <div style={{ position: 'absolute', left: 0, right: 0, bottom: 0, height: `${60 + overflow * 60}%`, background: overflow > 0.5 ? 'rgba(191,59,47,0.22)' : 'rgba(209,104,46,0.18)', borderTop: `3px solid ${overflow > 0.5 ? RED : ACCENT}` }} />
          <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: HAND, fontSize: 42, color: overflow > 0.5 ? RED : INK, opacity: overflow }}>
            can't fit the hash table!
          </div>
        </div>
      </Box>
      {/* crash stamp */}
      <div style={{ position: 'absolute', left: 560, top: 860, opacity: crash, transform: `rotate(-5deg) scale(${0.85 + 0.15 * crash}) translateX(${shake * 0.6}px)` }}>
        <div style={{ border: `6px solid ${RED}`, borderRadius: ROUGH, padding: '12px 40px', fontFamily: HAND, fontSize: 74, color: RED, background: '#fff5f3' }}>
          💥 OOM — crash!
        </div>
      </div>
      <T x={700} y={1000} size={30} width={520} align="center" color={SOFT} op={note}>
        set spark.sql.autoBroadcastJoinThreshold with care
      </T>
    </Scene>
  );
}

function SceneClosing() {
  const bullets = [
    'broadcast the small table to every worker',
    'hash it once — build the table in RAM',
    'probe the big table in O(1) — no shuffle',
  ];
  return (
    <Scene>
      <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', justifyContent: 'center', paddingLeft: 200 }}>
        <div style={{ fontFamily: HAND, fontSize: 110, color: INK, lineHeight: 1, opacity: useAppear(0.15, 0.6) }}>
          Broadcast-Hash Join
        </div>
        <div style={{ position: 'relative', width: 760, height: 26, marginTop: 6, marginBottom: 40 }}>
          <Squiggle x1={10} y1={12} x2={720} dip={12} progress={useAppear(0.5, 0.8)} color={ACCENT} w={6} />
        </div>
        {bullets.map((b, i) => {
          const a = useAppear(0.7 + i * 0.5, 0.5);
          return (
            <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 22, marginBottom: 26, opacity: a, transform: `translateX(${(1 - a) * 24}px)` }}>
              <div style={{ width: 22, height: 22, borderRadius: '60% 40% 55% 45%', background: ACCENT, flexShrink: 0 }} />
              <div style={{ fontFamily: BODY, fontSize: 46, color: INK }}>{b}</div>
            </div>
          );
        })}
      </div>
    </Scene>
  );
}

// ── dot-grid paper ──────────────────────────────────────────────────────────
function Paper() {
  return (
    <div style={{
      position: 'absolute', inset: 0,
      backgroundImage: 'radial-gradient(rgba(44,42,38,0.10) 1.6px, transparent 1.6px)',
      backgroundSize: '46px 46px', backgroundPosition: '12px 12px', pointerEvents: 'none',
    }} />
  );
}

// ── top-right persistent step counter dots ──────────────────────────────────
function ProgressDots({ index }) {
  return (
    <div style={{ position: 'absolute', right: 90, top: 84, display: 'flex', gap: 14 }}>
      {[1, 2, 3, 4, 5].map((n) => (
        <div key={n} style={{
          width: 16, height: 16, borderRadius: '60% 40% 55% 45%',
          background: index === n ? ACCENT : 'transparent',
          border: `2.5px solid ${index === n ? ACCENT : SOFT}`,
        }} />
      ))}
    </div>
  );
}

function StepDots() {
  const { time } = window.useTimeline();
  let idx = 0;
  if (time >= 11 && time < 22) idx = 1;
  else if (time >= 22 && time < 35) idx = 2;
  else if (time >= 35 && time < 49) idx = 3;
  else if (time >= 49 && time < 55) idx = 4;
  else if (time >= 55 && time < 63) idx = 5;
  if (idx === 0) return null;
  return <ProgressDots index={idx} />;
}

function BHJScene() {
  return (
    <Stage width={1920} height={1080} duration={67} background={PAPER} persistKey="bhj">
      <Paper />
      <Sprite start={0} end={4}><SceneTitle /></Sprite>
      <Sprite start={4} end={11}><SceneSetup /></Sprite>
      <Sprite start={11} end={22}><SceneBroadcast /></Sprite>
      <Sprite start={22} end={35}><SceneBuild /></Sprite>
      <Sprite start={35} end={49}><SceneProbe /></Sprite>
      <Sprite start={49} end={55}><SceneNoShuffle /></Sprite>
      <Sprite start={55} end={63}><SceneOOM /></Sprite>
      <Sprite start={63} end={67}><SceneClosing /></Sprite>
      <StepDots />
    </Stage>
  );
}

window.BHJScene = BHJScene;
