# RateMyGaucho

A Chrome extension that adds course info to UCSB GOLD. Next to each class you see its grade distribution, enrollment history, the professor, and a recent student review, so you don't have to look it up in another tab.

It also adds a search bar where you can type things like "easy CMPSC classes on MWF mornings".

<!-- screenshot / demo -->

## Install

1. Download the latest zip from [Releases](https://github.com/ajitsxro/RateMyGaucho/releases) and unzip it.
2. Go to `chrome://extensions` and turn on Developer mode.
3. Click **Load unpacked** and pick the unzipped folder.
4. Open GOLD. Cards show up on your schedule and in course search results.

## How it works

All the data ships with the extension in `courses_final_enrollment.csv` (one row per course and professor, pulled from UCSB Plat). Nothing is sent anywhere.

When a GOLD page loads, the extension finds the instructor column, works out which course each row belongs to, looks that course up in the CSV, and inserts a card under the course header.

| File | What it does |
|---|---|
| `content/csv.js` | Loads and parses the CSV |
| `content/match.js` | Matches GOLD instructor names (`GARCIA J`, `Porter, Matt`) to the data |
| `content/dom.js` | Finds instructor cells and course codes on the page |
| `content/render.js` | Builds the card |
| `content/search.js` | The search bar |
| `content/content.js` | Starts everything |

To update the data, replace the CSV and rebuild.

## Development

```bash
node --test                 # run the tests
bash scripts/package.sh     # build dist/RateMyGaucho.zip
```

## License

MIT
