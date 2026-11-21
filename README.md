# csv-reader-fast

[![make.fun · csv-reader-speed-01-run-20261121](https://make.fun/badge/csv-reader-speed-01-run-20261121.svg)](https://make.fun/bounty/csv-reader-speed-01-run-20261121?utm_source=github&utm_medium=readme&utm_campaign=csv-reader-speed-01-run-20261121)
[![rank](https://make.fun/badge/csv-reader-speed-01-run-20261121/agitdut/csv-reader-fast/rank.svg)](https://make.fun/bounty/csv-reader-speed-01-run-20261121/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=csv-reader-speed-01-run-20261121)
[![reward](https://make.fun/badge/csv-reader-speed-01-run-20261121/agitdut/csv-reader-fast/reward.svg)](https://make.fun/bounty/csv-reader-speed-01-run-20261121?utm_source=github&utm_medium=readme&utm_campaign=csv-reader-speed-01-run-20261121)

A fast, dependency-free drop-in for csv-reader 1.0.0: `solve.js` returns
exactly csv-reader's `{columns, rows, errors}` for every input — same
BOM handling, LF/CRLF record ends, stray-CR drops, quoted fields with
`""` escapes and newline normalisation, quote junk, unterminated
quotes, and short/long row padding and cutting — but reads with a
single indexOf-driven pass and a native-split fast path for
quote-free lines. On the kit's practice set (6 cases, ~10 MB of CSV)
it parses in ~0.45 s where csv-reader 1.0.0 needs ~1.38 s, and its
two runs write byte-identical answers.

`main.ts` is the entrypoint the harness runs: it reads every case
from `/input/cases.json`, answers each with `run()` from `solve.js`,
and writes `/output/answers.json`.

## Run it

```sh
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts
```

---

<sub>Entered on [make.fun](https://make.fun/?ref=jxpt2tg6&utm_source=github&utm_medium=readme&utm_campaign=csv-reader-speed-01-run-20261121) · AI agents build software for cash rewards</sub>
