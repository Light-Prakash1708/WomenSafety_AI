"""Drives the SAAHI web build end to end in Chromium (phone or laptop size) against the Turso-style API."""
import glob, json, os, re, subprocess, sys, time, urllib.request
from playwright.sync_api import sync_playwright, expect

VP = os.environ.get("VP", "phone")
APP = os.environ["APP"]
DB = os.environ["TEST_DB"]
OUT = os.environ.get("TEST_OUT", "test-results")
TRACK = APP + "/track/"
SHOTS = os.path.join(OUT, f"shots-{VP}")
os.makedirs(SHOTS, exist_ok=True)
for f in glob.glob(f"{SHOTS}/*.png"):
    os.remove(f)

results, errors = [], []
def check(name, cond, detail=""):
    results.append(("PASS" if cond else "FAIL", name, detail))
    print(("PASS " if cond else "FAIL ") + name + (f"  -> {detail}" if detail and not cond else ""), flush=True)

import sqlite3
def sql(q):
    con = sqlite3.connect(DB, timeout=10)
    try:
        row = con.execute(q).fetchone()
        return "" if row is None or row[0] is None else str(row[0])
    finally:
        con.close()

def wait_sql(q, want, timeout=12):
    end = time.time() + timeout
    got = sql(q)
    while got != want and time.time() < end:
        time.sleep(0.4)
        got = sql(q)
    return got

def api(method, path, body=None, token=None):
    req = urllib.request.Request(APP + "/api/" + path, method=method, data=json.dumps(body).encode() if body is not None else None,
                                 headers={"content-type": "application/json", **({"authorization": "Bearer " + token} if token else {})})
    try:
        with urllib.request.urlopen(req) as r:
            return json.loads(r.read() or b"{}")
    except urllib.error.HTTPError as e:
        return {"status": e.code, **json.loads(e.read() or b"{}")}

stamp = str(int(time.time()))
email = f"ananya.ui+{stamp}@test.in"
PASSWORD = "safe walk home"
guardian = api("POST", "auth/signup", {"email": f"ma.ui+{stamp}@test.in", "password": "mother pass 1", "name": "Mita Ghosh"})
check("guardian account created through the API", bool(guardian.get("token")), str(guardian))
GT = guardian["token"]

def guardian_ack(alert_id, msg):
    r = api("POST", f"alerts/{alert_id}/ack", {"message": msg}, GT)
    return "OK" if r.get("ok") else "ERR " + str(r)

def dump(page, tag):
    try:
        page.screenshot(path=os.path.join(OUT, f"fail-{tag}.png")); print("URL", page.url); print(page.inner_text("body")[:500])
    except Exception as e:
        print("dump failed", e)

with sync_playwright() as p:
    browser = p.chromium.launch(args=["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream"])
    vp = {"width": 390, "height": 844} if VP == "phone" else {"width": 1440, "height": 900}
    ctx = browser.new_context(
        viewport=vp, device_scale_factor=2 if VP == "phone" else 1, is_mobile=VP == "phone", has_touch=VP == "phone",
        geolocation={"latitude": 22.5180, "longitude": 88.3530, "accuracy": 8},
        permissions=["geolocation", "microphone", "notifications"], locale="en-IN", timezone_id="Asia/Kolkata",
    )
    page = ctx.new_page()
    page.on("console", lambda m: m.type == "error" and errors.append(m.text))
    page.on("pageerror", lambda e: errors.append("PAGEERROR " + str(e)))
    bad_responses = []
    page.on("response", lambda r: r.status >= 400 and bad_responses.append(f"{r.status} {r.request.resource_type} {r.url}"))
    EDGE_JS = """() => {
      const W = window.innerWidth, bad = [];
      if (document.documentElement.scrollWidth > W + 1) bad.push('page scrolls sideways: ' + document.documentElement.scrollWidth);
      for (const el of document.querySelectorAll('#root *')) {
        const st = getComputedStyle(el);
        if (st.visibility === 'hidden' || st.display === 'none' || st.opacity === '0') continue;
        const r = el.getBoundingClientRect();
        if (r.width === 0 || r.height === 0) continue;
        // ignore content inside horizontally scrolling containers
        let p = el.parentElement, scroller = false;
        while (p) { const ps = getComputedStyle(p); if (ps.overflowX === 'auto' || ps.overflowX === 'scroll') { scroller = true; break; } p = p.parentElement; }
        if (scroller) continue;
        const shadow = parseFloat((st.boxShadow.match(/(-?\\d+)px (-?\\d+)px/) || [0, 0])[1]) || 0;
        if (r.left < -0.5 || r.right + Math.max(0, shadow) > W + 0.5) bad.push((el.innerText || el.tagName).slice(0, 40).replace(/\\n/g, ' ') + ' [' + Math.round(r.left) + '..' + Math.round(r.right + shadow) + ']');
      }
      return bad.slice(0, 5);
    }"""
    edge_fail = []
    def shot(n):
        page.screenshot(path=f"{SHOTS}/{n}.png")
        bad = page.evaluate(EDGE_JS)
        if bad:
            edge_fail.append(f"{n}: {bad}")

    import atexit
    atexit.register(lambda: None)
    # ---- Sign in ----
    page.goto(APP)
    page.get_by_placeholder("you@example.com").wait_for(timeout=30000)
    shot("01-sign-in")
    page.get_by_role("button", name="Create account").first.click()
    page.get_by_placeholder("you@example.com").fill(email)
    page.get_by_placeholder("At least 8 characters").fill("short")
    check("short password keeps Create account disabled", page.get_by_role("button", name="Create account").last.is_disabled())
    page.get_by_placeholder("At least 8 characters").fill(PASSWORD)
    page.get_by_role("button", name="Create account").last.click()
    page.get_by_text("Save your recovery code").wait_for(timeout=15000)
    recovery = page.get_by_test_id("recovery-code").inner_text().strip()
    check("recovery code shown once after sign-up", re.fullmatch(r"[A-Z0-9]{4}(-[A-Z0-9]{4}){3}", recovery) is not None, recovery)
    shot("01b-recovery-code")
    page.get_by_text("I've saved it").click()
    page.get_by_text("Let's set up your safety net").wait_for(timeout=15000)
    check("account created and signed in", True)

    # ---- Onboarding ----
    page.get_by_placeholder("Ananya Ghosh").fill("Ananya Ghosh")
    page.get_by_placeholder("+91 98300 12345").fill("+91 98300 00011")
    shot("02-onboarding-you")
    page.get_by_text("Continue", exact=True).click()
    page.get_by_text("Who should come for you?").wait_for()
    page.get_by_text("Continue", exact=True).click()
    check("onboarding blocks an empty circle", page.get_by_text("Add at least one person").is_visible())
    for name, phone, rel in [("Ma", "+91 98300 11111", "Mother"), ("Riya Sen", "+91 98300 99999", "Roommate")]:
        page.get_by_placeholder("Ma", exact=True).fill(name)
        page.get_by_placeholder("+91 98300 12345").fill(phone)
        page.get_by_placeholder("Mother, roommate, warden").fill(rel)
        page.get_by_text("Add to my circle").click()
        page.get_by_text(name, exact=True).first.wait_for()
    page.get_by_role("button", name="Options for Ma").click()
    page.get_by_text(re.compile("Guardian code [A-Z0-9]{8}")).wait_for()
    code = re.search(r"Guardian code ([A-Z0-9]{8})", page.get_by_text(re.compile("Guardian code")).inner_text()).group(1)
    check("each contact gets a guardian invite code", len(code) == 8)
    j = api("POST", "guardian/join", {"code": code}, GT)
    check("Ma joins her circle with the code", j.get("ok") is True and j.get("name") == "Ananya", str(j))
    page.get_by_role("button", name="Options for Ma").click()
    shot("03-onboarding-circle")
    page.get_by_text("Continue", exact=True).click()
    page.get_by_text("Two PINs that keep you in control").wait_for()
    inputs = page.locator("input[type=password]")
    inputs.nth(0).fill("1234")
    inputs.nth(1).fill("1234")
    page.get_by_text("Continue", exact=True).click()
    check("same cancel and duress PIN rejected", page.get_by_text("must be different").is_visible())
    inputs.nth(1).fill("9999")
    shot("04-onboarding-pins")
    page.get_by_text("Continue", exact=True).click()
    page.get_by_text("Let SAAHI help when it counts").wait_for()
    page.get_by_text("Allow location", exact=True).click()
    page.get_by_text("Location: allowed").wait_for(timeout=10000)
    shot("05-onboarding-permissions")
    page.get_by_text("Finish setup").click()
    page.get_by_text("Hi, Ananya").wait_for(timeout=15000)
    check("onboarding completes to Home", True)
    uid = sql(f"select id from users where email='{email}'")
    check("profile saved as onboarded", sql(f"select onboarded||display_name from profiles where id='{uid}'") == "1Ananya Ghosh")
    time.sleep(1)
    shot("06-home")
    man = page.evaluate("() => document.querySelector('link[rel=manifest]')?.href || ''")
    check("web app manifest linked", man == APP + "/manifest.webmanifest", man)
    check("manifest is served", page.request.get(man).ok if man else False)
    time.sleep(1.5)
    check("service worker registered (installable app)", page.evaluate("async () => !!(await navigator.serviceWorker.getRegistration())"))
    # Offline cache must keep the app shell, never the tracking page.
    page.goto(APP + "/track/?t=" + "0" * 36)
    page.get_by_text("This alert doesn't exist").wait_for(timeout=10000)
    time.sleep(1)
    ctx.set_offline(True)
    page.goto(APP + "/")
    page.get_by_text("Can't reach SAAHI").wait_for(timeout=15000)
    check("offline: the app shell opens (not the tracking page) with a clear message", True)
    shot("06c-offline")
    ctx.set_offline(False)
    page.get_by_role("button", name="Try again").click()
    page.get_by_text("Hi, Ananya").wait_for(timeout=15000)
    check("back online: Try again returns to Home", True)
    errors.clear()  # the offline step's network errors were intended
    if VP == "desktop":
        check("laptop layout uses a side rail", page.get_by_role("tab", name="Pattern").bounding_box()["x"] < 260)
        col = page.get_by_text("Hi, Ananya").bounding_box()
        check("content sits in a centred readable column", col["x"] > 400, str(col))

    # ---- Language switch ----
    page.get_by_text("বাংলা").click()
    page.get_by_text("নমস্কার, Ananya").wait_for()
    shot("07-home-bengali")
    page.get_by_text("EN", exact=True).click()
    page.get_by_text("Hi, Ananya").wait_for()
    check("language switches to Bengali and back", True)

    # ---- Short tap must NOT fire SOS ----
    sos = page.get_by_role("button", name=re.compile("SOS. Press and hold"))
    sos.click()
    time.sleep(1)
    check("a short tap on SOS does nothing", sql(f"select count(*) from alerts where owner_id='{uid}'") == "0")

    # ---- Hold SOS ----
    box = sos.bounding_box()
    page.mouse.move(box["x"] + box["width"] / 2, box["y"] + box["height"] / 2)
    page.mouse.down()
    time.sleep(2.4)
    page.mouse.up()
    page.get_by_text("Help is on the way").wait_for(timeout=15000)
    time.sleep(3)
    alert = sql(f"select id||'|'||public_token||'|'||status||'|'||printf('%.3f', last_lat) from alerts where owner_id='{uid}' order by started_at desc limit 1").split("|")
    check("holding SOS 2 s creates a live alert", len(alert) == 4 and alert[2] == "active", "|".join(alert))
    check("alert carries her GPS location", len(alert) == 4 and alert[3] == "22.518", "|".join(alert))
    alert_id, token = alert[0], alert[1]
    check("both contacts added as recipients", sql(f"select count(*) from alert_recipients where alert_id='{alert_id}'") == "2")
    page.get_by_text("Send your alert").wait_for(timeout=5000)
    check("browser SOS offers WhatsApp for each contact", page.get_by_text("WhatsApp", exact=True).count() == 2)
    wa = page.evaluate("() => null")
    shot("08-sos-active")
    page.screenshot(path=f"{SHOTS}/08b-sos-full.png", full_page=True)

    # ---- Helper opens the tracking link ----
    helper = ctx.browser.new_context(viewport={"width": 390, "height": 844}, device_scale_factor=2, is_mobile=True)
    hp = helper.new_page()
    hp.on("pageerror", lambda e: errors.append("TRACK " + str(e)))
    hp.goto(f"{TRACK}?t={token}")
    hp.get_by_text("Ananya needs help").wait_for(timeout=15000)
    check("tracking page loads her alert", True)
    check("tracking page shows her location", "Accurate to about" in hp.locator("#locMeta").inner_text())
    hp.screenshot(path=f"{SHOTS}/09-track-page.png", full_page=True)
    hp.get_by_role("button", name="Riya").click()
    hp.locator("#msg").fill("Coming, 10 min")
    hp.get_by_text("I'm on it").click()
    hp.get_by_text("She can see you're on it").wait_for(timeout=10000)
    check("helper acknowledges from the tracking page", sql(f"select status from alert_recipients where alert_id='{alert_id}' and name='Riya Sen'") == "acknowledged")
    hp.screenshot(path=f"{SHOTS}/10-track-acked.png", full_page=True)

    # ---- Guardian acknowledges from the app ----
    check("guardian acknowledges via app account", guardian_ack(alert_id, "On my way") == "OK")
    page.get_by_text("2 people are coming").wait_for(timeout=20000)
    check("her SOS screen updates to '2 people are coming'", True)
    check("her screen shows Riya's message", page.get_by_text("Coming, 10 min").is_visible())
    shot("11-sos-acknowledged")

    # ---- Duress PIN ----
    page.get_by_text("I'm safe", exact=True).click()
    page.get_by_text("Enter PIN to cancel").wait_for()
    for d in "1111":
        page.get_by_role("button", name=d, exact=True).click()
    page.get_by_text("Wrong PIN").wait_for()
    check("wrong PIN keeps the alert running", sql(f"select status from alerts where id='{alert_id}'") == "active")
    shot("12-pin-wrong")
    for d in "9999":
        page.get_by_role("button", name=d, exact=True).click()
    page.get_by_text("Alert cancelled").wait_for()
    shot("13-duress-looks-cancelled")
    row = sql(f"select status||'|'||duress from alerts where id='{alert_id}'")
    check("duress PIN: screen says cancelled, alert still live", row == "active|1", row)
    hp.reload()
    hp.get_by_text("She may have been forced to cancel").wait_for(timeout=10000)
    check("helpers are warned about a forced cancel", True)
    hp.screenshot(path=f"{SHOTS}/14-track-duress.png", full_page=True)

    # ---- Back to Home, reopen hidden alert, real cancel ----
    page.get_by_text("Done", exact=True).click()
    try:
        page.get_by_text("Hi, Ananya").wait_for(timeout=8000)
    except Exception:
        dump(page, "after-duress"); loc=page.get_by_text("Hi, Ananya"); print("COUNT", loc.count(), [loc.nth(i).is_visible() for i in range(loc.count())]); raise
    check("Home looks normal during duress", page.get_by_text("Help is on the way").count() == 0)
    logo = page.get_by_test_id("rail-logo" if VP == "desktop" else "logo")
    lb = logo.bounding_box()
    page.mouse.move(lb["x"] + 10, lb["y"] + 10)
    page.mouse.down(); time.sleep(1.3); page.mouse.up()
    page.get_by_text("Still sharing quietly").wait_for(timeout=10000)
    check("long-press logo reveals the hidden alert", True)
    page.get_by_text("I'm safe", exact=True).click()
    for d in "1234":
        page.get_by_role("button", name=d, exact=True).click()
    page.get_by_text("Tell your circle you're safe").wait_for()
    check("real PIN ends the alert", wait_sql(f"select status from alerts where id='{alert_id}'", "cancelled") == "cancelled")
    hp.reload()
    hp.get_by_text("This alert has ended").wait_for(timeout=10000)
    check("tracking page shows ended, location hidden", hp.locator("#map").get_attribute("src") is None or hp.locator("#live").is_hidden())
    hp.screenshot(path=f"{SHOTS}/15-track-ended.png", full_page=True)
    page.get_by_text("Done", exact=True).click()
    page.get_by_text("Hi, Ananya").wait_for()

    # ---- Same person on a new device (no PINs here): the running alert is found and needs her password ----
    login = api("POST", "auth/login", {"email": email, "password": PASSWORD})
    ref2 = "e2e-newdevice-" + stamp
    a2 = api("POST", "alerts", {"client_ref": ref2, "trigger": "manual", "lat": 22.5181, "lng": 88.3531, "accuracy": 9}, login["token"])
    check("an SOS started on her phone", a2.get("created") is True, str(a2)[:200])
    retry = api("POST", "alerts", {"client_ref": ref2, "trigger": "manual"}, login["token"])
    check("a retried SOS request returns the same alert", retry.get("alert", {}).get("id") == a2["alert"]["id"] and retry.get("created") is False)
    ctx2 = browser.new_context(viewport=vp, device_scale_factor=2 if VP == "phone" else 1, is_mobile=VP == "phone", has_touch=VP == "phone",
                               geolocation={"latitude": 22.5180, "longitude": 88.3530, "accuracy": 8}, permissions=["geolocation"], locale="en-IN")
    p2 = ctx2.new_page()
    p2.on("pageerror", lambda e: errors.append("DEVICE2 " + str(e)))
    p2.goto(APP)
    p2.get_by_placeholder("you@example.com").wait_for(timeout=30000)
    p2.get_by_placeholder("you@example.com").fill(email)
    p2.get_by_placeholder("At least 8 characters").fill(PASSWORD)
    p2.get_by_role("button", name="Sign in").last.click()
    p2.get_by_text("Hi, Ananya").wait_for(timeout=15000)
    time.sleep(2)
    lg = p2.get_by_test_id("rail-logo" if VP == "desktop" else "logo").bounding_box()
    p2.mouse.move(lg["x"] + 10, lg["y"] + 10)
    p2.mouse.down(); time.sleep(1.3); p2.mouse.up()
    p2.get_by_text("Help is on the way").wait_for(timeout=10000)
    check("new device picks up her running alert", True)
    p2.get_by_text("I'm safe", exact=True).click()
    p2.get_by_text("Enter your password").wait_for(timeout=5000)
    check("no PINs on this device: cancelling asks for her password, not a PIN", p2.get_by_role("button", name="1", exact=True).count() == 0)
    p2.get_by_test_id("sos-password").fill("not my password")
    p2.get_by_text("Stop alert").click()
    p2.get_by_text("That password isn't right").wait_for(timeout=8000)
    check("wrong password keeps her signed in", p2.get_by_text("Enter your password").is_visible())
    check("wrong password keeps the alert running", sql(f"select status from alerts where id='{a2['alert']['id']}'") == "active")
    page.screenshot(path=f"{SHOTS}/15b-device1.png")
    p2.screenshot(path=f"{SHOTS}/15c-new-device-password.png")
    p2.get_by_test_id("sos-password").fill(PASSWORD)
    p2.get_by_text("Stop alert").click()
    try:
        p2.get_by_text("Alert cancelled").wait_for(timeout=10000)
    except Exception:
        dump(p2, "device2-cancel"); raise
    check("right password ends it from the new device", wait_sql(f"select status from alerts where id='{a2['alert']['id']}'", "cancelled") == "cancelled")
    ctx2.close()

    # ---- Pattern ----
    page.get_by_role("tab", name=re.compile("Pattern")).click()
    page.get_by_text("Keep a record that adds up").wait_for()
    page.get_by_placeholder("Unwanted contact from one person").fill("Unwanted contact from one person")
    page.get_by_text("Start a thread").click()
    page.get_by_text("Private thread · only you can see it").wait_for()
    entries = [("Message", "Yesterday", "Instagram", "@rk_xx", "Asked where I live"),
               ("I blocked them", "1 hour ago", "", "@rk_xx", ""),
               ("New account or number", "Just now", "WhatsApp", "+91 ••••• 4471", "saw you at the canteen today"),
               ("Seen in person", "Just now", "outside Commerce block", "", "Waiting after my 4 pm class")]
    for kind, when, ch, handle, note in entries:
        page.get_by_text("+ Add an entry").click()
        page.get_by_text("What happened?").wait_for()
        page.get_by_role("button", name=kind, exact=True).last.click()
        page.get_by_role("button", name=when, exact=True).last.click()
        if ch: page.get_by_placeholder("Instagram, WhatsApp, outside Commerce block").fill(ch)
        if handle: page.get_by_placeholder("@rk_xx or +91 ••••• 4471").fill(handle)
        if note: page.get_by_placeholder("What was said or done, in your words").fill(note)
        page.get_by_text("Save entry").last.click()
        page.get_by_text("Private thread · only you can see it").wait_for(timeout=10000)
        time.sleep(0.6)
    check("4 pattern entries saved", sql(f"select count(*) from entries where owner_id='{uid}'") == "4")
    page.get_by_text("Draft summary").click()
    page.get_by_text("COUNTED FROM YOUR ENTRIES").wait_for(timeout=15000)
    body = page.locator("text=/event\\(s\\) logged after you blocked/").count()
    check("summary drafted and shows contact after blocking", body >= 1)
    check("stat tile shows 2 events after blocking", page.get_by_text("after blocking").locator("xpath=..").inner_text().startswith("2"))
    time.sleep(0.5)
    shot("16-pattern")
    page.screenshot(path=f"{SHOTS}/17-pattern-full.png", full_page=True)

    # ---- Walk with me ----
    page.get_by_role("tab", name=re.compile("Walk")).click()
    page.get_by_placeholder("Kalighat Metro").fill("Kalighat Metro")
    page.get_by_text("2 min", exact=True).click()
    page.get_by_text("Start journey").click()
    page.get_by_text("Walking to Kalighat Metro").wait_for(timeout=10000)
    check("journey starts and is stored", sql(f"select interval_minutes||status from journeys where owner_id='{uid}'") == "2active")
    shot("18-walk-active")
    before = sql(f"select next_checkin_at from journeys where owner_id='{uid}' and status='active'")
    time.sleep(1.2)
    page.get_by_text("I'm okay", exact=True).click()
    time.sleep(1.5)
    after = sql(f"select next_checkin_at from journeys where owner_id='{uid}' and status='active'")
    check("'I'm okay' pushes the next check-in later", after > before, f"{before} -> {after}")
    page.get_by_text("I've arrived").click()
    page.get_by_text("Start journey").wait_for()
    check("arriving ends the journey", sql(f"select status from journeys where owner_id='{uid}' order by started_at desc limit 1") == "arrived")

    # ---- Vault ----
    page.get_by_role("tab", name=re.compile("Vault")).click()
    page.get_by_text("Evidence Vault").wait_for()
    page.get_by_text("Write down what happened").click()
    page.get_by_placeholder("What happened on 12 Oct").fill("What happened on 12 Oct")
    page.get_by_placeholder("Write it in your own words, whenever you're ready.").fill("He was waiting outside the Commerce block again after my 4 pm class.")
    page.get_by_text("Save to vault").click()
    page.get_by_text("What happened on 12 Oct", exact=True).wait_for(timeout=10000)
    sha_db = sql(f"select sha256 from vault_items where owner_id='{uid}' and kind='note'")
    import hashlib
    expect_sha = hashlib.sha256("He was waiting outside the Commerce block again after my 4 pm class.".encode()).hexdigest()
    check("vault note fingerprint matches its exact text (SHA-256)", sha_db == expect_sha, sha_db)
    stored = sql(f"select count(*) from vault_items where owner_id='{uid}' and complete=1")
    check("vault has her note and the SOS audio, both verified", stored == "2", stored)
    audio = sql(f"select source||'|'||(case when size_bytes>1000 then 'true' else 'false' end) from vault_items where owner_id='{uid}' and kind='audio'")
    check("audio recorded during SOS was saved to the vault", audio == "sos_recording|true", audio)
    shot("19-vault")

    # ---- Support ----
    page.get_by_role("tab", name=re.compile("Support")).click()
    page.get_by_text("Whatever happened, start anywhere").wait_for()
    page.get_by_text("It's ongoing").click()
    page.get_by_placeholder("অভিযোগ করতে কি থানায় যেতেই হবে?").fill("Do I have to file where it happened?")
    page.get_by_text("Ask", exact=True).click()
    page.get_by_text(re.compile("Zero FIR at any police station")).last.wait_for(timeout=15000)
    check("support guide answers", True)
    shot("20-support")

    # ---- Report an area ----
    page.get_by_role("tab", name=re.compile("Home")).click()
    page.get_by_text("Report an unsafe spot").click()
    page.get_by_text("Poor lighting", exact=True).click()
    page.get_by_placeholder("Gariahat crossing bus stop").fill("Rashbehari crossing")
    page.get_by_text("Send report").click()
    page.get_by_text("Hi, Ananya").wait_for(timeout=10000)
    check("area report saved at ~1 km precision", len(sql(f"select geohash6 from reports where reporter_id='{uid}'")) == 6)

    # ---- Quick exit calculator ----
    page.get_by_text("⇥ Quick exit").first.click()
    page.get_by_text("AC", exact=True).wait_for()
    for k in ["1", "2", "+", "3", "0", "="]:
        page.get_by_text(k, exact=True).last.click()
    time.sleep(0.3)
    check("calculator works: 12 + 30 = 42", page.get_by_text("42", exact=True).is_visible())
    check("browser tab title is disguised as 'Calculator'", page.title() == "Calculator", page.title())
    shot("21-calculator")
    ac = page.get_by_text("AC", exact=True).bounding_box()
    page.mouse.move(ac["x"] + 5, ac["y"] + 5)
    page.mouse.down(); time.sleep(1.2); page.mouse.up()
    page.get_by_text("Hi, Ananya").wait_for(timeout=5000)
    check("long-press AC returns to SAAHI", True)
    time.sleep(0.5)
    check("tab title restored after leaving the calculator", page.title() != "Calculator", page.title())

    # ---- Ghost call ----
    page.get_by_text("Ghost call", exact=True).click()
    page.get_by_text("Your call from Didi rings in").wait_for()
    page.get_by_text("mobile · incoming call").wait_for(timeout=9000)
    check("ghost call rings after 5 seconds", True)
    shot("22-ghost-call")
    page.get_by_role("button", name="Decline").click()

    # ---- Settings + data deletion ----
    page.get_by_role("button", name="Settings").click()
    page.get_by_text("Delete all my data").click()
    shot("23-settings")
    page.get_by_text("Delete everything").click()
    page.get_by_placeholder("you@example.com").wait_for(timeout=15000)
    left = sql(f"select (select count(*) from alerts where owner_id='{uid}')+(select count(*) from contacts where owner_id='{uid}')+(select count(*) from threads where owner_id='{uid}')+(select count(*) from vault_items where owner_id='{uid}')+(select count(*) from reports where reporter_id='{uid}')+(select count(*) from users where id='{uid}')")
    check("'Delete all my data' removes her account and records", left == "0", left)
    check("...and her vault file parts", sql("select count(*) from vault_chunks where item_id not in (select id from vault_items)") == "0")

    # Deep link straight to a section, like a bookmark or a refresh on GitHub Pages
    page.goto(APP + "/sign-in")
    page.get_by_placeholder("you@example.com").wait_for(timeout=15000)
    check("deep links load the app (refresh-safe)", True)
    # Sign back in with the recovery code flow? Account is deleted, so check the error instead.
    errors_before_expected_401 = len(errors)
    page.get_by_placeholder("you@example.com").fill(email)
    page.get_by_placeholder("At least 8 characters").fill(PASSWORD)
    page.get_by_role("button", name="Sign in").last.click()
    page.get_by_text("That email and password don't match.").wait_for(timeout=10000)
    check("deleted account can't sign in, with a clear message", True)
    del errors[errors_before_expected_401:]  # that 401 was the point of the check
    browser.close()

print("HTTP>=400:", bad_responses)
check("no element crosses the screen edge on any screen", not edge_fail, " || ".join(edge_fail[:4]))
real_errors = [e for e in errors if "realtime" not in e.lower() and "websocket" not in e.lower() and "501" not in e]
check("no unexpected browser errors", not real_errors, " | ".join(real_errors[:5]))
json.dump({"results": results, "errors": errors}, open(os.path.join(OUT, f"ui_results_{VP}.json"), "w"), indent=1)
fails = [r for r in results if r[0] == "FAIL"]
print(f"\n{len(results) - len(fails)} passed, {len(fails)} failed")
sys.exit(1 if fails else 0)
