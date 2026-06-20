"""
Code-derived connectivity map for SWFL Data Gulf (READ-ONLY analysis; touches no app code).
Enumerates every App-Router route, greps every internal-link source across app/components/lib,
and classifies each route: reachable from persistent CHROME (nav/footer/rail/pill/layout),
reachable only from a PAGE body link, or ORPHAN (no inbound link at all). This is the
repeatable diagnosis: run it any time to see what's connected and what's stranded.
"""
import os, re, json, glob

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
APP = os.path.join(ROOT, "app")

# Chrome = persistent navigation surfaces. An inbound link from any of these means
# the route is reachable by clicking from "anywhere" (not just one buried page body).
CHROME_FILES = {
    # B1 (2026-06-20): the old split (GlobalNav + landing Header/Footer) is now the
    # one unified SiteShell + SiteFooter.
    "components/nav/SiteShell.tsx",
    "components/nav/SiteFooter.tsx",
    "app/layout.tsx",
    "app/project/layout.tsx",
    "app/project/ProjectsRail.tsx",
    "components/briefcase/AppShell.tsx",
    "components/briefcase/AiBriefcasePill.tsx",
    "components/briefcase/BriefcasePanel.tsx",
}

def file_to_route(p):
    rel = os.path.relpath(p, APP).replace("\\", "/")
    rel = rel[: -len("/page.tsx")] if rel.endswith("/page.tsx") else rel
    rel = rel[: -len("page.tsx")] if rel.endswith("page.tsx") else rel
    parts = [seg for seg in rel.split("/") if seg and not (seg.startswith("(") and seg.endswith(")"))]
    return "/" + "/".join(parts) if parts else "/"

def link_prefix(route):
    """The literal prefix we expect in an href/push for this route (up to first dynamic seg)."""
    out = []
    for seg in route.strip("/").split("/"):
        if seg.startswith("["):
            break
        out.append(seg)
    return "/" + "/".join(out) if out else "/"

# 1) all routes
routes = sorted({file_to_route(p) for p in glob.glob(os.path.join(APP, "**", "page.tsx"), recursive=True)})

# 2) gather every source file + its text
SRC = []
for base in ("app", "components", "lib"):
    for p in glob.glob(os.path.join(ROOT, base, "**", "*.ts*"), recursive=True):
        rel = os.path.relpath(p, ROOT).replace("\\", "/")
        try:
            SRC.append((rel, open(p, encoding="utf-8", errors="ignore").read()))
        except Exception:
            pass

# 3) for each route, find inbound references (exclude the route's own page/_components dir)
def own_dir(route):
    # the app subdir that owns this route, e.g. /r/zip-report/[zip] -> app/r/zip-report
    segs = [s for s in route.strip("/").split("/") if not s.startswith("[")]
    return "app/" + "/".join(segs) if segs else "app"

# href/push/redirect/assign patterns capturing a path-ish string or template
LINK_RE = re.compile(r"""(?:href|to)\s*[:=]\s*[`"']([^`"'#?]+)|router\.(?:push|replace)\(\s*[`"']([^`"'#?]+)|redirect\(\s*[`"']([^`"'#?]+)|location\.(?:assign|href\s*=)\s*\(?\s*[`"']([^`"'#?]+)""", re.X)

results = {}
for route in routes:
    pref = link_prefix(route)
    odir = own_dir(route)
    chrome_hits, body_hits = [], []
    for rel, text in SRC:
        # skip the route's own page implementation when judging "inbound from elsewhere"
        if rel.startswith(odir + "/") or rel == odir + "/page.tsx":
            continue
        found = False
        for m in LINK_RE.finditer(text):
            cand = next((g for g in m.groups() if g), "")
            cand = cand.rstrip("/") or "/"
            target = pref
            if route == "/":
                ok = cand == "/" or cand == ""
            elif "[" in route:
                ok = cand == target or cand.startswith(target + "/")
            else:
                ok = cand == route or cand == route + "/"
            if ok:
                found = True
                break
        # also catch template-literal pushes like `/p/${id}` and arrival-builders
        if not found and "[" in route and pref != "/":
            if re.search(re.escape(pref) + r"/\$\{", text) or re.search(re.escape(pref) + r"/`", text):
                found = True
        if found:
            (chrome_hits if rel in CHROME_FILES else body_hits).append(rel)
    if chrome_hits:
        status = "IN-CHROME"
    elif body_hits:
        status = "body-link-only"
    else:
        status = "ORPHAN"
    results[route] = {"status": status, "chrome": sorted(set(chrome_hits)), "body": sorted(set(body_hits))[:6]}

# 4) report
orphans = [r for r, v in results.items() if v["status"] == "ORPHAN"]
bodyonly = [r for r, v in results.items() if v["status"] == "body-link-only"]
inchrome = [r for r, v in results.items() if v["status"] == "IN-CHROME"]
print(f"ROUTES: {len(routes)} | in-chrome: {len(inchrome)} | body-link-only: {len(bodyonly)} | ORPHANS: {len(orphans)}\n")
for r in routes:
    v = results[r]
    src = ",".join(v["chrome"]) if v["chrome"] else (",".join(v["body"]) if v["body"] else "-")
    print(f"  {v['status']:16s} {r:34s} <- {src}")
json.dump(results, open(os.path.join(ROOT, "runs", "connectivity-map.json"), "w", encoding="utf-8"), indent=2)
print("\nORPHANS:", orphans)
print("BODY-ONLY:", bodyonly)
print("\nWROTE runs/connectivity-map.json")
