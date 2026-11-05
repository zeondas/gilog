"""매뉴얼 v32 그림 – 0.78.0 화면으로 바뀐 곳만 다시 찍어요(번호·지시선·보라 테두리는 hwpx_pics.py 그대로).

  python3 tools/manual/hwpx_v32_pics.py <지킴이 빌드 폴더> <그림 폴더>

짝 json은 docs/manual/hangul/map/map_<키>.json(민원지도 map_map.json은 v32에서 새로).
"""
import asyncio
import os
import sys

sys.path.insert(0, os.path.dirname(__file__))
import hwpx_pics as hp  # noqa: E402
import cap  # noqa: E402
import json  # noqa: E402

MAPDIR = os.path.join(os.path.dirname(__file__), "..", "..", "docs", "manual", "hangul", "map")


def mp(key, **over):
    d = json.load(open(os.path.join(MAPDIR, f"map_{key}.json"), encoding="utf-8"))
    d.update(over)
    return d


async def main(site, out):
    from playwright.async_api import async_playwright
    hp.load_extra(MAPDIR)
    os.makedirs(out, exist_ok=True)
    o = lambda n: os.path.join(out, n + ".png")  # noqa: E731
    srv, port = cap.serve(site)
    url = f"http://127.0.0.1:{port}/"
    miss = []
    async with async_playwright() as pw:
        br = await pw.chromium.launch()
        # 민원지도 – 새 장
        m = mp("map")
        miss += await hp.screen_png(br, url, m, o("map_screen"))
        for lab, scene in [("가", "map_search"), ("나", "map_period"), ("라", "map_card"), ("마", "map"), ("아", "map"), ("자", "map")]:
            miss += await hp.crop_pngs(br, url, dict(m, crop_scene=scene), [lab], [o(f"map_{lab}")])
        miss += await hp.crop_pngs(br, url, dict(m, crop_scene="map_region", feats=[{"label": "다", "sel": ".mp-panel"}]), ["다"], [o("map_다")])
        miss += await hp.crop_pngs(br, url, dict(m, crop_scene="map_layers", feats=[{"label": "바", "sel": ".mp-layerpop"}]), ["바"], [o("map_바")])
        miss += await hp.crop_pngs(br, url, dict(m, crop_scene="map_measure", feats=[{"label": "사", "sel": ".mp-meas"}]), ["사"], [o("map_사")])
        # 민원대장 – 화면(처리 열)·아. 처리·자. 상태(고치는 줄)·바. 우클릭 메뉴
        c = mp("complaints")
        miss += await hp.screen_png(br, url, c, o("cm_screen"))
        miss += await hp.crop_pngs(br, url, c, ["아"], [o("cm_아")])
        miss += await hp.crop_pngs(br, url, dict(c, crop_scene="complaints_dbl", feats=[{"label": "자", "sel": ".cm-row.cm-edit button.cm-status"}]), ["자"], [o("cm_자")])
        miss += await hp.fig_png(br, url, {"head": "바. 신규 행", "scene": "complaints_rowmenu", "sel": ".dmenu"}, o("cm_menu"))
        # 캘린더 – 화면(구글 상자)·나. 미니달력·다. 구글 상자·바. 보기 단추
        k = mp("calendar")
        miss += await hp.screen_png(br, url, k, o("cal_screen"))
        miss += await hp.crop_pngs(br, url, k, ["나", "다", "바"], [o("cal_나"), o("cal_다"), o("cal_바")])
        # 설정 – 화면(모듈 카드에 민원지도)·라. 모듈·민원지도 카드·캘린더 카드(연동 방향)
        s = mp("settings")
        miss += await hp.screen_png(br, url, s, o("set_screen"))
        miss += await hp.crop_pngs(br, url, s, ["라"], [o("set_라")])
        miss += await hp.crop_pngs(br, url, s, ['@section.mod-card:has(.mod-head:text-is("민원지도"))'], [o("set_map")])
        miss += await hp.crop_pngs(br, url, dict(s, crop_scene="settings_google"), ['@section.mod-card:has(.mod-head:text-is("캘린더"))'], [o("set_cal")])
        # 개요 – 처음 화면(사이드바에 민원지도)
        ctx, p = await cap.open_scene(br, url, "screen_07")
        await p.screenshot(path=o("ov_start"))
        await ctx.close()
        await br.close()
    srv.shutdown()
    print("못 잰 것:", miss or "없음")


if __name__ == "__main__":
    asyncio.run(main(*sys.argv[1:3]))
