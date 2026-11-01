from pathlib import Path
import re


css = Path("assets/layout.css").read_text(encoding="utf-8")
js = Path("renderer/index.js").read_text(encoding="utf-8")
rule = re.search(
    r'body\[data-liuli-scope="main"\]\[data-liuli-r-nav\] .global-container .container-content > .container-sidebar,\s*body\[data-liuli-scope="main"\] .global-container .container-content > .container-sidebar[^{}]*\{[^}]*transform:\s*translateX\(0\)',
    css,
)
assert rule, "expanded sidebar rule not found"
assert ":hover" in rule.group(0), "sidebar did not expand on pointer hover"
assert "data-liuli-r-nav" in rule.group(0), "nav-open state did not keep sidebar expanded"
assert ":focus-within" not in rule.group(0), (
    "sidebar remains expanded when focus stays inside after pointer leaves"
)

# Page switching replaces the sidebar's Vue children while the pointer can
# remain in the sidebar rectangle. The tracker must re-check that rectangle
# and eventually clear the open state after the pointer moves away.
tracker = re.search(r"function installRevealTracker\(\)\s*\{(?P<body>[\s\S]*?)\n\}", js)
assert tracker, "sidebar pointer tracker not found"
body = tracker.group("body")
assert 'over(".container-sidebar", x, y)' in body, (
    "sidebar hover state is not checked after pointer movement"
)
assert "function leaveAll()" in body and 'set("nav", false)' in body, (
    "sidebar open state is not cleared after leaving the window"
)
assert re.search(r"var EDGE\s*=\s*8,\s*HOLD\s*=\s*250", body), (
    "sidebar close delay after leaving is missing"
)
