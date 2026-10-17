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
  f1:        { label: "Formel 1",  color: "#D89A2C" },
  fussball:  { label: "Fußball",   color: "#1E9E68" },
  tennis:    { label: "Tennis",    color: "#7AA92E" },
  golf:      { label: "Golf",      color: "#159A93" },
  handball:  { label: "Handball",  color: "#5C6BC0" },
  nfl:       { label: "Football",  color: "#7A5230" },
  radsport:  { label: "Radsport",  color: "#D4458A" },
  leichtathletik: { label: "Leichtathletik", color: "#8A5CC7" },
  darts:     { label: "Darts",     color: "#DC4A38" },
  biathlon:  { label: "Biathlon",  color: "#3B78D6" },
  triathlon: { label: "Triathlon", color: "#1FA3B8" },
  finals:    { label: "Die Finals", color: "#3E5C76" },
  olympia:   { label: "Olympia",   color: "#1F3A5F" },
};

// ---- Netzwerk: zählt Anfragen/Fehler, damit die App "offline" erkennt ----
const net = { calls: 0, errors: 0 };
async function fx(url) {
  net.calls++;
  try {
    const r = await fetch(url, { cache: "no-store" });
    if (!r.ok) throw new Error("HTTP " + r.status);
    return r;
  } catch (err) {
    net.errors++;
    throw err;
  }
}

// ---- QUELLE 1: Formel 1 (laufendes + nächstes Jahr, damit der Kalender über den Jahreswechsel reicht) ----
async function getF1() {
  const y = new Date().getFullYear();
  const res = await Promise.allSettled([y, y + 1].map((yr) =>
    fx(`https://api.jolpi.ca/ergast/f1/${yr}/races/?format=json`).then((r) => r.json())));
  const races = res.flatMap((r) => (r.status === "fulfilled" ? r.value?.MRData?.RaceTable?.Races ?? [] : []));
  return races.map((r) => {
    const start = new Date(`${r.date}T${r.time || "13:00:00Z"}`);
    return {
      id: `f1-${r.season}-${r.round}`, sport: "f1",
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
  let leagues = [];
  try {
    const leaguesRes = await fx("https://api.openligadb.de/getavailableleagues");
    leagues = await leaguesRes.json();
  } catch { /* Bundesliga funktioniert auch ohne Ligaliste */ }
  // Bundesliga-Saison beginnt im Juli/August -> Saisonjahr = Startjahr
  const blSeason = now.getMonth() >= 6 ? now.getFullYear() : now.getFullYear() - 1;
  const targets = [
    { fixed: { leagueShortcut: "bl1", leagueSeason: blSeason }, label: "Bundesliga" },
    { rx: /champions.?league/i, label: "Champions League" },
    { rx: /dfb.?pokal/i,        label: "DFB-Pokal" },
  ];
  const out = [];
  for (const t of targets) {
    const lg = t.fixed || pickLeague(leagues, t.rx);
    if (!lg) continue;
    try {
      const r = await fx(`https://api.openligadb.de/getmatchdata/${lg.leagueShortcut}/${lg.leagueSeason}`);
      const matches = await r.json();
      const events = matches.map((m) => {
        const start = new Date(m.matchDateTimeUTC || m.matchDateTime);
        const t1 = m.team1.shortName || m.team1.teamName;
        const t2 = m.team2.shortName || m.team2.teamName;
        const sc = scoreOf(m);
        const [g1, g2] = sc ? sc.split(":") : ["", ""];
        return {
          id: "fb-" + m.matchID, sport: "fussball",
          title: `${t1} – ${t2}`, comp: t.label,
          subtitle: `${t.label}${m.group?.groupName ? " · " + m.group.groupName : ""}`,
          rows: [{ name: t1, score: g1 }, { name: t2, score: g2 }],
          note: m.group?.groupName || "",
          start, end: new Date(start.getTime() + 2.5 * 3600e3),
          finished: m.matchIsFinished, score: sc,
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

// ---- QUELLE 3: Tennis – nur Grand Slams + Masters 1000 (ESPN) ----
//  Reihenfolge wichtig: Roland Garros vor Paris prüfen.
const TENNIS_TOURNEYS = [
  { key: "ao",  rx: /australian open/i,                          title: "Australian Open",  city: "Melbourne",      badge: "Grand Slam" },
  { key: "rg",  rx: /roland|french open/i,                       title: "French Open",      city: "Roland Garros, Paris", badge: "Grand Slam" },
  { key: "wim", rx: /wimbledon/i,                                title: "Wimbledon",        city: "London",         badge: "Grand Slam" },
  { key: "uso", rx: /us open/i,                                  title: "US Open",          city: "New York",       badge: "Grand Slam" },
  { key: "iw",  rx: /bnp paribas|indian wells/i,                 title: "Indian Wells",     city: "Kalifornien",    badge: "Masters 1000" },
  { key: "mia", rx: /miami/i,                                    title: "Miami Open",       city: "Miami",          badge: "Masters 1000" },
  { key: "mc",  rx: /monte.?carlo/i,                             title: "Monte-Carlo",      city: "Monaco",         badge: "Masters 1000" },
  { key: "mad", rx: /madrid/i,                                   title: "Madrid Open",      city: "Madrid",         badge: "Masters 1000" },
  { key: "rom", rx: /internazionali|italian open|\brome\b|\broma\b/i, title: "Rom",          city: "Foro Italico",   badge: "Masters 1000" },
  { key: "can", rx: /national bank|canadian|toronto|montr[eé]al/i, title: "Canadian Open",  city: "Toronto / Montréal", badge: "Masters 1000" },
  { key: "cin", rx: /cincinnati|western & southern/i,            title: "Cincinnati Open",  city: "Cincinnati",     badge: "Masters 1000" },
  { key: "sha", rx: /shanghai/i,                                 title: "Shanghai Masters", city: "Shanghai",       badge: "Masters 1000" },
  { key: "par", rx: /paris/i,                                    title: "Paris Masters",    city: "Paris",          badge: "Masters 1000" },
];
const tennisTourney = (name) => TENNIS_TOURNEYS.find((t) => t.rx.test(name || ""));

async function getTennis() {
  const tours = ["atp", "wta"];
  const tournaments = new Map();
  const liveMatches = [];
  for (const tour of tours) {
    let data;
    try {
      const r = await fx(`https://site.api.espn.com/apis/site/v2/sports/tennis/${tour}/scoreboard`);
      data = await r.json();
    } catch { continue; }
    for (const ev of data?.events ?? []) {
      const tt = tennisTourney(ev.name);
      if (!tt) continue; // alles außer Grand Slams und Masters 1000 ignorieren
      const start = new Date(ev.date);
      const end = new Date(ev.endDate || ev.date);
      if (!tournaments.has(tt.key)) {
        tournaments.set(tt.key, {
          id: "ten-" + ev.id, sport: "tennis", kind: "tournament", tkey: tt.key,
          title: tt.title, subtitle: `${tt.badge} · ${tt.city}`,
          start, end, major: true, badgeLabel: tt.badge,
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
          const setStr = (p) => (p.linescores || []).map((ls) => Math.trunc(ls.value ?? 0)).join("  ");
          const sets = (cs[0].linescores || []).map((ls, i) => {
            const a = Math.trunc(ls.value ?? 0);
            const b = Math.trunc(cs[1].linescores?.[i]?.value ?? 0);
            return `${a}-${b}`;
          }).join("  ");
          const round = c.round?.displayName;
          const label = `${tt.title}${round ? " · " + round : ""}`;
          liveMatches.push({
            id: "tenm-" + c.id, sport: "tennis", kind: "match", liveOnly: true, tkey: tt.key,
            title: `${n1} – ${n2}`, comp: label, subtitle: label,
            rows: [{ name: n1, score: setStr(cs[0]) }, { name: n2, score: setStr(cs[1]) }],
            note: round || tt.title,
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
    const r = await fx("https://site.api.espn.com/apis/site/v2/sports/golf/pga/scoreboard");
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

// Tennis: Grand Slams + Masters 1000 (ATP-Kalender; laufende Turniere kommen zusätzlich live von ESPN)
const TENNIS_DATES = [
  ["par", "2026-10-31", "2026-11-08"],
  ["ao",  "2027-01-17", "2027-01-31"],
  ["iw",  "2027-03-03", "2027-03-14"],
  ["mia", "2027-03-17", "2027-03-28"],
  ["mc",  "2027-04-04", "2027-04-11"],
  ["mad", "2027-04-21", "2027-05-02"],
  ["rom", "2027-05-05", "2027-05-16"],
  ["rg",  "2027-05-23", "2027-06-06"],
  ["wim", "2027-06-28", "2027-07-11"],
  ["can", "2027-08-01", "2027-08-12"],
  ["cin", "2027-08-12", "2027-08-23"],
  ["uso", "2027-08-29", "2027-09-12"],
  ["sha", "2027-10-06", "2027-10-17"],
  ["par", "2027-10-30", "2027-11-07"],
];
const TENNIS_CURATED = TENNIS_DATES.map(([key, s, e]) => {
  const t = TENNIS_TOURNEYS.find((x) => x.key === key);
  return {
    id: `ten-${key}-${s.slice(0, 4)}`, sport: "tennis", kind: "tournament", tkey: key,
    major: true, badgeLabel: t.badge, title: t.title, subtitle: `${t.badge} · ${t.city}`,
    start: iso(`${s}T11:00:00`), end: iso(`${e}T23:59:00`),
  };
});

// Vorläufige Termine markieren (Datum geschätzt, noch nicht offiziell)
const tbc = (e) => ({ ...e, tbc: true });

// Kurzform für gepflegte Termine: [id, sport, titel, untertitel, start, ende, badge?]
const ev = (id, sport, title, subtitle, start, end, badge) => ({
  id, sport, kind: "tournament", title, subtitle,
  start: iso(start), end: iso(end),
  ...(badge ? { major: true, badgeLabel: badge } : {}),
});

const MORE = [
  // ---- Fußball: DFB-Team + Turniere ----
  { ...ev("dfb-srb-26", "fussball", "Serbien – Deutschland", "Nations League · Belgrad", "2026-11-13T20:45:00", "2026-11-13T22:45:00", "DFB"), tv: "RTL" },
  { ...ev("dfb-ned-26", "fussball", "Deutschland – Niederlande", "Nations League · Berlin", "2026-11-16T20:45:00", "2026-11-16T22:45:00", "DFB"), tv: "ARD" },
  ev("unl-finals-27", "fussball", "Nations League Finals", "UEFA · Final Four", "2027-06-09T20:45:00", "2027-06-13T23:00:00"),
  ev("wwc-27", "fussball", "Frauen-WM 2027", "FIFA · Brasilien", "2027-06-24T22:00:00", "2027-07-25T23:59:00", "WM"),
  ev("euro-28", "fussball", "EM 2028", "UEFA · England, Schottland, Wales, Irland", "2028-06-09T21:00:00", "2028-07-09T23:59:00", "EM"),
  // EM-Qualifikation 2027: Auslosung am 06.12.2026 – Länderspielfenster vorläufig, Gegner offen
  tbc(ev("dfb-q-27-03", "fussball", "DFB · EM-Qualifikation", "Länderspielfenster März · Gegner nach Auslosung", "2027-03-25T20:45:00", "2027-03-30T22:45:00", "DFB")),
  tbc(ev("dfb-q-27-06", "fussball", "DFB · Länderspiele", "Länderspielfenster Juni", "2027-06-04T20:45:00", "2027-06-08T22:45:00", "DFB")),
  tbc(ev("dfb-q-27-09", "fussball", "DFB · EM-Qualifikation", "Länderspielfenster September", "2027-09-02T20:45:00", "2027-09-07T22:45:00", "DFB")),
  tbc(ev("dfb-q-27-10", "fussball", "DFB · EM-Qualifikation", "Länderspielfenster Oktober", "2027-10-07T20:45:00", "2027-10-12T22:45:00", "DFB")),
  tbc(ev("dfb-q-27-11", "fussball", "DFB · EM-Qualifikation", "Länderspielfenster November", "2027-11-11T20:45:00", "2027-11-16T22:45:00", "DFB")),
  tbc(ev("wc-30", "fussball", "WM 2030", "FIFA · Spanien, Portugal, Marokko", "2030-06-08T21:00:00", "2030-07-21T23:59:00", "WM")),

  // ---- Handball ----
  ev("hb-wm-27", "handball", "Männer-WM", "IHF · Deutschland", "2027-01-13T18:00:00", "2027-01-31T20:00:00", "WM"),
  ev("hb-wm-27-tun", "handball", "Deutschland – Tunesien", "WM · Vorrunde · SAP Garden München", "2027-01-13T20:30:00", "2027-01-13T22:15:00", "DHB"),
  ev("hb-wm-27-uru", "handball", "Deutschland – Uruguay", "WM · Vorrunde · SAP Garden München", "2027-01-15T20:30:00", "2027-01-15T22:15:00", "DHB"),
  ev("hb-wm-27-srb", "handball", "Deutschland – Serbien", "WM · Vorrunde · SAP Garden München", "2027-01-17T20:30:00", "2027-01-17T22:15:00", "DHB"),
  ev("hb-wm-27-final", "handball", "WM-Finale", "LANXESS arena, Köln", "2027-01-31T18:00:00", "2027-01-31T20:00:00", "Finale"),
  ev("hb-em-28", "handball", "Männer-EM", "EHF · Spanien, Portugal, Schweiz", "2028-01-13T18:00:00", "2028-01-30T20:00:00", "EM"),

  // ---- Triathlon Deutschland 2027: Lang- und Mitteldistanz ----
  ev("tri-kraichgau-27", "triathlon", "Ironman 70.3 Kraichgau", "Mitteldistanz · Kraichgau (GER)", "2027-05-23T08:00:00", "2027-05-23T16:00:00"),
  ev("tri-neuseenman-27", "triathlon", "NeuseenMan", "Mitteldistanz · Leipziger Neuseenland (GER)", "2027-05-30T08:00:00", "2027-05-30T16:00:00"),
  ev("tri-hamburg-27", "triathlon", "Ironman Hamburg", "Langdistanz · Hamburg (GER)", "2027-06-06T06:30:00", "2027-06-06T22:00:00"),
  ev("tri-ostseeman-27", "triathlon", "OstseeMan", "Lang- & Mitteldistanz · Glücksburg (GER)", "2027-08-01T07:00:00", "2027-08-01T22:00:00"),
  ev("tri-fcity-27", "triathlon", "Frankfurt City Triathlon", "Mitteldistanz · Frankfurt (GER)", "2027-08-01T08:00:00", "2027-08-01T16:00:00"),
  ev("tri-leipzig-27", "triathlon", "Ironman 70.3 Leipzig", "Mitteldistanz · Leipzig (GER)", "2027-08-08T08:00:00", "2027-08-08T16:00:00", "Pro Series"),
  ev("tri-allgaeu-27", "triathlon", "Allgäu Triathlon", "Mitteldistanz · Immenstadt (GER)", "2027-08-22T08:00:00", "2027-08-22T16:00:00"),
  ev("tri-duisburg-27", "triathlon", "Ironman 70.3 Duisburg", "Mitteldistanz · Duisburg (GER)", "2027-08-29T08:00:00", "2027-08-29T16:00:00"),
  ev("tri-erkner-27", "triathlon", "Ironman 70.3 Erkner", "Mitteldistanz · Erkner bei Berlin (GER)", "2027-09-12T08:00:00", "2027-09-12T16:00:00"),

  // ---- American Football ----
  ev("nfl-sb-61", "nfl", "Super Bowl LXI", "NFL · SoFi Stadium, Los Angeles", "2027-02-15T00:30:00", "2027-02-15T04:30:00", "Finale"),

  // ---- Radsport: Monumente + Tour de France 2027 ----
  ev("rad-msr-27", "radsport", "Mailand–Sanremo", "Monument · Italien", "2027-03-20T10:00:00", "2027-03-20T17:30:00", "Monument"),
  ev("rad-rvv-27", "radsport", "Flandern-Rundfahrt", "Monument · Belgien", "2027-04-04T10:00:00", "2027-04-04T17:30:00", "Monument"),
  ev("rad-pr-27", "radsport", "Paris–Roubaix", "Monument · Frankreich", "2027-04-11T11:00:00", "2027-04-11T17:30:00", "Monument"),
  ev("rad-lbl-27", "radsport", "Lüttich–Bastogne–Lüttich", "Monument · Belgien", "2027-04-25T10:00:00", "2027-04-25T17:00:00", "Monument"),
  ev("rad-tdf-27", "radsport", "Tour de France", "Grand Départ Edinburgh · Ziel Paris", "2027-07-02T13:00:00", "2027-07-25T21:00:00", "Grand Tour"),
  ev("rad-lom-27", "radsport", "Il Lombardia", "Monument · Italien", "2027-10-09T10:00:00", "2027-10-09T17:00:00", "Monument"),

  // ---- Leichtathletik: Marathon-Majors, Diamond League, WM ----
  ev("la-nyc-26", "leichtathletik", "New York City Marathon", "Marathon Major", "2026-11-01T14:40:00", "2026-11-01T19:00:00", "Major"),
  ev("la-tokyo-27", "leichtathletik", "Tokyo Marathon", "Marathon Major", "2027-03-07T01:10:00", "2027-03-07T05:00:00", "Major"),
  ev("la-boston-27", "leichtathletik", "Boston Marathon", "Marathon Major", "2027-04-19T15:30:00", "2027-04-19T19:00:00", "Major"),
  ev("la-london-27", "leichtathletik", "London Marathon", "Marathon Major", "2027-04-25T10:00:00", "2027-04-25T13:00:00", "Major"),
  ev("la-dl-doha-27", "leichtathletik", "Diamond League Doha", "Diamond League", "2027-05-07T18:00:00", "2027-05-07T21:00:00"),
  ev("la-dl-shanghai-27", "leichtathletik", "Diamond League Shanghai", "Diamond League · Keqiao", "2027-05-15T13:00:00", "2027-05-15T16:00:00"),
  ev("la-dl-xiamen-27", "leichtathletik", "Diamond League Xiamen", "Diamond League", "2027-05-22T13:00:00", "2027-05-22T16:00:00"),
  ev("la-dl-rome-27", "leichtathletik", "Diamond League Rom", "Diamond League · Golden Gala", "2027-05-27T20:00:00", "2027-05-27T22:15:00"),
  ev("la-dl-rabat-27", "leichtathletik", "Diamond League Rabat", "Diamond League", "2027-05-30T20:00:00", "2027-05-30T22:15:00"),
  ev("la-dl-oslo-27", "leichtathletik", "Diamond League Oslo", "Diamond League · Bislett Games", "2027-06-03T20:00:00", "2027-06-03T22:15:00"),
  ev("la-dl-stockholm-27", "leichtathletik", "Diamond League Stockholm", "Diamond League · Bauhaus-Galan", "2027-06-06T19:00:00", "2027-06-06T21:15:00"),
  ev("la-dl-paris-27", "leichtathletik", "Diamond League Paris", "Diamond League", "2027-06-25T20:00:00", "2027-06-25T22:15:00"),
  ev("la-dl-eugene-27", "leichtathletik", "Diamond League Eugene", "Diamond League · Prefontaine Classic", "2027-07-03T22:00:00", "2027-07-04T00:30:00"),
  ev("la-dl-monaco-27", "leichtathletik", "Diamond League Monaco", "Diamond League · Herculis", "2027-07-09T20:00:00", "2027-07-09T22:15:00"),
  ev("la-dl-lausanne-27", "leichtathletik", "Diamond League Lausanne", "Diamond League · Athletissima", "2027-07-13T20:00:00", "2027-07-13T22:15:00"),
  ev("la-dl-london-27", "leichtathletik", "Diamond League London", "Diamond League", "2027-07-17T16:00:00", "2027-07-17T18:15:00"),
  ev("la-dl-silesia-27", "leichtathletik", "Diamond League Schlesien", "Diamond League · Chorzów", "2027-08-15T18:00:00", "2027-08-15T20:15:00"),
  ev("la-dl-brussels-27", "leichtathletik", "Diamond League Brüssel", "Diamond League · Memorial Van Damme", "2027-08-20T20:00:00", "2027-08-20T22:15:00"),
  ev("la-dl-final-27", "leichtathletik", "Diamond League Finale", "Diamond League · Zürich", "2027-08-25T20:00:00", "2027-08-26T22:15:00", "Finale"),
  ev("la-sydney-27", "leichtathletik", "Sydney Marathon", "Marathon Major", "2027-08-28T22:15:00", "2027-08-29T02:00:00", "Major"),
  ev("la-wm-27", "leichtathletik", "Leichtathletik-WM", "World Athletics · Peking", "2027-09-11T03:00:00", "2027-09-19T16:00:00", "WM"),
  ev("la-berlin-27", "leichtathletik", "Berlin-Marathon", "Marathon Major", "2027-09-26T09:15:00", "2027-09-26T12:30:00", "Major"),
  ev("la-chicago-27", "leichtathletik", "Chicago Marathon", "Marathon Major", "2027-10-10T14:30:00", "2027-10-10T17:30:00", "Major"),
  ev("la-nyc-27", "leichtathletik", "New York City Marathon", "Marathon Major", "2027-11-07T14:40:00", "2027-11-07T19:00:00", "Major"),

  // ---- Die Finals (ARD/ZDF) ----
  ev("finals-27", "finals", "Die Finals 2027", "Deutsche Meisterschaften · Stuttgart · ARD/ZDF", "2027-07-29T10:00:00", "2027-08-01T22:00:00"),

  // ---- Olympia ----
  ev("oly-la-28", "olympia", "Olympische Spiele", "Los Angeles 2028", "2028-07-14T03:00:00", "2028-07-30T23:59:00", "Sommer"),
  ev("oly-alps-30", "olympia", "Olympische Winterspiele", "Französische Alpen 2030", "2030-02-01T20:00:00", "2030-02-17T22:00:00", "Winter"),
];

const CURATED = [
  ...TENNIS_CURATED,
  ...MORE,
  { id: "golf-masters", sport: "golf", kind: "tournament", major: true, badgeLabel: "Major",
    title: "The Masters", subtitle: "Augusta National, Georgia",
    start: iso("2027-04-08T15:00:00"), end: iso("2027-04-11T23:00:00") },
  { id: "golf-pga", sport: "golf", kind: "tournament", major: true, badgeLabel: "Major",
    title: "PGA Championship", subtitle: "PGA Frisco, Texas",
    start: iso("2027-05-20T15:00:00"), end: iso("2027-05-23T23:00:00") },
  { id: "golf-usopen", sport: "golf", kind: "tournament", major: true, badgeLabel: "Major",
    title: "U.S. Open", subtitle: "Pebble Beach, Kalifornien",
    start: iso("2027-06-17T15:00:00"), end: iso("2027-06-20T23:00:00") },
  { id: "golf-open", sport: "golf", kind: "tournament", major: true, badgeLabel: "Major",
    title: "The Open Championship", subtitle: "Old Course, St Andrews",
    start: iso("2027-07-15T12:00:00"), end: iso("2027-07-18T22:00:00") },
  { id: "golf-ryder-27", sport: "golf", kind: "tournament", major: true, badgeLabel: "Ryder Cup",
    title: "Ryder Cup", subtitle: "Europa vs. USA · Adare Manor, Irland",
    start: iso("2027-09-17T09:00:00"), end: iso("2027-09-19T20:00:00") },
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
  { id: "tri-703wm-27", sport: "triathlon", kind: "tournament", tbc: true, major: true, badgeLabel: "WM",
    title: "Ironman 70.3 WM", subtitle: "Langdistanz · Chattanooga (USA)",
    start: iso("2027-08-28T08:00:00"), end: iso("2027-08-29T18:00:00") },
  { id: "tri-kona-27", sport: "triathlon", kind: "tournament", tbc: true, major: true, badgeLabel: "WM",
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
  // Biathlon Weltcup 2027/28 (IBU-Kalender bis 2030; Wettkampftage innerhalb der IBU-Wochen)
  { id: "bia-oestersund-27", sport: "biathlon", kind: "tournament", tbc: true, title: "Östersund", subtitle: "Biathlon Weltcup · Auftakt 2027/28",
    start: iso("2027-11-28T10:00:00"), end: iso("2027-12-05T16:00:00") },
  { id: "bia-kontiolahti-27", sport: "biathlon", kind: "tournament", tbc: true, title: "Kontiolahti", subtitle: "Biathlon Weltcup",
    start: iso("2027-12-09T10:00:00"), end: iso("2027-12-12T16:00:00") },
  { id: "bia-otepaa-27", sport: "biathlon", kind: "tournament", tbc: true, title: "Otepää", subtitle: "Biathlon Weltcup",
    start: iso("2027-12-16T10:00:00"), end: iso("2027-12-19T16:00:00") },
  // Darts – PDC-Kalender 2027
  { id: "dar-masters-27", sport: "darts", kind: "tournament", title: "World Masters", subtitle: "PDC · Milton Keynes",
    start: iso("2027-01-27T19:00:00"), end: iso("2027-01-31T23:00:00") },
  { id: "dar-pl-start-27", sport: "darts", kind: "tournament", title: "Premier League · Auftakt", subtitle: "PDC · Night 1",
    start: iso("2027-02-04T20:00:00"), end: iso("2027-02-04T23:30:00") },
  { id: "dar-ukopen-27", sport: "darts", kind: "tournament", major: true, badgeLabel: "Major", title: "UK Open", subtitle: "PDC · Minehead",
    start: iso("2027-03-05T12:00:00"), end: iso("2027-03-07T23:00:00") },
  { id: "dar-pl-final-27", sport: "darts", kind: "tournament", major: true, badgeLabel: "Finale", title: "Premier League Finals", subtitle: "PDC · London",
    start: iso("2027-05-27T20:00:00"), end: iso("2027-05-27T23:30:00") },
  { id: "dar-wcup-27", sport: "darts", kind: "tournament", title: "World Cup of Darts", subtitle: "PDC · Frankfurt",
    start: iso("2027-06-10T19:00:00"), end: iso("2027-06-13T23:00:00") },
  { id: "dar-euopen-27", sport: "darts", kind: "tournament", title: "European Open", subtitle: "PDC · Salzburg",
    start: iso("2027-06-18T19:00:00"), end: iso("2027-06-20T23:00:00") },
  { id: "dar-matchplay-27", sport: "darts", kind: "tournament", major: true, badgeLabel: "Major", title: "World Matchplay", subtitle: "PDC · Blackpool",
    start: iso("2027-07-17T19:00:00"), end: iso("2027-07-25T23:00:00") },
  { id: "dar-wsf-27", sport: "darts", kind: "tournament", title: "World Series Finals", subtitle: "PDC · Amsterdam",
    start: iso("2027-09-16T19:00:00"), end: iso("2027-09-19T23:00:00") },
  { id: "dar-wgp-27", sport: "darts", kind: "tournament", title: "World Grand Prix", subtitle: "PDC · Leicester",
    start: iso("2027-09-27T19:00:00"), end: iso("2027-10-03T23:00:00") },
  { id: "dar-em-27", sport: "darts", kind: "tournament", title: "European Championship", subtitle: "PDC · Dortmund",
    start: iso("2027-10-26T19:00:00"), end: iso("2027-10-31T23:00:00") },
  { id: "dar-grandslam-27", sport: "darts", kind: "tournament", major: true, badgeLabel: "Major", title: "Grand Slam of Darts", subtitle: "PDC · Wolverhampton",
    start: iso("2027-11-06T13:00:00"), end: iso("2027-11-14T23:00:00") },
  { id: "dar-pcf-27", sport: "darts", kind: "tournament", title: "Players Championship Finals", subtitle: "PDC · Minehead",
    start: iso("2027-11-26T12:00:00"), end: iso("2027-11-28T23:00:00") },
  { id: "dar-wgp", sport: "darts", kind: "tournament", title: "World Grand Prix", subtitle: "PDC · Leicester",
    start: iso("2026-09-28T19:00:00"), end: iso("2026-10-04T23:00:00") },
  { id: "dar-grandslam", sport: "darts", kind: "tournament", major: true, badgeLabel: "Major", title: "Grand Slam of Darts", subtitle: "PDC · Wolverhampton",
    start: iso("2026-11-14T13:00:00"), end: iso("2026-11-22T23:00:00") },
  { id: "dar-pcf", sport: "darts", kind: "tournament", title: "Players Championship Finals", subtitle: "PDC · Minehead",
    start: iso("2026-11-27T12:00:00"), end: iso("2026-11-29T23:00:00") },
  { id: "dar-wm", sport: "darts", kind: "tournament", major: true, badgeLabel: "WM",
    title: "Darts-WM", subtitle: "PDC · Alexandra Palace, London",
    start: iso("2026-12-11T19:00:00"), end: iso("2027-01-03T23:59:00") },
  tbc({ id: "dar-wm-28", sport: "darts", kind: "tournament", major: true, badgeLabel: "WM",
    title: "Darts-WM 2028", subtitle: "PDC · Alexandra Palace, London",
    start: iso("2027-12-10T19:00:00"), end: iso("2028-01-03T23:59:00") }),
];

async function loadAll() {
  net.calls = 0; net.errors = 0;
  const results = await Promise.allSettled([getF1(), getFootball(), getTennis(), getGolf()]);
  const offline = net.calls > 0 && net.errors === net.calls;
  const live = results.flatMap((r) => (r.status === "fulfilled" ? r.value : []));
  // Läuft ein Turnier bereits live (ESPN), den festen Eintrag desselben Turniers/Jahres weglassen
  const liveTennis = new Set(
    live.filter((e) => e.sport === "tennis" && e.kind === "tournament")
        .map((e) => e.tkey + "|" + e.start.getFullYear())
  );
  const curated = CURATED.filter(
    (e) => !(e.sport === "tennis" && liveTennis.has(e.tkey + "|" + e.start.getFullYear()))
  );
  return { events: [...live, ...curated].sort((a, b) => a.start - b.start), offline };
}

// ---- Offline-Speicher: letzter erfolgreicher Stand im Browser ----
const CACHE_KEY = "startzeit-cache-v1";
function saveCache(events) {
  try { localStorage.setItem(CACHE_KEY, JSON.stringify({ ts: Date.now(), events })); } catch { /* voll/gesperrt */ }
}
function readCache() {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const { ts, events } = JSON.parse(raw);
    return {
      ts: new Date(ts),
      events: events.map((e) => ({ ...e, start: new Date(e.start), end: new Date(e.end) })),
    };
  } catch { return null; }
}

// ---- Kalender-Export (.ics) ----
//  Mehrtägige Turniere werden als ganztägige Termine eingetragen, Einzelevents mit Uhrzeit
//  und Erinnerung 30 Minuten vorher.
function addToCalendar(e) {
  const pad = (n) => String(n).padStart(2, "0");
  const utc = (d) => `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}T${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}00Z`;
  const ymd = (d) => `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}`;
  const esc = (t) => String(t || "").replace(/\\/g, "\\\\").replace(/([,;])/g, "\\$1").replace(/\n/g, "\\n");
  const multiDay = e.start.toDateString() !== e.end.toDateString() && e.end - e.start > 20 * 3600e3;
  const dayAfter = new Date(e.end.getFullYear(), e.end.getMonth(), e.end.getDate() + 1);
  const tv = tvFor(e);
  const lines = [
    "BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Startzeit//DE", "CALSCALE:GREGORIAN", "METHOD:PUBLISH",
    "BEGIN:VEVENT",
    `UID:${e.id}@startzeit`,
    `DTSTAMP:${utc(new Date())}`,
    ...(multiDay
      ? [`DTSTART;VALUE=DATE:${ymd(e.start)}`, `DTEND;VALUE=DATE:${ymd(dayAfter)}`]
      : [`DTSTART:${utc(e.start)}`, `DTEND:${utc(e.end)}`]),
    `SUMMARY:${esc(e.title)}`,
    `DESCRIPTION:${esc([SPORTS[e.sport]?.label, e.subtitle, tv && "TV: " + tv].filter(Boolean).join(" · "))}`,
    ...(multiDay ? [] : ["BEGIN:VALARM", "ACTION:DISPLAY", `DESCRIPTION:${esc(e.title)}`, "TRIGGER:-PT30M", "END:VALARM"]),
    "END:VEVENT", "END:VCALENDAR",
  ];
  const ics = lines.join("\r\n");
  const name = e.title.replace(/[^\wäöüÄÖÜß-]+/g, "_") + ".ics";
  const isIOS = /iP(hone|ad|od)/.test(navigator.userAgent) ||
    (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  if (isIOS) {
    // iPhone/iPad: direkt öffnen, iOS bietet dann "Zum Kalender hinzufügen" an
    window.location.href = "data:text/calendar;charset=utf-8," + encodeURIComponent(ics);
    return;
  }
  // Android/Desktop: Datei herunterladen und mit der Kalender-App öffnen
  const url = URL.createObjectURL(new Blob([ics], { type: "text/calendar;charset=utf-8" }));
  const a = document.createElement("a");
  a.href = url; a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

// ---- TV-Sender (Deutschland, Rechtelage Saison 2026/27) ----
function tvFor(e) {
  if (e.tv) return e.tv;
  const wd = e.start.getDay(), h = e.start.getHours();
  switch (e.sport) {
    case "f1": return "Sky";
    case "golf": return "Sky";
    case "darts": return "Sport1 / DAZN";
    case "biathlon": return "ARD/ZDF";
    case "nfl": return "RTL";
    case "finals": return "ARD/ZDF";
    case "olympia": return "ARD/ZDF";
    case "tennis":
      if (e.tkey === "ao" || e.tkey === "rg") return "Eurosport";
      if (e.tkey === "wim") return "Prime Video";
      return "Sky"; // US Open + Masters 1000
    case "handball":
      return e.id.startsWith("hb-em") ? "ARD/ZDF" : "ProSieben / Joyn";
    case "radsport":
      return e.id.startsWith("rad-tdf") ? "ARD / Eurosport" : "Eurosport";
    case "leichtathletik":
      if (e.id.startsWith("la-wm")) return "ARD/ZDF";
      if (e.id.startsWith("la-berlin")) return "ARD";
      return null;
    case "triathlon":
      if (e.id.startsWith("tri-frankfurt")) return "hr-fernsehen";
      if (e.id.startsWith("tri-roth")) return "BR";
      return null;
    case "fussball":
      if (e.comp === "Bundesliga") {
        if (wd === 0) return "DAZN";                       // Sonntag
        if (wd === 6 && h < 17) return "Sky · Konferenz DAZN"; // Samstag 15:30
        return "Sky";                                       // Freitag, Samstag 18:30
      }
      if (e.comp === "Champions League") return wd === 2 ? "DAZN / Prime Video" : "DAZN";
      if (e.comp === "DFB-Pokal") return "Sky";
      return null;
    default: return null;
  }
}
// ---- Helfer ----
const day = (d) => d.toLocaleDateString("de-DE", { weekday: "long", day: "2-digit", month: "long" });
const time = (d) => d.toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" });
const shortDate = (d) => d.toLocaleDateString("de-DE", { weekday: "short", day: "numeric", month: "short" }).replace(/\./g, "");
const tourDay = (start, now) => {
  const a = new Date(start.getFullYear(), start.getMonth(), start.getDate());
  const b = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  return `Tag ${Math.round((b - a) / 864e5) + 1}`;
};
function isLive(e, now) {
  if (now < e.start) return false;
  if (e.finished === true) return false;
  return now <= e.end;
}

const dayLabel = (d, now) => {
  const wd = d.toLocaleDateString("de-DE", { weekday: "short" }).replace(".", "").toUpperCase();
  const mon = d.toLocaleDateString("de-DE", { month: "short" }).replace(".", "").toUpperCase();
  const isToday = d.toDateString() === now.toDateString();
  return `${isToday ? "HEUTE · " : ""}${wd} ${d.getDate()}. ${mon}`;
};

export default function App() {
  const [events, setEvents] = useState([]);
  const [status, setStatus] = useState("loading");
  const [tab, setTab] = useState("termine");
  // Filter: Liste ausgewählter Sportarten (leer = alle). Wird im Browser gemerkt.
  const [selected, setSelected] = useState(() => {
    try { return JSON.parse(localStorage.getItem("startzeit-filter") || "[]"); } catch { return []; }
  });
  const [filterOpen, setFilterOpen] = useState(false);
  useEffect(() => {
    try { localStorage.setItem("startzeit-filter", JSON.stringify(selected)); } catch { /* egal */ }
  }, [selected]);
  const toggleSport = (k) => setSelected((prev) => (prev.includes(k) ? prev.filter((x) => x !== k) : [...prev, k]));
  const [now, setNow] = useState(new Date());
  const [offlineSince, setOfflineSince] = useState(null); // Zeitpunkt des angezeigten Stands, wenn offline
  const touch = useRef({ x: 0, y: 0 });
  const eventsRef = useRef([]);

  // Laden + automatisch aktualisieren: jede Minute, wenn etwas live läuft, sonst alle 15 Minuten.
  // Beim Zurückkehren in die App oder wenn das Netz wieder da ist, sofort neu laden.
  useEffect(() => {
    let timer, cancelled = false, running = false;
    const cached = readCache();
    if (cached) { eventsRef.current = cached.events; setEvents(cached.events); setStatus("ok"); }

    const schedule = () => {
      clearTimeout(timer);
      const t = new Date();
      const anyLive = eventsRef.current.some((e) => isLive(e, t) && e.kind !== "tournament");
      timer = setTimeout(run, anyLive ? 60e3 : 15 * 60e3);
    };
    async function run() {
      if (running) return;
      running = true;
      try {
        const { events: ev, offline } = await loadAll();
        if (cancelled) return;
        if (offline) {
          // Kein Netz: zuletzt gespeicherten Stand behalten
          const c = readCache();
          if (!eventsRef.current.length) {
            const fallback = c?.events ?? ev;
            eventsRef.current = fallback; setEvents(fallback);
          }
          setOfflineSince(c?.ts ?? new Date());
        } else {
          eventsRef.current = ev; setEvents(ev); saveCache(ev); setOfflineSince(null);
        }
        setStatus("ok");
      } catch {
        if (!cancelled && !eventsRef.current.length) setStatus("error");
      } finally {
        running = false;
        if (!cancelled) schedule();
      }
    }
    run();

    const wake = () => { if (document.visibilityState === "visible") run(); };
    document.addEventListener("visibilitychange", wake);
    window.addEventListener("online", wake);
    return () => {
      cancelled = true; clearTimeout(timer);
      document.removeEventListener("visibilitychange", wake);
      window.removeEventListener("online", wake);
    };
  }, []);
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);

  const present = Object.keys(SPORTS).filter((k) => events.some((e) => e.sport === k));
  const base = selected.length ? events.filter((e) => selected.includes(e.sport)) : events;
  const upcoming = base.filter((e) => e.end >= now && e.kind !== "match");
  const order = Object.keys(SPORTS);
  // Welche Turniere haben gerade echte Live-Spiele? (Tennis pro Turnier, Golf gesamt)
  const liveKeys = new Set(
    events.filter((e) => e.kind === "match" && isLive(e, now))
      .map((e) => (e.sport === "tennis" ? "ten:" + e.tkey : e.sport))
  );
  const live = base
    .filter((e) => isLive(e, now) && e.kind !== "tournament")
    .sort((a, b) => order.indexOf(a.sport) - order.indexOf(b.sport) || a.start - b.start);

  const onTouchStart = (e) => { const t = e.touches[0]; touch.current = { x: t.clientX, y: t.clientY }; };
  const onTouchEnd = (e) => {
    const t = e.changedTouches[0];
    const dx = t.clientX - touch.current.x, dy = t.clientY - touch.current.y;
    if (Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy) * 1.5) setTab(dx < 0 ? "live" : "termine");
  };

  return (
    <div style={S.stage}>
      <style>{FONT + GLOBAL + KEYS}</style>
      <div style={S.phone}>
        <div style={S.head}>
          <span style={S.brand}>{tab === "termine" ? "Startzeit" : "Live"}</span>
          <span style={S.headRight}>
            {live.length > 0 && (
              <span style={S.counter}><i style={S.liveDot} />{live.length} live</span>
            )}
            {status === "ok" && (
              <button onClick={() => setFilterOpen(true)} style={S.filterBtn(selected.length > 0)}
                aria-label="Sportarten filtern">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                  strokeWidth="2.4" strokeLinecap="round"><path d="M3 6h18M7 12h10M10 18h4" /></svg>
                Filter{selected.length > 0 && <span style={S.filterCount}>{selected.length}</span>}
              </button>
            )}
          </span>
        </div>
        {offlineSince && (
          <div style={S.offline}>Offline · Stand {day(offlineSince)}, {time(offlineSince)} Uhr</div>
        )}

        {status === "ok" && selected.length > 0 && (
          <div style={S.activeRow}>
            <span style={S.activeText}>
              {selected.map((k) => SPORTS[k]?.label).filter(Boolean).join(", ")}
            </span>
            <button onClick={() => setSelected([])} style={S.resetBtn}>Alle zeigen</button>
          </div>
        )}

        <div style={S.scroll} onTouchStart={onTouchStart} onTouchEnd={onTouchEnd}>
          {status === "loading" && <p style={S.note}>Termine werden geladen …</p>}
          {status === "error" && <p style={S.note}>Konnte die Termine nicht laden. Verbindung prüfen und neu laden.</p>}
          {status === "ok" && tab === "termine" && (
            <Termine events={upcoming} now={now} liveKeys={liveKeys} onOpenLive={() => setTab("live")} />
          )}
          {status === "ok" && tab === "live" && (
            <Live events={live} next={upcoming.find((e) => !isLive(e, now))} />
          )}
        </div>

        <nav style={S.tabs}>
          <button onClick={() => setTab("termine")} style={S.tab(tab === "termine")}>Termine</button>
          <button onClick={() => setTab("live")} style={S.tab(tab === "live")}>Live</button>
        </nav>

        {filterOpen && (
          <FilterSheet sports={present} selected={selected} onToggle={toggleSport}
            onReset={() => setSelected([])} onClose={() => setFilterOpen(false)} />
        )}
      </div>
    </div>
  );
}

function FilterSheet({ sports, selected, onToggle, onReset, onClose }) {
  return (
    <div style={S.sheetBackdrop} onClick={onClose}>
      <div style={S.sheet} onClick={(e) => e.stopPropagation()}>
        <div style={S.sheetGrip} />
        <div style={S.sheetHead}>
          <span style={S.sheetTitle}>Sportarten</span>
          <button onClick={onReset} style={S.resetBtn}>Alle zeigen</button>
        </div>
        <div style={S.sheetList}>
          {sports.map((k) => {
            const on = selected.includes(k);
            return (
              <button key={k} onClick={() => onToggle(k)} style={S.sheetRow}>
                <span style={{ display: "inline-flex", alignItems: "center", gap: 12 }}>
                  <i style={{ ...S.chipDot, width: 10, height: 10, background: SPORTS[k].color }} />
                  {SPORTS[k].label}
                </span>
                <span style={S.check(on, SPORTS[k].color)}>
                  {on && (
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#fff"
                      strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12l5 5L20 7" /></svg>
                  )}
                </span>
              </button>
            );
          })}
        </div>
        <button onClick={onClose} style={S.sheetDone}>
          {selected.length ? `${selected.length} ausgewählt · Fertig` : "Fertig"}
        </button>
      </div>
    </div>
  );
}

function Termine({ events, now, liveKeys, onOpenLive }) {
  if (!events.length) return <p style={S.note}>Keine anstehenden Veranstaltungen.</p>;
  // Laufende mehrtägige Events (Start vor heute) unter "Heute" einsortieren
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const items = events
    .map((e) => {
      const ongoing = e.start < todayStart;
      return { e, ongoing, d: ongoing ? todayStart : e.start };
    })
    .sort((a, b) => a.d - b.d || a.e.start - b.e.start);
  let lastKey = "";
  return (
    <div style={{ paddingTop: 2 }}>
      {items.map(({ e, ongoing, d }) => {
        const s = SPORTS[e.sport];
        const key = d.toDateString();
        const showDay = key !== lastKey;
        const first = lastKey === "";
        lastKey = key;
        // Mehrtägige Turniere: nur LIVE, wenn gerade wirklich ein Spiel/eine Runde läuft
        // (Tennis: Live-Match dieses Turniers; Golf: Live-Leaderboard). Sonst neutral "läuft".
        const multi = e.kind === "tournament" && e.end - e.start > 20 * 3600e3;
        const inWindow = isLive(e, now);
        const live = multi ? inWindow && liveKeys.has(e.tkey ? "ten:" + e.tkey : e.sport) : inWindow;
        const running = multi && inWindow && !live;
        return (
          <div key={e.id}>
            {showDay && (
              <div style={{
                ...S.dayLabel,
                ...(first
                  ? { marginTop: 4 }
                  : { marginTop: 26, paddingTop: 18, borderTop: `1px solid ${C.border}` }),
              }}>{dayLabel(d, now)}</div>
            )}
            <div style={{ ...S.card, ...(live ? { cursor: "pointer" } : null) }}
              onClick={live ? onOpenLive : undefined}>
              <div style={S.cardTop}>
                <span style={S.pillWrap}>
                  <span style={{ ...S.pill, background: s.color, color: "#fff" }}>
                    <i style={{ ...S.pillDot, background: "#fff" }} />{s.label}
                  </span>
                  {e.major && <span style={S.badge}>{e.badgeLabel}</span>}
                </span>
                <span style={S.rightCol}>
                  {live ? (
                    <>
                      {e.score && <span style={S.time}>{e.score}</span>}
                      <span style={S.livePill}><i style={S.liveDot} />LIVE</span>
                    </>
                  ) : running ? (
                    <span style={S.runningPill}>läuft</span>
                  ) : e.score ? (
                    <span style={{ ...S.time, color: C.grey }}>{e.score}</span>
                  ) : e.tbc ? (
                    <span style={S.tbc}>vorläufig</span>
                  ) : (
                    <span style={S.time}>{time(e.start)}</span>
                  )}
                </span>
              </div>
              <div style={S.cardTitle}>{e.title}</div>
              <div style={S.cardSub}>
                {e.subtitle}
                {ongoing && ` · ${tourDay(e.start, now)} · bis ${shortDate(e.end)}`}
              </div>
              <div style={S.cardFoot}>
                <span style={S.tv}>{tvFor(e) ? `TV · ${tvFor(e)}` : ""}</span>
                <button style={S.calBtn} aria-label="In Kalender eintragen"
                  onClick={(ev) => { ev.stopPropagation(); addToCalendar(e); }}>
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                    strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                    <rect x="3" y="5" width="18" height="16" rx="3" /><path d="M3 10h18M8 3v4M16 3v4M12 13v5M9.5 15.5h5" />
                  </svg>
                  Kalender
                </button>
              </div>
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
          <p style={S.emptySub}>Als Nächstes: {next.title} — {day(next.start)}, {time(next.start)} Uhr</p>
        )}
      </div>
    );
  }
  return (
    <div style={{ paddingTop: 2 }}>
      {events.map((e) => {
        const s = SPORTS[e.sport];
        const comp = e.comp || e.subtitle || s.label;
        return (
          <div key={e.id} style={S.liveCard}>
            <div style={S.liveTop}>
              <span style={{ ...S.pill, background: s.color, color: "#fff" }}>
                <i style={{ ...S.pillDot, background: "#fff" }} />{comp}
              </span>
              <span style={S.livePill}><i style={S.liveDot} />LIVE</span>
            </div>
            {e.rows ? (
              e.rows.map((r, i) => (
                <div key={i} style={{ ...S.liveRow, marginTop: i === 0 ? 16 : 12 }}>
                  <span style={S.liveName}>{r.name}</span>
                  <span style={S.liveStand}>{r.score}</span>
                </div>
              ))
            ) : (
              <div style={{ ...S.liveRow, marginTop: 16 }}>
                <span style={S.liveName}>{e.title}</span>
                <span style={S.liveStand}>{e.score}</span>
              </div>
            )}
            {(e.note || tvFor(e)) && (
              <div style={S.liveNote}>{[e.note, tvFor(e) && "TV · " + tvFor(e)].filter(Boolean).join("  ·  ")}</div>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ============================================================
//  STYLES  –  Design 4a "Kachel"
// ============================================================
const FONT = `@import url('https://fonts.googleapis.com/css2?family=Manrope:wght@400;500;600;700&display=swap');`;
const KEYS = `@keyframes pulse{0%,100%{opacity:1}50%{opacity:.35}}@keyframes fadein{from{opacity:0}to{opacity:1}}@keyframes slideup{from{transform:translateY(100%)}to{transform:translateY(0)}}`;
const GLOBAL = `*{box-sizing:border-box}html,body,#root{margin:0;padding:0;min-height:100%;background:#F4F4F1;text-align:left;}`;

const C = {
  bg: "#F4F4F1", card: "#FFFFFF", ink: "#16161A", grey: "#6F6E6A", border: "#E4E3DF",
  live: "#D8402B", liveInk: "#B8321F", liveTint: "#FBEAE7",
  body: "'Manrope', system-ui, -apple-system, sans-serif",
};

const S = {
  stage: { background: C.bg, minHeight: "100dvh", display: "flex", justifyContent: "center", fontFamily: C.body },
  phone: {
    position: "relative", width: "100%", maxWidth: 480, height: "100dvh", background: C.bg,
    display: "flex", flexDirection: "column", overflow: "hidden", color: C.ink, textAlign: "left",
  },

  head: { display: "flex", alignItems: "center", justifyContent: "space-between",
          padding: "calc(20px + env(safe-area-inset-top)) 20px 12px" },
  brand: { fontSize: 27, lineHeight: "27px", fontWeight: 700, letterSpacing: "-0.035em" },
  headRight: { display: "inline-flex", alignItems: "center", gap: 8 },
  filterBtn: (on) => ({ display: "inline-flex", alignItems: "center", gap: 6, cursor: "pointer",
    borderRadius: 999, padding: "6px 12px", fontFamily: C.body, fontSize: 12, fontWeight: 600,
    border: `1px solid ${on ? C.ink : C.border}`, background: on ? C.ink : C.card, color: on ? "#fff" : C.ink }),
  filterCount: { background: "#fff", color: C.ink, borderRadius: 999, minWidth: 17, height: 17,
    display: "inline-flex", alignItems: "center", justifyContent: "center", fontSize: 10.5, fontWeight: 700 },
  activeRow: { display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10,
    padding: "0 20px 12px", flexShrink: 0 },
  activeText: { fontSize: 12.5, fontWeight: 600, color: C.grey, overflow: "hidden",
    textOverflow: "ellipsis", whiteSpace: "nowrap" },
  resetBtn: { flexShrink: 0, cursor: "pointer", border: "none", background: "none", padding: 0,
    fontFamily: C.body, fontSize: 12.5, fontWeight: 700, color: C.ink, textDecoration: "underline",
    textUnderlineOffset: 3 },
  sheetBackdrop: { position: "absolute", inset: 0, background: "rgba(22,22,26,.35)", zIndex: 20,
    display: "flex", alignItems: "flex-end", animation: "fadein .15s ease-out" },
  sheet: { width: "100%", maxHeight: "80%", background: C.bg, borderRadius: "24px 24px 0 0",
    padding: "8px 16px calc(16px + env(safe-area-inset-bottom))", display: "flex", flexDirection: "column",
    animation: "slideup .2s ease-out" },
  sheetGrip: { width: 36, height: 4, borderRadius: 2, background: C.border, margin: "4px auto 10px" },
  sheetHead: { display: "flex", alignItems: "center", justifyContent: "space-between", padding: "4px 4px 12px" },
  sheetTitle: { fontSize: 20, fontWeight: 700, letterSpacing: "-0.02em" },
  sheetList: { overflowY: "auto", background: C.card, borderRadius: 18 },
  sheetRow: { width: "100%", display: "flex", alignItems: "center", justifyContent: "space-between",
    cursor: "pointer", border: "none", borderBottom: `1px solid ${C.border}`, background: "none",
    padding: "14px 16px", fontFamily: C.body, fontSize: 15, fontWeight: 600, color: C.ink, textAlign: "left" },
  check: (on, color) => ({ width: 22, height: 22, borderRadius: 7, flexShrink: 0,
    display: "inline-flex", alignItems: "center", justifyContent: "center",
    border: `1.5px solid ${on ? color : C.border}`, background: on ? color : "transparent" }),
  sheetDone: { marginTop: 12, cursor: "pointer", border: "none", borderRadius: 999, padding: "14px 0",
    fontFamily: C.body, fontSize: 14, fontWeight: 600, background: C.ink, color: "#fff" },
  counter: { display: "inline-flex", alignItems: "center", gap: 7, background: C.card,
             border: `1px solid ${C.border}`, borderRadius: 999, padding: "6px 12px",
             fontSize: 12, fontWeight: 600, letterSpacing: "-0.005em" },

  chips: { display: "flex", gap: 8, overflowX: "auto", padding: "6px 16px 14px", flexShrink: 0 },
  chipAll: (on) => ({ flexShrink: 0, cursor: "pointer", borderRadius: 999, padding: "8px 13px",
    fontFamily: C.body, fontSize: 11, fontWeight: 700, letterSpacing: "0.03em", textTransform: "uppercase",
    border: `1px solid ${C.border}`, background: C.card, color: on ? C.ink : C.grey }),
  chip: (on, dim, color) => ({ display: "inline-flex", alignItems: "center", gap: 6, whiteSpace: "nowrap",
    flexShrink: 0, cursor: "pointer", borderRadius: 999, padding: "8px 13px",
    fontFamily: C.body, fontSize: 11, fontWeight: 700, letterSpacing: "0.03em", textTransform: "uppercase",
    border: `1px solid ${on ? color : C.border}`, background: on ? color + "1A" : C.card,
    color: on ? color : C.ink, opacity: dim ? 0.45 : 1 }),
  chipDot: { width: 7, height: 7, borderRadius: "50%", flexShrink: 0 },

  scroll: { flex: 1, minHeight: 0, overflowY: "auto", padding: "0 16px 110px" },
  note: { color: C.grey, fontSize: 14, padding: "24px 4px", lineHeight: 1.5 },

  dayLabel: { fontSize: 12.5, fontWeight: 700, letterSpacing: "0.06em", textTransform: "uppercase",
              color: C.grey, marginBottom: 8, paddingLeft: 2 },

  card: { background: C.card, borderRadius: 18, boxShadow: "0 1px 2px rgba(22,22,26,.05)",
          padding: "15px 16px 16px", marginBottom: 8 },
  cardTop: { display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 10 },
  pillWrap: { display: "inline-flex", alignItems: "center", gap: 8, minWidth: 0 },
  pill: { display: "inline-flex", alignItems: "center", gap: 6, borderRadius: 999, padding: "4px 9px",
          fontSize: 11, fontWeight: 700, letterSpacing: "0.03em", textTransform: "uppercase", whiteSpace: "nowrap" },
  pillDot: { width: 7, height: 7, borderRadius: "50%", flexShrink: 0 },
  badge: { fontSize: 11, fontWeight: 600, letterSpacing: "-0.005em", color: C.grey, whiteSpace: "nowrap" },
  rightCol: { display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 6, flexShrink: 0 },
  time: { fontSize: 22, lineHeight: "24px", fontWeight: 700, letterSpacing: "-0.035em",
          fontVariantNumeric: "tabular-nums", color: C.ink, whiteSpace: "nowrap" },
  tv: { fontSize: 11.5, lineHeight: "16px", fontWeight: 700, letterSpacing: "0.02em",
        color: C.ink, opacity: 0.55 },
  cardFoot: { display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, marginTop: 10 },
  calBtn: { display: "inline-flex", alignItems: "center", gap: 5, flexShrink: 0, cursor: "pointer",
    border: `1px solid ${C.border}`, background: C.card, borderRadius: 999, padding: "5px 10px",
    fontFamily: C.body, fontSize: 11.5, fontWeight: 600, color: C.grey },
  offline: { margin: "0 20px 8px", fontSize: 12, fontWeight: 600, color: C.liveInk,
             background: C.liveTint, borderRadius: 10, padding: "7px 11px" },
  runningPill: { fontSize: 10.5, fontWeight: 700, letterSpacing: "0.04em", textTransform: "uppercase",
                 color: C.grey, background: C.bg, border: `1px solid ${C.border}`, borderRadius: 999,
                 padding: "3px 8px", whiteSpace: "nowrap" },
  tbc: { fontSize: 11, fontWeight: 700, letterSpacing: "0.04em", textTransform: "uppercase",
         color: C.grey, border: `1px dashed ${C.border}`, borderRadius: 999, padding: "4px 9px",
         whiteSpace: "nowrap" },
  livePill: { display: "inline-flex", alignItems: "center", gap: 5, background: C.liveTint, color: C.liveInk,
              borderRadius: 999, padding: "3px 8px", fontSize: 10.5, fontWeight: 700,
              letterSpacing: "0.04em", textTransform: "uppercase" },
  liveDot: { width: 6, height: 6, borderRadius: "50%", background: C.live, display: "inline-block",
             animation: "pulse 1.4s infinite" },
  cardTitle: { fontSize: 17, lineHeight: "22px", fontWeight: 600, letterSpacing: "-0.022em",
               color: C.ink, marginTop: 12 },
  cardSub: { fontSize: 13, lineHeight: "18px", fontWeight: 500, letterSpacing: "-0.005em",
             color: C.grey, marginTop: 4 },

  empty: { textAlign: "center", padding: "70px 24px" },
  emptyBig: { fontSize: 20, fontWeight: 700, letterSpacing: "-0.02em", margin: "0 0 8px", color: C.ink },
  emptySub: { color: C.grey, fontSize: 14, lineHeight: 1.5 },

  liveCard: { background: C.card, borderRadius: 22, boxShadow: "0 1px 2px rgba(22,22,26,.05)",
              padding: "18px 20px", marginBottom: 12 },
  liveTop: { display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 },
  liveRow: { display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 },
  liveName: { fontSize: 18, lineHeight: "23px", fontWeight: 600, letterSpacing: "-0.02em", color: C.ink,
              whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" },
  liveStand: { fontSize: 32, lineHeight: "32px", fontWeight: 700, letterSpacing: "-0.04em",
               fontVariantNumeric: "tabular-nums", color: C.ink, whiteSpace: "nowrap", flexShrink: 0 },
  liveNote: { fontSize: 13, lineHeight: "18px", fontWeight: 500, letterSpacing: "-0.005em",
              color: C.grey, marginTop: 16 },

  tabs: { position: "absolute", left: 16, right: 16, bottom: "calc(22px + env(safe-area-inset-bottom))",
          display: "flex", background: C.card, borderRadius: 999, padding: 5,
          boxShadow: "0 4px 16px -6px rgba(22,22,26,.16)" },
  tab: (on) => ({ flex: 1, textAlign: "center", cursor: "pointer", border: "none", borderRadius: 999,
    padding: "11px 0", fontFamily: C.body, fontSize: 13.5, fontWeight: 600, letterSpacing: "-0.01em",
    background: on ? C.ink : "transparent", color: on ? "#fff" : C.grey }),
};