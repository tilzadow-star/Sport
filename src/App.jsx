import { useState, useEffect, useRef } from "react";

// ============================================================
//  SPORT-TRACKER  –  mit Golf-Majors und Sportart-Filter
//  Quellen:
//   getF1()        -> Formel 1        (Jolpica/Ergast)
//   getFootball()  -> CL + DFB-Pokal  (OpenLigaDB)
//   getTennis()    -> ATP + WTA       (ESPN, inoffiziell)
//   getGolf()      -> Majors, live    (ESPN, inoffiziell)
//   CURATED        -> Golf-Majors (Termine), Darts, Biathlon, Triathlon
// ============================================================

const SPORTS = {
  f1:        { label: "Formel 1",  color: "#B8892F" },
  fussball:  { label: "Fußball",   color: "#2E7D5B" },
  tennis:    { label: "Tennis",    color: "#6F7F33" },
  golf:      { label: "Golf",      color: "#2F6E66" },
  darts:     { label: "Darts",     color: "#A24236" },
  biathlon:  { label: "Biathlon",  color: "#3E6A99" },
  triathlon: { label: "Triathlon", color: "#3D8AA0" },
};

// ---- QUELLE 1: Formel 1 ----
async function getF1() {
  const res = await fetch("https://api.jolpi.ca/ergast/f1/2026/races/?format=json");
  const data = await res.json();
  return (data?.MRData?.RaceTable?.Races ?? []).map((r) => {
    const start = new Date(`${r.date}T${r.time || "13:00:00Z"}`);
    return {
      id: "f1-" + r.round, sport: "f1",
      title: r.raceName.replace(" Grand Prix", " GP"),
      subtitle: r.Circuit.Location.locality,
      start, end: new Date(start.getTime() + 3 * 3600e3),
    };
  });
}

// ---- QUELLE 2: Fußball – Champions League + DFB-Pokal ----
function pickLeague(leagues, rx) {
  const hits = leagues.filter((l) => rx.test(l.leagueName || ""));
  if (!hits.length) return null;
  return hits.sort((a, b) => Number(b.leagueSeason) - Number(a.leagueSeason))[0];
}
function scoreOf(m) {
  if (m.goals?.length) {
    const g = [...m.goals].reverse().find((x) => x.scoreTeam1 != null);
    if (g) return `${g.scoreTeam1}:${g.scoreTeam2}`;
  }
  const fin = (m.matchResults || []).find((r) => r.resultTypeID === 2) || (m.matchResults || [])[0];
  return fin ? `${fin.pointsTeam1}:${fin.pointsTeam2}` : null;
}
async function getFootball() {
  const now = new Date();
  const leaguesRes = await fetch("https://api.openligadb.de/getavailableleagues");
  const leagues = await leaguesRes.json();
  const targets = [
    { rx: /champions.?league/i, label: "Champions League" },
    { rx: /dfb.?pokal/i,        label: "DFB-Pokal" },
  ];
  const out = [];
  for (const t of targets) {
    const lg = pickLeague(leagues, t.rx);
    if (!lg) continue;
    try {
      const r = await fetch(`https://api.openligadb.de/getmatchdata/${lg.leagueShortcut}/${lg.leagueSeason}`);
      const matches = await r.json();
      const events = matches.map((m) => {
        const start = new Date(m.matchDateTimeUTC || m.matchDateTime);
        return {
          id: "fb-" + m.matchID, sport: "fussball",
          title: `${m.team1.shortName || m.team1.teamName} – ${m.team2.shortName || m.team2.teamName}`,
          subtitle: `${t.label}${m.group?.groupName ? " · " + m.group.groupName : ""}`,
          start, end: new Date(start.getTime() + 2.5 * 3600e3),
          finished: m.matchIsFinished, score: scoreOf(m),
          matchday: m.group?.groupOrderID ?? 999, // Spieltag / Runde
        };
      });
      // kommende Spiele nach Spieltag gruppieren und die nächsten 2 Spieltage komplett zeigen
      const upcomingM = events.filter((e) => e.end >= new Date(now.getTime() - 3 * 3600e3));
      const mdays = [...new Set(upcomingM.map((e) => e.matchday))].sort((a, b) => a - b).slice(0, 2);
      const next = upcomingM
        .filter((e) => mdays.includes(e.matchday))
        .sort((a, b) => a.start - b.start);
      out.push(...next);
    } catch { /* Liga überspringen */ }
  }
  return out;
}

// ---- QUELLE 3: Tennis – ATP + WTA (ESPN) ----
async function getTennis() {
  const tours = ["atp", "wta"];
  const tournaments = new Map();
  const liveMatches = [];
  for (const tour of tours) {
    let data;
    try {
      const r = await fetch(`https://site.api.espn.com/apis/site/v2/sports/tennis/${tour}/scoreboard`);
      data = await r.json();
    } catch { continue; }
    for (const ev of data?.events ?? []) {
      const start = new Date(ev.date);
      const end = new Date(ev.endDate || ev.date);
      if (!tournaments.has(ev.name)) {
        tournaments.set(ev.name, {
          id: "ten-" + ev.id, sport: "tennis", kind: "tournament",
          title: ev.name, subtitle: ev.major ? "Grand Slam" : "ATP/WTA",
          start, end, major: !!ev.major, badgeLabel: "Grand Slam",
        });
      }
      for (const g of ev.groupings ?? []) {
        for (const c of g.competitions ?? []) {
          if (c.status?.type?.state !== "in") continue;
          const cs = c.competitors ?? [];
          if (cs.length < 2) continue;
          // Einzel-Spieler auflösen; fehlt ein Name (z. B. Doppel/unklare Paarung), Match überspringen
          const nameOf = (p) => p.athlete?.shortName || p.athlete?.displayName || p.athlete?.lastName || null;
          const n1 = nameOf(cs[0]);
          const n2 = nameOf(cs[1]);
          if (!n1 || !n2) continue;
          const sets = (cs[0].linescores || []).map((ls, i) => {
            const a = Math.trunc(ls.value ?? 0);
            const b = Math.trunc(cs[1].linescores?.[i]?.value ?? 0);
            return `${a}-${b}`;
          }).join("  ");
          liveMatches.push({
            id: "tenm-" + c.id, sport: "tennis", kind: "match", liveOnly: true,
            title: `${n1} – ${n2}`,
            subtitle: `${ev.name}${c.round?.displayName ? " · " + c.round.displayName : ""}`,
            start: new Date(c.startDate || c.date),
            end: new Date(Date.now() + 3 * 3600e3),
            score: sets || "läuft",
          });
        }
      }
    }
  }
  // doppelte Matches (gleiche ID) herausfiltern
  const uniqueMatches = [...new Map(liveMatches.map((m) => [m.id, m])).values()];
  return [...tournaments.values(), ...uniqueMatches.slice(0, 12)];
}

// ---- QUELLE 4: Golf-Majors, live (ESPN) ----
//  Zeigt NUR während einer laufenden Major-Woche eine Live-Karte
//  mit dem aktuellen Führenden. Die Termine der Majors kommen aus
//  der gepflegten Liste unten (immer sichtbar, auch außerhalb der Saison).
const GOLF_MAJOR_RX = /masters|pga championship|u\.?s\.? open|open championship|the open/i;
async function getGolf() {
  let data;
  try {
    const r = await fetch("https://site.api.espn.com/apis/site/v2/sports/golf/pga/scoreboard");
    data = await r.json();
  } catch { return []; }
  const out = [];
  for (const ev of data?.events ?? []) {
    const comp = ev.competitions?.[0];
    if (comp?.status?.type?.state !== "in") continue;   // nur laufend
    if (!GOLF_MAJOR_RX.test(ev.name || "")) continue;    // nur Majors
    const c0 = (comp.competitors ?? [])[0];
    const pos = c0?.status?.position?.displayName || "1";
    const name = c0?.athlete?.displayName || "";
    const par = c0?.score?.displayValue ?? c0?.score ?? "";
    out.push({
      id: "golf-live-" + ev.id, sport: "golf", kind: "match", liveOnly: true,
      title: ev.name, subtitle: "Major · Leaderboard",
      start: new Date(ev.date), end: new Date(Date.now() + 6 * 3600e3),
      score: name ? `${pos} ${name} ${par}`.trim() : "läuft",
    });
  }
  return out;
}

// ---- QUELLE 5: übrige Sportarten (gepflegte Liste) ----
//  Golf-Majors als feste Termine (Datumsfenster typisch; bei Bedarf anpassen).
const iso = (s) => new Date(s);
const CURATED = [
  // Tennis Grand Slams 2027 (feste Termine; laufende Turniere kommen live von ESPN)
  { id: "ten-ao-27", sport: "tennis", kind: "tournament", major: true, badgeLabel: "Grand Slam",
    title: "Australian Open", subtitle: "Grand Slam · Melbourne",
    start: iso("2027-01-17T11:00:00"), end: iso("2027-01-31T23:59:00") },
  { id: "ten-rg-27", sport: "tennis", kind: "tournament", major: true, badgeLabel: "Grand Slam",
    title: "French Open", subtitle: "Grand Slam · Roland Garros, Paris",
    start: iso("2027-05-23T11:00:00"), end: iso("2027-06-06T23:59:00") },
  { id: "ten-wim-27", sport: "tennis", kind: "tournament", major: true, badgeLabel: "Grand Slam",
    title: "Wimbledon", subtitle: "Grand Slam · London",
    start: iso("2027-06-28T12:00:00"), end: iso("2027-07-11T23:59:00") },
  { id: "ten-uso-27", sport: "tennis", kind: "tournament", major: true, badgeLabel: "Grand Slam",
    title: "US Open", subtitle: "Grand Slam · New York",
    start: iso("2027-08-29T17:00:00"), end: iso("2027-09-12T23:59:00") },
  { id: "golf-masters", sport: "golf", kind: "tournament", major: true, badgeLabel: "Major",
    title: "The Masters", subtitle: "Augusta National",
    start: iso("2027-04-08T15:00:00"), end: iso("2027-04-11T23:00:00") },
  { id: "golf-pga", sport: "golf", kind: "tournament", major: true, badgeLabel: "Major",
    title: "PGA Championship", subtitle: "Golf Major",
    start: iso("2027-05-13T15:00:00"), end: iso("2027-05-16T23:00:00") },
  { id: "golf-usopen", sport: "golf", kind: "tournament", major: true, badgeLabel: "Major",
    title: "U.S. Open", subtitle: "Golf Major",
    start: iso("2027-06-17T15:00:00"), end: iso("2027-06-20T23:00:00") },
  { id: "golf-open", sport: "golf", kind: "tournament", major: true, badgeLabel: "Major",
    title: "The Open Championship", subtitle: "Golf Major",
    start: iso("2027-07-15T12:00:00"), end: iso("2027-07-18T22:00:00") },
  // Triathlon – nur Langdistanz (Ironman/Challenge), im Stream/TV übertragen
  { id: "tri-703wm-26", sport: "triathlon", kind: "tournament", major: true, badgeLabel: "WM",
    title: "Ironman 70.3 WM", subtitle: "Langdistanz · Nizza (FR)",
    start: iso("2026-09-12T08:00:00"), end: iso("2026-09-13T18:00:00") },
  { id: "tri-kona-26", sport: "triathlon", kind: "tournament", major: true, badgeLabel: "WM",
    title: "Ironman WM Kona", subtitle: "Langdistanz · Hawaii",
    start: iso("2026-10-10T18:00:00"), end: iso("2026-10-11T06:00:00") },
  { id: "tri-roth-27", sport: "triathlon", kind: "tournament",
    title: "Challenge Roth", subtitle: "Langdistanz · Roth (GER)",
    start: iso("2027-07-04T06:30:00"), end: iso("2027-07-04T22:00:00") },
  { id: "tri-703wm-27", sport: "triathlon", kind: "tournament", major: true, badgeLabel: "WM",
    title: "Ironman 70.3 WM", subtitle: "Langdistanz · Chattanooga (USA)",
    start: iso("2027-08-28T08:00:00"), end: iso("2027-08-29T18:00:00") },
  { id: "tri-kona-27", sport: "triathlon", kind: "tournament", major: true, badgeLabel: "WM",
    title: "Ironman WM Kona", subtitle: "Langdistanz · Hawaii",
    start: iso("2027-10-09T18:00:00"), end: iso("2027-10-10T06:00:00") },
  { id: "tri-frankfurt-27", sport: "triathlon", kind: "tournament", major: true, badgeLabel: "EM",
    title: "Ironman Frankfurt", subtitle: "Langdistanz · European Championship (GER)",
    start: iso("2027-06-27T06:30:00"), end: iso("2027-06-27T22:00:00") },
  { id: "tri-nice-27", sport: "triathlon", kind: "tournament",
    title: "Ironman Nizza", subtitle: "Langdistanz · Nizza (FR)",
    start: iso("2027-09-12T07:00:00"), end: iso("2027-09-12T21:00:00") },
  // Biathlon Weltcup 2026/27 (offizieller IBU-Kalender)
  { id: "bia-kontiolahti", sport: "biathlon", kind: "tournament", title: "Kontiolahti", subtitle: "Biathlon Weltcup · Auftakt",
    start: iso("2026-11-24T10:00:00"), end: iso("2026-11-29T16:00:00") },
  { id: "bia-hochfilzen", sport: "biathlon", kind: "tournament", title: "Hochfilzen", subtitle: "Biathlon Weltcup",
    start: iso("2026-12-04T10:00:00"), end: iso("2026-12-06T16:00:00") },
  { id: "bia-annecy", sport: "biathlon", kind: "tournament", title: "Annecy-Le Grand-Bornand", subtitle: "Biathlon Weltcup",
    start: iso("2026-12-10T10:00:00"), end: iso("2026-12-13T16:00:00") },
  { id: "bia-pokljuka", sport: "biathlon", kind: "tournament", title: "Pokljuka", subtitle: "Biathlon Weltcup",
    start: iso("2027-01-02T10:00:00"), end: iso("2027-01-03T16:00:00") },
  { id: "bia-ruhpolding", sport: "biathlon", kind: "tournament", title: "Ruhpolding", subtitle: "Biathlon Weltcup",
    start: iso("2027-01-06T10:00:00"), end: iso("2027-01-10T16:00:00") },
  { id: "bia-antholz", sport: "biathlon", kind: "tournament", title: "Antholz-Anterselva", subtitle: "Biathlon Weltcup",
    start: iso("2027-01-14T10:00:00"), end: iso("2027-01-17T16:00:00") },
  { id: "bia-novemesto", sport: "biathlon", kind: "tournament", title: "Nove Mesto", subtitle: "Biathlon Weltcup",
    start: iso("2027-01-21T10:00:00"), end: iso("2027-01-24T16:00:00") },
  { id: "bia-wm", sport: "biathlon", kind: "tournament", major: true, badgeLabel: "WM", title: "WM Otepää", subtitle: "Biathlon-Weltmeisterschaft",
    start: iso("2027-02-10T10:00:00"), end: iso("2027-02-21T16:00:00") },
  { id: "bia-oberhof", sport: "biathlon", kind: "tournament", title: "Oberhof", subtitle: "Biathlon Weltcup",
    start: iso("2027-03-04T10:00:00"), end: iso("2027-03-07T16:00:00") },
  { id: "bia-oestersund", sport: "biathlon", kind: "tournament", title: "Östersund", subtitle: "Biathlon Weltcup",
    start: iso("2027-03-11T10:00:00"), end: iso("2027-03-14T16:00:00") },
  { id: "bia-oslo", sport: "biathlon", kind: "tournament", title: "Oslo Holmenkollen", subtitle: "Biathlon Weltcup · Finale",
    start: iso("2027-03-18T10:00:00"), end: iso("2027-03-21T16:00:00") },
  { id: "dar-wgp", sport: "darts", kind: "tournament", title: "World Grand Prix", subtitle: "PDC · Leicester",
    start: iso("2026-09-28T19:00:00"), end: iso("2026-10-04T23:00:00") },
  { id: "dar-grandslam", sport: "darts", kind: "tournament", major: true, badgeLabel: "Major", title: "Grand Slam of Darts", subtitle: "PDC · Wolverhampton",
    start: iso("2026-11-14T13:00:00"), end: iso("2026-11-22T23:00:00") },
  { id: "dar-pcf", sport: "darts", kind: "tournament", title: "Players Championship Finals", subtitle: "PDC · Minehead",
    start: iso("2026-11-27T12:00:00"), end: iso("2026-11-29T23:00:00") },
  { id: "dar-wm", sport: "darts", kind: "tournament", major: true, badgeLabel: "WM",
    title: "Darts-WM", subtitle: "PDC · Alexandra Palace, London",
    start: iso("2026-12-11T19:00:00"), end: iso("2027-01-03T23:59:00") },
];

async function loadAll() {
  const results = await Promise.allSettled([getF1(), getFootball(), getTennis(), getGolf()]);
  const live = results.flatMap((r) => (r.status === "fulfilled" ? r.value : []));
  // Läuft ein Grand Slam bereits live (ESPN), den gleichnamigen festen Eintrag desselben Jahres weglassen
  const liveTennis = new Set(
    live.filter((e) => e.sport === "tennis" && e.kind === "tournament")
        .map((e) => e.title + "|" + e.start.getFullYear())
  );
  const curated = CURATED.filter(
    (e) => !(e.sport === "tennis" && liveTennis.has(e.title + "|" + e.start.getFullYear()))
  );
  return [...live, ...curated].sort((a, b) => a.start - b.start);
}
// ---- Helfer ----
const day = (d) => d.toLocaleDateString("de-DE", { weekday: "long", day: "2-digit", month: "long" });
const time = (d) => d.toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" });
function isLive(e, now) {
  if (now < e.start) return false;
  if (e.finished === true) return false;
  return now <= e.end;
}

export default function App() {
  const [events, setEvents] = useState([]);
  const [status, setStatus] = useState("loading");
  const [tab, setTab] = useState("termine");
  const [selected, setSelected] = useState(null); // null = alle Sportarten
  const [now, setNow] = useState(new Date());
  const touch = useRef({ x: 0, y: 0 });

  useEffect(() => {
    loadAll().then((ev) => { setEvents(ev); setStatus("ok"); }).catch(() => setStatus("error"));
  }, []);
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);

  const present = Object.keys(SPORTS).filter((k) => events.some((e) => e.sport === k));
  // Filter: ist eine Sportart gewählt, nur diese zeigen; sonst alle
  const base = selected ? events.filter((e) => e.sport === selected) : events;
  const upcoming = base.filter((e) => e.end >= now && e.kind !== "match");
  const order = Object.keys(SPORTS);
  const live = base
    .filter((e) => isLive(e, now) && e.kind !== "tournament")
    .sort((a, b) => order.indexOf(a.sport) - order.indexOf(b.sport) || a.start - b.start);

  // Wischen: nach links -> Live, nach rechts -> Termine
  const onTouchStart = (e) => { const t = e.touches[0]; touch.current = { x: t.clientX, y: t.clientY }; };
  const onTouchEnd = (e) => {
    const t = e.changedTouches[0];
    const dx = t.clientX - touch.current.x;
    const dy = t.clientY - touch.current.y;
    if (Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy) * 1.5) {
      setTab(dx < 0 ? "live" : "termine");
    }
  };

  return (
    <div style={S.stage}>
      <style>{FONT + GLOBAL + KEYS}</style>
      <div style={S.phone}>
        <div style={S.head}>
          <span style={S.brand}>Startzeit</span>
          {live.length > 0 && (
            <span style={S.headLive}><i style={S.liveSq} />{live.length} live</span>
          )}
        </div>

        {status === "ok" && (
          <div style={S.chips}>
            <button onClick={() => setSelected(null)} style={S.chipAll(selected === null)}>Alle</button>
            {present.map((k) => {
              const on = selected === null || selected === k;
              return (
                <button
                  key={k}
                  onClick={() => setSelected((prev) => (prev === k ? null : k))}
                  style={S.chip(on)}
                >
                  <span style={S.chipSq(on, SPORTS[k].color)} />{SPORTS[k].label}
                </button>
              );
            })}
          </div>
        )}

        <div style={S.scroll} onTouchStart={onTouchStart} onTouchEnd={onTouchEnd}>
          {status === "loading" && <p style={S.note}>Termine werden geladen …</p>}
          {status === "error" && <p style={S.note}>Konnte die Termine nicht laden. Verbindung prüfen und neu laden.</p>}
          {status === "ok" && tab === "termine" && (
            <Termine events={upcoming} now={now} onOpenLive={() => setTab("live")} />
          )}
          {status === "ok" && tab === "live" && (
            <Live events={live} next={upcoming.find((e) => !isLive(e, now))} />
          )}
        </div>

        <nav style={S.tabs}>
          <button onClick={() => setTab("termine")} style={S.tab(tab === "termine")}>Termine</button>
          <button onClick={() => setTab("live")} style={S.tab(tab === "live")}>Live</button>
        </nav>
      </div>
    </div>
  );
}

function Termine({ events, now, onOpenLive }) {
  if (!events.length) return <p style={S.note}>Keine anstehenden Veranstaltungen.</p>;
  let lastDay = "";
  return (
    <div>
      {events.map((e) => {
        const s = SPORTS[e.sport];
        const d = day(e.start);
        const showDay = d !== lastDay; lastDay = d;
        const live = isLive(e, now);
        return (
          <div key={e.id}>
            {showDay && <div style={S.dayLabel}>{d}</div>}
            <div
              style={{ ...S.row, ...(live ? { cursor: "pointer" } : null) }}
              onClick={live ? onOpenLive : undefined}
            >
              <span style={{ ...S.rule, background: s.color }} />
              <span style={S.main}>
                <span style={S.eyebrow(s.color)}>{s.label}</span>
                <span style={S.title}>
                  {e.title}
                  {e.major && <span style={S.badge}>{e.badgeLabel}</span>}
                </span>
                <span style={S.sub}>{e.subtitle}</span>
              </span>
              {live
                ? <span style={S.live}><i style={S.liveSq} />{e.score || "LIVE"}</span>
                : e.score
                  ? <span style={{ ...S.right, color: C.muted }}>{e.score}</span>
                  : <span style={S.right}>{time(e.start)}</span>}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function Live({ events, next }) {
  if (!events.length) {
    return (
      <div style={S.empty}>
        <p style={S.emptyBig}>Gerade läuft nichts.</p>
        {next && (
          <p style={S.emptySub}>
            Als Nächstes: {next.title} — {day(next.start)}, {time(next.start)} Uhr
          </p>
        )}
      </div>
    );
  }
  return (
    <div>
      {events.map((e) => {
        const s = SPORTS[e.sport];
        return (
          <div key={e.id} style={{ ...S.liveCard, borderLeftColor: s.color }}>
            <div style={S.liveTop}>
              <span style={S.eyebrow(s.color)}>{s.label}</span>
              <span style={S.live}><i style={S.liveSq} />LIVE</span>
            </div>
            <div style={S.title}>{e.title}</div>
            <div style={S.sub}>{e.subtitle}</div>
            {e.score
              ? <p style={S.liveScore}>{e.score}</p>
              : <p style={S.livePlaceholder}>Läuft – noch kein Ergebnis</p>}
          </div>
        );
      })}
    </div>
  );
}

// ============================================================
//  STYLES  –  "Schweizer Raster": weiß, klare Linien, Farbe nur als Signal
// ============================================================
const FONT = `@import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap');`;
const KEYS = `@keyframes pulse{0%,100%{opacity:1}50%{opacity:.25}}`;
const GLOBAL = `*{box-sizing:border-box}html,body,#root{margin:0;padding:0;height:100%;background:#FFFFFF;}`;

const C = {
  bg: "#FFFFFF", ink: "#111111", muted: "#9A9A9A", faint: "#C9C9C9",
  line: "#ECECEC", rule: "#111111", live: "#C23B22",
  body: "'Inter', system-ui, -apple-system, sans-serif",
};

const S = {
  stage: { background: "#FFFFFF", minHeight: "100dvh", display: "flex", justifyContent: "center", fontFamily: C.body },
  phone: {
    width: "100%", maxWidth: 480, minHeight: "100dvh", background: C.bg,
    display: "flex", flexDirection: "column", overflow: "hidden", color: C.ink,
  },
  head: { display: "flex", alignItems: "baseline", justifyContent: "space-between", padding: "calc(20px + env(safe-area-inset-top)) 16px 12px" },
  brand: { fontSize: 19, fontWeight: 700, letterSpacing: "-.01em" },
  headLive: { display: "inline-flex", alignItems: "center", gap: 6, color: C.live, fontSize: 11, fontWeight: 700, letterSpacing: ".04em" },

  chips: { display: "flex", gap: 16, overflowX: "auto", padding: "0 16px 14px", flexShrink: 0 },
  chipAll: (on) => ({
    background: "none", border: "none", padding: 0, cursor: "pointer", whiteSpace: "nowrap",
    fontFamily: C.body, fontSize: 11, fontWeight: 700, letterSpacing: ".04em", textTransform: "uppercase",
    color: on ? C.ink : C.faint,
  }),
  chip: (on) => ({
    display: "inline-flex", alignItems: "center", gap: 6, whiteSpace: "nowrap",
    background: "none", border: "none", padding: 0, cursor: "pointer",
    fontFamily: C.body, fontSize: 11, fontWeight: 600, letterSpacing: ".04em", textTransform: "uppercase",
    color: on ? C.ink : C.faint,
  }),
  chipSq: (on, color) => ({ width: 9, height: 9, background: on ? color : C.faint, flexShrink: 0 }),

  scroll: { flex: 1, overflowY: "auto" },
  note: { color: C.muted, fontSize: 14, padding: "24px 16px", lineHeight: 1.5 },
  dayLabel: { fontSize: 11, fontWeight: 700, letterSpacing: ".08em", textTransform: "uppercase", color: C.ink,
              padding: "16px 16px 8px", borderTop: `2px solid ${C.rule}`, marginTop: 2 },

  row: { display: "grid", gridTemplateColumns: "4px 1fr auto", alignItems: "center", gap: 12,
         padding: "12px 16px", borderBottom: `1px solid ${C.line}` },
  rule: { alignSelf: "stretch", minHeight: 34 },
  main: { display: "flex", flexDirection: "column", alignItems: "flex-start", minWidth: 0, width: "100%", textAlign: "left" },
  eyebrow: (color) => ({ fontSize: 10, fontWeight: 700, letterSpacing: ".09em", textTransform: "uppercase", color, textAlign: "left" }),
  title: { fontSize: 15, fontWeight: 600, color: C.ink, marginTop: 3, width: "100%", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", display: "flex", alignItems: "center", justifyContent: "flex-start", textAlign: "left" },
  sub: { fontSize: 11.5, color: C.muted, marginTop: 2, width: "100%", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", textAlign: "left" },
  badge: { fontSize: 9, fontWeight: 700, letterSpacing: ".04em", textTransform: "uppercase", color: "#fff", background: C.ink, padding: "2px 5px", marginLeft: 8, flexShrink: 0 },
  right: { fontSize: 14, fontWeight: 500, color: "#555", fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap", textAlign: "right" },
  live: { display: "inline-flex", alignItems: "center", gap: 6, color: C.live, fontSize: 12, fontWeight: 700, letterSpacing: ".04em", fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap" },
  liveSq: { width: 7, height: 7, background: C.live, display: "inline-block", animation: "pulse 1.4s infinite" },

  empty: { textAlign: "center", padding: "60px 24px" },
  emptyBig: { fontSize: 18, fontWeight: 700, margin: "0 0 8px", color: C.ink },
  emptySub: { color: C.muted, fontSize: 13.5, lineHeight: 1.5 },

  liveCard: { border: `1px solid ${C.line}`, borderLeft: "4px solid #000", padding: "13px 14px", margin: "12px 16px 0" },
  liveTop: { display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 },
  liveScore: { fontSize: 26, fontWeight: 700, margin: "10px 0 0", fontVariantNumeric: "tabular-nums", color: C.ink },
  livePlaceholder: { color: C.muted, fontSize: 13, margin: "10px 0 0" },

  tabs: { display: "flex", borderTop: `2px solid ${C.rule}`, background: "#FFFFFF", paddingBottom: "env(safe-area-inset-bottom)" },
  tab: (on) => ({
    flex: 1, background: "none", border: "none", cursor: "pointer",
    color: on ? C.ink : C.faint, fontFamily: C.body, fontSize: 14, fontWeight: 700,
    letterSpacing: ".05em", textTransform: "uppercase", padding: "18px 0",
  }),
};