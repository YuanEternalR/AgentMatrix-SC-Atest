# 故障注入演练：自动重试 / 死信 / 人工重试
#
# 场景 A：订单号含 FLAKY —— 前两次通知失败，第三次自动重试成功
# 场景 B：订单号含 DEAD  —— 三次尝试全部失败 -> 进入死信 -> 人工重试 -> 成功
#
# 用法：powershell -NoProfile -ExecutionPolicy Bypass -File scripts\fault-test.ps1

param(
    [string]$Base = 'http://127.0.0.1:8000/api/v1',
    [string]$Email = 'ops@agentmatrix.local',
    [string]$Password = 'AgentMatrix@2026',
    [int]$TimeoutSec = 60
)

$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)

function Assert-True($condition, [string]$message) {
    if (-not $condition) { throw "断言失败：$message" }
    Write-Host "  [OK] $message" -ForegroundColor Green
}
function Step([string]$text) { Write-Host "`n==> $text" -ForegroundColor Cyan }

$login = Invoke-RestMethod -Uri "$Base/auth/login" -Method Post `
    -Body @{ username = $Email; password = $Password } `
    -ContentType 'application/x-www-form-urlencoded'
$h = @{ Authorization = "Bearer $($login.access_token)" }

function New-Task([string]$orderId) {
    $body = @{
        title          = "故障演练 $orderId"
        workflow_code  = 'order_delay_exception'
        priority       = 1
        complexity_hint = 4
        payload        = @{ order_id = $orderId; quantity = 100 }
    } | ConvertTo-Json -Depth 5
    $bytes = [System.Text.Encoding]::UTF8.GetBytes($body)
    Invoke-RestMethod -Uri "$Base/tasks" -Method Post -Body $bytes `
        -ContentType 'application/json; charset=utf-8' -Headers $h
}

function Approve-Pending([string]$runId) {
    $apps = Invoke-RestMethod -Uri "$Base/approvals" -Headers $h
    $mine = @($apps | Where-Object { $_.run_id -eq $runId -and $_.status -eq 'pending' })
    if ($mine.Count -gt 0) {
        $text = @{ decision = 'approved'; comment = '故障演练自动批准' } | ConvertTo-Json
        Invoke-RestMethod -Uri "$Base/approvals/$($mine[0].id)/decision" -Method Post `
            -Body $text -ContentType 'application/json' -Headers $h | Out-Null
    }
}

function Get-DeadLetters {
    # 注意：Invoke-RestMethod 对空数组返回 $null，直接 @() 会得到含一个 $null 的数组
    $res = Invoke-RestMethod -Uri "$Base/dead-letters" -Headers $h
    if ($null -eq $res) { return @() }
    return @($res)
}

function Wait-Run([string]$runId, [string[]]$wanted, [int]$seconds) {
    $deadline = (Get-Date).AddSeconds($seconds)
    while ((Get-Date) -lt $deadline) {
        Approve-Pending $runId
        $run = Invoke-RestMethod -Uri "$Base/runs/$runId" -Headers $h
        if ($wanted -contains $run.status) { return $run }
        Start-Sleep -Milliseconds 700
    }
    throw "等待超时（期望 $($wanted -join '/')）"
}

# --- 场景 A ---------------------------------------------------------------
Step 'A. FLAKY：自动重试后恢复'
$flaky = New-Task "SO-FLAKY-$(Get-Date -Format 'HHmmss')"
$runA = Wait-Run $flaky.run_id @('succeeded', 'failed') $TimeoutSec

$notifySteps = @($runA.steps | Where-Object { $_.node_id -eq 'notify' })
Assert-True ($runA.status -eq 'succeeded') "最终成功（状态 $($runA.status)）"
Assert-True ($notifySteps.Count -ge 3) "notify 执行了 $($notifySteps.Count) 次（含重试）"
Assert-True (($notifySteps | Where-Object { $_.status -eq 'retrying' }).Count -ge 2) '存在 retrying 步骤记录'
Assert-True ($notifySteps[-1].status -eq 'succeeded') '最后一次尝试成功'

$deadAfterA = @(Get-DeadLetters | Where-Object { $_.run_id -eq $runA.id })
Assert-True ($deadAfterA.Count -eq 0) '自动重试成功时未产生死信'

# --- 场景 B ---------------------------------------------------------------
Step 'B. DEAD：重试耗尽进入死信'
$dead = New-Task "SO-DEAD-$(Get-Date -Format 'HHmmss')"
$runB = Wait-Run $dead.run_id @('failed', 'succeeded') $TimeoutSec

Assert-True ($runB.status -eq 'failed') "运行失败（$($runB.error_code)）"

$letters = @(Get-DeadLetters | Where-Object { $_.run_id -eq $runB.id })
Assert-True ($letters.Count -eq 1) "本次运行产生 1 条死信（实际 $($letters.Count)）"
$letter = $letters[0]
Assert-True ($letter.error_code -eq 'TRANSIENT') "错误分类正确：$($letter.error_code)"
Assert-True ($letter.attempts -eq 3) "重试次数达到上限（$($letter.attempts)）"

Step 'C. 人工重试死信'
$retry = Invoke-RestMethod -Uri "$Base/dead-letters/$($letter.id)/retry" -Method Post -Headers $h
Assert-True ($retry.status -eq 'retried') '死信标记为已重试'

$runC = Wait-Run $runB.id @('succeeded', 'failed') $TimeoutSec
Assert-True ($runC.status -eq 'succeeded') "人工重试后成功（第 4 次尝试）"

$notifyAll = @($runC.steps | Where-Object { $_.node_id -eq 'notify' })
Assert-True ($notifyAll.Count -eq 4) "notify 累计执行 $($notifyAll.Count) 次"

Write-Host "`n故障演练全部通过：自动重试、死信落库、人工重试恢复。" -ForegroundColor Green
