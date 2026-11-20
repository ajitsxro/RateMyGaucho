New-Item -ItemType Directory -Force -Path "$PSScriptRoot/../dist" | Out-Null
Remove-Item -ErrorAction SilentlyContinue "$PSScriptRoot/../dist/RateMyGaucho.zip"
Push-Location "$PSScriptRoot/.."
try {
  & zip -r "dist/RateMyGaucho.zip" manifest.json content gaucho.png courses_final_enrollment.csv LICENSE
} finally {
  Pop-Location
}
Write-Host "Wrote dist/RateMyGaucho.zip"
