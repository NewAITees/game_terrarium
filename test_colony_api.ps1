# Colony API smoke test
# Run after restarting the server and opening colony page (Ctrl+9)

$BASE = "http://localhost:3000"

Write-Host "`n=== 1. Colony state (should show faction data after ~5s) ===" -ForegroundColor Cyan
$state = Invoke-RestMethod "$BASE/colony/state" -ErrorAction SilentlyContinue
if ($state) {
    Write-Host "Tick:     $($state.data.tick)"
    Write-Host "Elapsed:  $($state.data.elapsed)s"
    Write-Host "Dominant: $($state.data.dominantFaction)"
    foreach ($f in $state.data.factions) {
        $status = if ($f.alive) { "alive" } else { "DEAD" }
        Write-Host "  [$($f.name)/$($f.personality)] territory=$($f.territory) food=$($f.food) [$status]"
        Write-Host "    intent: $($f.intent)"
    }
} else {
    Write-Host "null — colony page not open or server not restarted yet" -ForegroundColor Yellow
}

Write-Host "`n=== 2. Queue intervention: storm ===" -ForegroundColor Cyan
$r = Invoke-RestMethod "$BASE/colony/intervention" -Method POST `
    -ContentType "application/json" `
    -Body '{"type":"storm"}'
Write-Host "Queued: $($r.queued)"

Write-Host "`n=== 3. Check pending queue (should be empty if colony polled) ===" -ForegroundColor Cyan
Start-Sleep 3
$pending = Invoke-RestMethod "$BASE/colony/intervention/pending"
Write-Host "Pending items: $($pending.Count) (0 = colony consumed it)"

Write-Host "`n=== 4. Queue resource_drop + invader_wave ===" -ForegroundColor Cyan
Invoke-RestMethod "$BASE/colony/intervention" -Method POST -ContentType "application/json" -Body '{"type":"resource_drop"}' | Out-Null
Invoke-RestMethod "$BASE/colony/intervention" -Method POST -ContentType "application/json" -Body '{"type":"invader_wave"}' | Out-Null
$pending2 = Invoke-RestMethod "$BASE/colony/intervention/pending"
Write-Host "Queued 2, immediately fetched: $($pending2.Count) items"
foreach ($p in $pending2) { Write-Host "  $($p.type) at $($p.queuedAt)" }

Write-Host "`n=== 5. Invalid intervention (should 400) ===" -ForegroundColor Cyan
try {
    Invoke-RestMethod "$BASE/colony/intervention" -Method POST -ContentType "application/json" -Body '{"type":"nuke"}'
} catch {
    Write-Host "Correctly rejected: $($_.ErrorDetails.Message)"
}

Write-Host "`n=== Done ===" -ForegroundColor Green
