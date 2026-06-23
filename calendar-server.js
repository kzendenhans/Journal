#!/usr/bin/env node
// Dagboek kalenderserver — leest macOS Calendar via AppleScript
// Start: node calendar-server.js
// Draait op http://localhost:7878

const http = require('http');
const { exec } = require('child_process');

const PORT = 7878;

const EXCLUDE_CALENDARS = [
  'Birthdays', 'Verjaardagen', 'Feestdagen in België',
  'Belgische feestdagen', 'Siri-suggesties', 'Geplande herinneringen',
];

function getEvents(fromStr, toStr, callback) {
  const [fy, fm, fd] = fromStr.split('-').map(Number);
  const [ty, tm, td] = toStr.split('-').map(Number);

  const script = `
tell application "Calendar"
  set startDate to (current date)
  set year of startDate to ${fy}
  set month of startDate to ${fm}
  set day of startDate to ${fd}
  set hours of startDate to 0
  set minutes of startDate to 0
  set seconds of startDate to 0
  set endDate to (current date)
  set year of endDate to ${ty}
  set month of endDate to ${tm}
  set day of endDate to ${td}
  set hours of endDate to 23
  set minutes of endDate to 59
  set seconds of endDate to 59
  set output to ""
  repeat with cal in every calendar
    set calName to name of cal
    try
      set evs to (every event of cal whose start date >= startDate and start date <= endDate)
      repeat with ev in evs
        set evStart to start date of ev
        set d to day of evStart as integer
        set m to month of evStart as integer
        set y to year of evStart as integer
        set h to hours of evStart as integer
        set mi to minutes of evStart as integer
        set ds to (y as string) & "-"
        if m < 10 then set ds to ds & "0"
        set ds to ds & (m as string) & "-"
        if d < 10 then set ds to ds & "0"
        set ds to ds & (d as string) & "T"
        if h < 10 then set ds to ds & "0"
        set ds to ds & (h as string) & ":"
        if mi < 10 then set ds to ds & "0"
        set ds to ds & (mi as string)
        set output to output & calName & "||" & ds & "||" & summary of ev & "¶"
      end repeat
    end try
  end repeat
  return output
end tell
`;

  exec(`osascript << 'APPLESCRIPT'\n${script}\nAPPLESCRIPT`, (err, stdout) => {
    if (err) { callback(err); return; }
    const events = [];
    stdout.trim().split('¶').filter(Boolean).forEach(line => {
      const parts = line.split('||');
      if (parts.length < 3) return;
      const cal = parts[0].trim();
      if (EXCLUDE_CALENDARS.includes(cal)) return;
      events.push({ calendar: cal, datetime: parts[1].trim(), title: parts[2].trim() });
    });
    events.sort((a, b) => a.datetime < b.datetime ? -1 : 1);
    callback(null, events);
  });
}

const server = http.createServer((req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  if (req.method === 'OPTIONS') { res.writeHead(200); res.end(); return; }

  const url = new URL(req.url, `http://localhost:${PORT}`);

  if (url.pathname === '/calendar') {
    const from = url.searchParams.get('from');
    const to   = url.searchParams.get('to');
    if (!from || !to) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'from en to zijn verplicht' }));
      return;
    }
    getEvents(from, to, (err, events) => {
      if (err) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: err.message }));
        return;
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(events));
    });
  } else {
    res.writeHead(404);
    res.end();
  }
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`Dagboek kalenderserver actief op http://localhost:${PORT}`);
});
