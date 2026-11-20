#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
mkdir -p dist
rm -f dist/RateMyGaucho.zip
zip -r dist/RateMyGaucho.zip manifest.json content gaucho.png courses_final_enrollment.csv LICENSE
echo "Wrote dist/RateMyGaucho.zip"
