# tools/map – 민원 지도 자료 (2026-11-02 민원 지도 세션)

앱 밖에서 받은 지도 원본과, 그것으로 앱 자료(`data/map/`)를 만드는 도구예요. 원본은 이 폴더 `source/`에 압축해 두어 집·회사 어디서든 저장소만 받으면 다시 만들 수 있어요. 밖으로 아무것도 보내지 않고 키도 없어요(공통 결정 로그 11-02 16:11).

## source/ – 원본(앱에는 안 들어감)
| 파일 | 무엇 | 출처 | 크기 |
| --- | --- | --- | --- |
| `paju_parcels_v20261008.csv.gz` | 파주시 연속지적 324,622필지 – `pnu,bjd,addr,jibun,x5181,y5181,xmin,ymin,xmax,ymax` | 브이월드 공간정보 다운로드 "연속지적도형정보" 경기도(`AL_D002_41_20261008.zip`, EPSG:5186 → 북쪽 −100,000으로 5181) → `extract.py` | 8.1MB |
| `paju_roadparcels_2m.bin.gz` | 그중 지목 '도' 48,848필지 테두리(2m 간추림) | 같은 zip → `roads.py` | 1.0MB |
| `kras_paju_road_20261102.dxf.gz` | KRAS 연속주제도 – 읍면동 경계 35·도로구역 700·도시계획도로(교통시설) 2,604 | 사용자가 KRAS에서 받은 `Drawing1.dxf`(**EPSG:5174 옛 Bessel 중부원점** – 5181로 읽으면 300m 비껴요, `docs/qa/map.md` §7-24) | 3.2MB |

## 앱 자료 만들기
```
pip install pyproj shapely --break-system-packages   # 처음 한 번
python3 tools/map/build.py
```
→ `data/map/paju_parcels.bin.gz`(지번 → 좌표, core가 읽음, 2.1MB) · `data/map/paju_layers.bin.gz`(배경 네 층, 화면이 읽음, 1.3MB). 둘 다 빌드 때 앱에 들어가요. 같은 원본이면 같은 파일이 나와요.

## 갱신(1~2년에 한 번)
1. 브이월드 → 공간정보 다운로드 → "연속지적도형정보" 경기도 zip을 사용자 컴퓨터 작업 폴더(`C:\Users\paju\다운로드\지도모듈`)에 받아요.
2. 그 폴더에서 `python extract.py AL_D002_41_<날짜>.zip` → `gzip -9 work/paju_parcels.csv` → `source/paju_parcels_v<날짜>.csv.gz`로 올려요(옛 파일은 지워요 – 가장 새 이름을 써요).
3. `python roads.py AL_D002_41_<날짜>.zip` → `source/paju_roadparcels_2m.bin.gz`.
4. KRAS 층이 바뀌면 DXF를 gzip해 `source/kras_paju_road_<날짜>.dxf.gz`로.
5. `python3 tools/map/build.py` → `cargo test --manifest-path src-tauri/core/Cargo.toml map` 로 보기 지번(봉일천리 113 등)이 그대로 찾아지는지 봐요.

## 파일 모양(작은 끝 정수)
- `paju_parcels.bin.gz`: `PJP1` · `u16 이름 수` · 이름마다 `u8 길이 + 리·동 이름, u8 길이 + 읍면 이름(동은 빈칸), u32 법정동코드−4148000000` · `u32 필지 수` · 필지마다 `u32 코드, u8 산(1), u16 본번, u16 부번, i32 x, i32 y`(5181 m, 코드·산·본번·부번 순 정렬).
- `paju_layers.bin.gz`: `PJL1` · `u8 층 수` · 층마다 `u8 층(1 지목 도·2 도시계획도로·3 도로구역·4 읍면동 경계), u32 모양 수` · 모양마다 `u8 길이 + 이름(경계만: 법정 읍면·법정동)`, `u16 고리 수`, 고리마다 `u32 점 수, i32 x0, i32 y0, (i16 dx, i16 dy)…`.
- 경계 이름은 그 안 필지의 리·동으로 정해요. 행정동(운정1~6·금촌1~3·교하동)의 경계는 원본에 없어 화면이 `paju.ts` 표의 법정동을 모아 대신 그려요.
