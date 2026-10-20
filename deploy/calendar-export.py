#!/usr/bin/env python3
"""
calendar-export.py — writes today's meetings (Flagbit + Runprise) for tesla.weller.cc.

Runs as user `wellbot` (systemd timer tesla-calendar-export) and reads both
calendars: Flagbit through Wellbot's calendar_bridge (self-refreshing user
token), Runprise through the app-only registration "tesla-calendar"
(Calendars.Read, limited to Joerg's mailbox by an Exchange application access
policy) — Runprise's security defaults reject refreshing a user token from
the server. Writes only what the dashboard needs (subject, times, location, join
link, source) to /opt/tesdash/calendar/today.json. The tokens never leave
Wellbot; the dashboard container mounts the output directory read-only.
"""
import html
import json
import os
import re
import sys
import tempfile
import urllib.parse
import urllib.request
from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo

sys.path.insert(0, "/opt/claude-telegram/.claude/tools")
import calendar_bridge as cb  # noqa: E402

OUT_DIR = "/opt/tesdash/calendar"
OUT_FILE = os.path.join(OUT_DIR, "today.json")
BERLIN = ZoneInfo("Europe/Berlin")
RUNPRISE_APP = "/opt/tesdash/runprise-app.json"
EVENT_FIELDS = ("id,iCalUId,subject,start,end,isAllDay,isCancelled,showAs,"
                "organizer,attendees,responseStatus,body,onlineMeeting,location")


def runprise_app_events(von, bis):
    """calendarView of the configured mailbox via client credentials (no user token, no MFA)."""
    with open(RUNPRISE_APP) as f:
        app = json.load(f)
    form = urllib.parse.urlencode({
        "grant_type": "client_credentials",
        "client_id": app["client_id"],
        "client_secret": app["client_secret"],
        "scope": "https://graph.microsoft.com/.default",
    }).encode()
    token_url = f"https://login.microsoftonline.com/{app['tenant_id']}/oauth2/v2.0/token"
    with urllib.request.urlopen(urllib.request.Request(token_url, data=form), timeout=30) as res:
        token = json.loads(res.read())["access_token"]
    query = urllib.parse.urlencode({
        "startDateTime": von, "endDateTime": bis, "$select": EVENT_FIELDS,
        "$orderby": "start/dateTime", "$top": "200",
    })
    req = urllib.request.Request(
        f"https://graph.microsoft.com/v1.0/users/{urllib.parse.quote(app['mailbox'])}/calendarView?{query}",
        headers={"Authorization": f"Bearer {token}", "Prefer": 'outlook.timezone="W. Europe Standard Time"'},
    )
    with urllib.request.urlopen(req, timeout=30) as res:
        return json.loads(res.read()).get("value", [])


SOURCES = (
    ("flagbit", lambda von, bis: cb.termine(cb.FLAGBIT, von, bis)),
    ("runprise", runprise_app_events),
)
# Same noise filter as Wellbot's termin_watch.py.
JUNK_SUBJECTS = {"Andere Zeitzone – nicht verfügbar", "Abwesend – andere Zeitzone"}
URL_CANDIDATE = re.compile(r"https://[^\s<>\"']+")
# (exact host or parent domain, required path prefix). Anything else is not offered as a join button.
MEETING_HOSTS = (
    ("teams.microsoft.com", "/l/meetup-join/"),
    ("teams.microsoft.com", "/meet/"),
    ("teams.live.com", "/meet/"),
    ("meet.google.com", "/"),
    ("zoom.us", "/j/"),
)


def meeting_url(candidate):
    """The candidate if it is an https link to a known meeting service, else None."""
    try:
        parsed = urllib.parse.urlsplit(candidate)
    except ValueError:
        return None
    host = (parsed.hostname or "").lower()
    if parsed.scheme != "https" or parsed.username or parsed.password:
        return None
    for allowed, prefix in MEETING_HOSTS:
        if (host == allowed or host.endswith("." + allowed)) and parsed.path.startswith(prefix):
            return candidate
    return None


def utc_iso(field):
    # calendar_bridge asks Graph for W. Europe time without offset.
    local = cb._zeit(field).replace(tzinfo=BERLIN)
    return local.astimezone(timezone.utc).isoformat().replace("+00:00", "Z")


def join_url(event):
    url = meeting_url((event.get("onlineMeeting") or {}).get("joinUrl") or "")
    if url:
        return url
    # External invitations carry the link only in the body or location.
    for text in ((event.get("location") or {}).get("displayName"), (event.get("body") or {}).get("content")):
        for candidate in URL_CANDIDATE.findall(html.unescape(text or "")):
            url = meeting_url(candidate)
            if url:
                return url
    return None


def attendee_summary(event):
    """Counts without names: people only (no rooms), split by their answer."""
    people = [a for a in event.get("attendees") or [] if a.get("type") != "resource"]
    answers = [((a.get("status") or {}).get("response") or "none") for a in people]
    return {
        "total": len(people),
        "accepted": answers.count("accepted"),
        "tentative": answers.count("tentativelyAccepted"),
        "declined": answers.count("declined"),
    }


def todays_events():
    start = datetime.now(BERLIN).replace(hour=0, minute=0, second=0, microsecond=0)
    von = start.strftime("%Y-%m-%dT%H:%M:%S")
    bis = (start + timedelta(days=1)).strftime("%Y-%m-%dT%H:%M:%S")
    events, errors = [], []
    for source, fetch in SOURCES:
        try:
            raw = fetch(von, bis)
        except BaseException as err:  # calendar_bridge raises SystemExit when a token cannot be refreshed
            # A dead source must show up as an error, not as an empty calendar.
            errors.append(source)
            print(f"calendar export: {source} failed: {err}", file=sys.stderr)
            continue
        for e in raw:
            subject = (e.get("subject") or "").strip()
            # Bridge blockers mirror the other calendar; keep only originals.
            if not cb.belegend(e) or cb.ist_gespiegelt(e) or e.get("showAs") == "oof" or subject in JUNK_SUBJECTS:
                continue
            events.append({
                "subject": subject or "Termin",
                "start": utc_iso(e["start"]),
                "end": utc_iso(e["end"]),
                "location": ((e.get("location") or {}).get("displayName") or "").strip(),
                "joinUrl": join_url(e),
                "tentative": e.get("showAs") == "tentative",
                "source": source,
                "organizer": ((e.get("organizer") or {}).get("emailAddress") or {}).get("name") or "",
                "isOrganizer": (e.get("responseStatus") or {}).get("response") == "organizer",
                "myResponse": (e.get("responseStatus") or {}).get("response") or "none",
                "attendees": attendee_summary(e),
            })
    events.sort(key=lambda ev: ev["start"])
    return events, errors


def write_atomic(payload):
    os.makedirs(OUT_DIR, exist_ok=True)
    fd, tmp = tempfile.mkstemp(dir=OUT_DIR, prefix=".today-")
    with os.fdopen(fd, "w") as f:
        json.dump(payload, f, ensure_ascii=False)
    os.chmod(tmp, 0o644)
    os.replace(tmp, OUT_FILE)


def main():
    generated = datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")
    try:
        events, errors = todays_events()
        if len(errors) == len(SOURCES):
            raise RuntimeError("no calendar reachable")
        write_atomic({"generatedAt": generated, "date": datetime.now(BERLIN).date().isoformat(), "events": events, "errors": errors})
    except Exception as err:  # keep the last good file; the dashboard shows its age
        print(f"calendar export failed: {err}", file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    main()
