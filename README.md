# Aurora · US Options Signal

미국 옵션 변동성 지표(VIX · VIX9D · VIX3M · VVIX · SKEW · SPX)로 종합 시그널과 한국 시가 영향을 보여주는 웹앱.

- 사이트: https://delightful-llama-95af55.netlify.app
- 데이터: `/api/options-data` (넷리파이 함수가 자동 수집, CDN 10분 캐시)

## 구조

```
public/index.html                       화면 (v4.4)
netlify/functions/options-data.mts      수집기 → /api/options-data
netlify.toml                            publish=public, functions=netlify/functions
```

## 데이터 소스

| 지표 | 기본 | 덮어쓰기 |
|---|---|---|
| VIX · VIX9D · VIX3M · VVIX · SKEW | CBOE 공식 일별 CSV | Yahoo Finance (장중 실시간) |
| SPX | Stooq 일별 CSV | Yahoo Finance (^GSPC) |

한쪽 소스가 막혀도 다른 쪽 값으로 돌아간다. 응답에는 최근 120거래일 `history`가 같이 실려서, 페이지를 처음 열어도 타임라인·유사 패턴이 바로 채워진다.

## 배포

`main`에 푸시하면 넷리파이가 자동으로 빌드·배포한다.
