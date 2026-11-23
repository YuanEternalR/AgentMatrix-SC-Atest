# 技能 / 智能体管理检查：验收第 4、5 条。
#
# 对照《供应链智能体矩阵-DSH构建提示词.md》：
#   4. 创建一个 HTTP Mock 技能并试运行成功
#   5. 创建智能体、绑定技能、在线测试显示工具调用轨迹、发布版本
#
# 另外验：RBAC（只读不能建）、引用保护（被引用的技能删不掉）、
# 版本不可变（发布新版本后旧版本归档、运行锁定新版本）、故障注入的错误分类。
#
# 用法：powershell -NoProfile -ExecutionPolicy Bypass -File scripts\check-skills-agents.ps1

$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)

$Base = 'http://127.0.0.1:8000/api/v1'
$Password = 'AgentMatrix@2026'
$passed = 0
$failed = 0
$suffix = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()
$skillCode = "probe_quote_$suffix"
$agentCode = "probe_agent_$suffix"

function Assert-True([bool]$cond, [string]$msg) {
    if ($cond) { Write-Host "  [OK] $msg" -ForegroundColor Green; $script:passed++ }
    else { Write-Host "  [FAIL] $msg" -ForegroundColor Red; $script:failed++ }
}

function Login([string]$user) {
    $body = @{ username = "$user@agentmatrix.local"; password = $Password }
    $resp = Invoke-RestMethod -Uri "$Base/auth/login" -Method Post -Body $body `
        -ContentType 'application/x-www-form-urlencoded'
    return @{ Authorization = "Bearer $($resp.access_token)" }
}

function Post([string]$path, $obj, [hashtable]$h) {
    $bytes = [System.Text.Encoding]::UTF8.GetBytes(($obj | ConvertTo-Json -Depth 8))
    return Invoke-RestMethod -Uri "$Base$path" -Method Post -Headers $h -Body $bytes `
        -ContentType 'application/json; charset=utf-8'
}

function Status([string]$path, [hashtable]$h, [string]$method = 'GET', $obj = $null) {
    try {
        $args = @{ Uri = "$Base$path"; Method = $method; Headers = $h; UseBasicParsing = $true }
        if ($null -ne $obj) {
            $args.Body = [System.Text.Encoding]::UTF8.GetBytes(($obj | ConvertTo-Json -Depth 8))
            $args.ContentType = 'application/json; charset=utf-8'
        }
        return (Invoke-WebRequest @args).StatusCode
    } catch {
        $code = $_.Exception.Response.StatusCode.value__
        if ($code) { return $code }
        throw
    }
}

$dev = Login 'dev'
$viewer = Login 'viewer'

Write-Host '==> 验收第 4 条：创建 HTTP Mock 技能并试运行' -ForegroundColor Cyan
$skill = Post '/skills' @{
    code = $skillCode
    name = '报价查询（自检）'
    category = 'external'
    type = 'http'
    description = '自检用：默认 Mock，不联网'
    input_schema = @{
        carrier = @{ type = 'string'; required = $true; label = '承运商' }
        weight_kg = @{ type = 'number'; label = '重量' }
    }
    output_schema = @{ quote = @{ type = 'number' } }
    config = @{
        method = 'GET'
        url = 'https://api.example.com/quote?carrier={{carrier}}'
        mock = $true
        mock_delay_ms = 60
        mock_response = '{"quote": 128.5, "carrier": "{{carrier}}", "source": "mock"}'
    }
} $dev
Assert-True ($skill.type -eq 'http') "建成 HTTP 类型技能（$($skill.type_label)）"
Assert-True ($skill.mock -eq $true) '默认走 Mock（不联网）'
Assert-True ($skill.version -eq 1) "初始版本 v$($skill.version)"

$run = Post "/skills/$skillCode/test" @{ inputs = @{ carrier = 'Standard Class'; weight_kg = 12 } } $dev
Assert-True ($run.ok -eq $true) '试运行成功'
Assert-True ($run.mode -eq 'http-mock') "执行模式为 Mock（$($run.mode)）"
Assert-True ($run.duration_ms -gt 0) "有真实耗时（$($run.duration_ms) ms）"
Assert-True ($run.output.quote -eq 128.5) "Mock 响应按模板返回（quote=$($run.output.quote)）"
Assert-True ($run.output.carrier -eq 'Standard Class') '占位符 {{carrier}} 已替换'

$list = Invoke-RestMethod -Uri "$Base/skills" -Headers $dev
$mine = $list | Where-Object { $_.code -eq $skillCode } | Select-Object -First 1
Assert-True ($mine.runs -ge 1) "执行记录已入库（runs=$($mine.runs)）"
Assert-True ($mine.avg_ms -gt 0) "平均耗时来自真实执行（$($mine.avg_ms) ms）"
Assert-True ($mine.success_rate -eq 1) "成功率来自真实执行（$($mine.success_rate)）"

Write-Host '==> 故障注入：错误分类正确' -ForegroundColor Cyan
$null = Post "/skills/$skillCode/versions" @{
    config = @{
        method = 'GET'
        url = 'https://api.example.com/quote?carrier={{carrier}}'
        mock = $true
        mock_delay_ms = 10
        mock_response = '{"quote": 128.5}'
        fault = 'transient'
    }
    changelog = '自检：打开故障注入'
} $dev
$bad = Post "/skills/$skillCode/test" @{ inputs = @{ carrier = 'X' } } $dev
Assert-True ($bad.ok -eq $false) '故障注入下试运行失败（不再假成功）'
Assert-True ($bad.error_code -eq 'TRANSIENT') "错误分类为可重试（$($bad.error_code)）"

$null = Post "/skills/$skillCode/versions" @{
    config = @{
        method = 'GET'
        url = 'https://api.example.com/quote?carrier={{carrier}}'
        mock = $true
        mock_delay_ms = 40
        mock_response = '{"quote": 128.5, "carrier": "{{carrier}}"}'
        fault = 'none'
    }
    changelog = '自检：关闭故障注入'
} $dev
$after = Invoke-RestMethod -Uri "$Base/skills/$skillCode" -Headers $dev
Assert-True ($after.version -eq 3) "配置变更是发新版本（当前 v$($after.version)）"

Write-Host '==> 验收第 5 条：建智能体、绑技能、在线测试、发布' -ForegroundColor Cyan
$agent = Post '/agents' @{
    code = $agentCode
    name = '报价审核（自检）'
    description = '自检用智能体'
    stage = 'logistics'
    capabilities = @('carrier_quote')
    model_tier = 'small'
    system_prompt = '你是运价审核专员，请给出 3 条谈判要点。'
    skill_ids = @($skillCode)
} $dev
Assert-True ($agent.skills.Count -eq 1) '智能体已绑定技能'
Assert-True ($agent.published -eq $null) '新建后仅有草稿，未发布'

$test = Post "/agents/$agentCode/test" @{ input = @{ carrier = 'Standard Class' }; use_mock = $true } $dev
$toolSteps = @($test.trace | Where-Object { $_.kind -eq 'tool' })
$llmSteps = @($test.trace | Where-Object { $_.kind -eq 'llm' })
Assert-True ($toolSteps.Count -ge 1) "轨迹里有工具调用（$($toolSteps.Count) 步）"
Assert-True ($llmSteps.Count -eq 1) '轨迹里有模型调用'
Assert-True ($toolSteps[0].duration_ms -gt 0) "工具步骤有真实耗时（$($toolSteps[0].duration_ms) ms）"
Assert-True ($llmSteps[0].tokens -gt 0) "模型步骤记录 Token（$($llmSteps[0].tokens)）"
Assert-True ($test.tokens -gt 0 -and $test.cost_usd -ge 0) "汇总 Token 与成本（$($test.tokens) tokens / `$$($test.cost_usd)）"
Assert-True ($test.trace[0].label -notmatch '^[a-z_ ]+$') "轨迹标签是中文（$($test.trace[0].label)）"

$published = Post "/agents/$agentCode/versions" @{
    system_prompt = '你是运价审核专员，给出 3 条谈判要点并标注风险。'
    skill_ids = @($skillCode)
    changelog = '自检：补充风险标注'
    publish = $true
} $dev
Assert-True ($published.published.version -eq 2) "已发布 v$($published.published.version)"
Assert-True (@($published.versions).Count -eq 2) "版本历史保留（$(@($published.versions).Count) 个）"
$archived = @($published.versions | Where-Object { $_.status -eq 'archived' })
Assert-True ($archived.Count -le 1) '旧发布版本被归档，线上只有一个已发布版本'

$retest = Post "/agents/$agentCode/test" @{ input = @{ carrier = 'First Class' }; use_mock = $true } $dev
Assert-True ($retest.version -eq 2 -and $retest.version_status -eq 'published') `
    "测试使用已发布版本（v$($retest.version)/$($retest.version_status)）"

Write-Host '==> 引用保护与 RBAC' -ForegroundColor Cyan
$code = Status "/skills/$skillCode" $dev 'DELETE'
Assert-True ($code -eq 409) "被智能体引用的技能拒绝删除（实际 HTTP $code）"
$code = Status '/skills' $viewer 'POST' @{ code = 'probe_viewer_skill'; name = 'x'; type = 'http' }
Assert-True ($code -eq 403) "只读角色不能建技能（实际 HTTP $code）"
$code = Status '/agents' $viewer 'POST' @{ code = 'probe_viewer_agent'; name = 'x' }
Assert-True ($code -eq 403) "只读角色不能建智能体（实际 HTTP $code）"

# 未绑定的技能应当可以删
$free = Post '/skills' @{
    code = "probe_free_$suffix"
    name = '临时技能（自检）'
    category = 'external'
    type = 'http'
    config = @{ mock = $true; url = 'https://api.example.com/x' }
} $dev
$code = Status "/skills/$($free.code)" $dev 'DELETE'
Assert-True ($code -eq 204) "未被引用的技能可以删除（实际 HTTP $code）"

Write-Host '==> SSRF 防护' -ForegroundColor Cyan
# 真实模式指向回环地址必须在建技能这一步就被拒（422），而不是等到运行时报错
$code = Status '/skills' $dev 'POST' @{
    code = "probe_ssrf_$suffix"
    name = '内网探测（自检）'
    category = 'external'
    type = 'http'
    config = @{ mock = $false; url = 'http://127.0.0.1:8000/api/v1/health' }
}
Assert-True ($code -eq 422) "创建指向回环地址的真实技能被拒绝（实际 HTTP $code）"

$code = Status '/skills' $dev 'POST' @{
    code = "probe_ssrf_meta_$suffix"
    name = '元数据探测（自检）'
    category = 'external'
    type = 'http'
    config = @{ mock = $false; url = 'http://169.254.169.254/latest/meta-data' }
}
Assert-True ($code -eq 422) "创建指向云元数据地址的技能被拒绝（实际 HTTP $code）"

Write-Host "`n通过 $passed 项，失败 $failed 项" -ForegroundColor $(if ($failed -eq 0) { 'Green' } else { 'Red' })
if ($failed -gt 0) { exit 1 }
