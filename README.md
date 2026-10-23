# Aurora · US Options Signal

미국 옵션 변동성 지표(VIX · VIX9D · VIX3M · VVIX · SKEW · SPX · SOX)로 종합 시그널을 매기고, 그 시그널이 과거에 실제로 어땠는지와 다음 날 한국 시가 영향을 보여주는 웹앱.

- 사이트: https://delightful-llama-95af55.netlify.app

## 구조

```
public/index.html                       화면 (v5.0)
public/stats-fallback.json              성적표 예비본 (서버 수집이 막힐 때 사용)
netlify/functions/options-data.mts      실시간 지표 → /api/options-data  (CDN 10분 캐시)
netlify/functions/stats.mts             15년 성적표 + 한국 모델 → /api/stats (CDN 12시간 캐시)
scripts/build_fallback.mjs              stats-fallback.json 다시 만들기
scripts/fetch_history.mjs               분석용 원자료 내려받기
```

## 성적표 (/api/stats)

2011-01-04부터 매일 앱과 **똑같은 채점**(VIX 수준·변화율, VIX9D/VIX, VIX/VIX3M, VVIX, SKEW 각 -2~+2)으로 시그널을 매긴다. 그 뒤 실제 결과를 센다.

- S&P500 1·5·10·20거래일 뒤 수익률 / 오른 확률
- 코스피 다음 세션 시가 갭 · 종가 수익률 · 고저폭, 5·20세션 뒤 수익률
- 꼬리 리스크 히트맵 4구간(VVIX 95 · SKEW 135 기준)별 같은 집계
- 사건 수: 15거래일 넘게 쉬었다 다시 뜨면 새 사건으로 센다

## 한국 영향 모델

최근 250 한국 세션으로 매번 다시 맞춘다.

- 코스피 시가 갭 = α + β × S&P500 전일 등락
- 삼성전자 · SK하이닉스 시가 갭 = α + β × SOX 전일 등락 (SOX가 없으면 S&P500)
- 예상 고저폭 = 최근 1년 같은 VIX 구간의 평균
- 화면에는 ±1σ(회귀 잔차) 범위를 같이 표시

## 데이터 소스

| 지표 | 기본 | 덮어쓰기 |
|---|---|---|
| VIX · VIX9D · VIX3M · VVIX · SKEW | CBOE 공식 일별 CSV | Yahoo Finance (장중 실시간) |
| SPX | Stooq 일별 CSV | Yahoo Finance (^GSPC) |
| SOX · KOSPI · 삼성전자 · SK하이닉스 | Yahoo Finance | — |

## 배포

`main`에 푸시하면 넷리파이가 자동으로 빌드·배포한다.
