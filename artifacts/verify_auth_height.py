import json
from pathlib import Path
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parent

with sync_playwright() as playwright:
    browser = playwright.chromium.launch(headless=True)
    results = {}

    for name, viewport in {
        "desktop": {"width": 1366, "height": 768},
        "mobile": {"width": 390, "height": 844},
    }.items():
        page = browser.new_page(viewport=viewport)
        page.route(
            "**/api/auth/me",
            lambda route: route.fulfill(
                status=401,
                content_type="application/json",
                body='{"code":"UNAUTHORIZED","message":"Non connecté"}',
            ),
        )
        page.goto("http://127.0.0.1:5173", wait_until="networkidle")
        metrics = page.evaluate(
            """() => ({
              innerHeight: window.innerHeight,
              scrollHeight: document.documentElement.scrollHeight,
              clientHeight: document.documentElement.clientHeight,
              horizontalOverflow: document.documentElement.scrollWidth > window.innerWidth,
              sceneItems: document.querySelectorAll('[data-table-scene-item]').length,
            })"""
        )
        page.screenshot(path=str(ROOT / f"auth-{name}.png"), full_page=True)
        results[name] = metrics
        page.close()

    browser.close()
    print(json.dumps(results, ensure_ascii=False))
