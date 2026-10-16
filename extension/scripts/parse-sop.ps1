$sourcePath = "D:\SHETFUEK\extension\SOP_Reference_Macros_IssueTypes.json"
$outputPath = "D:\SHETFUEK\extension\sop-data.json"

$raw = Get-Content -LiteralPath $sourcePath -Raw -Encoding UTF8
$sopsSource = $raw | ConvertFrom-Json

function Get-Id($name) {
    return $name.Trim().ToLower() -replace '[^a-z0-9]+', '_' -replace '^_|_$', ''
}

function Get-Keywords($name) {
    return $name.Split(' ') | Where-Object { $_.Length -gt 2 -and $_ -ne '::' }
}

$prefixMap = @{
    "account" = "template_account_access"
    "payments" = "template_payments"
    "discounts" = "template_discounts"
    "user_non_compliance" = "template_user_non_compliance"
    "subscriptions" = "template_subscriptions"
    "feedback" = "template_feedback"
    "collaborations" = "template_collaborations"
    "parking" = "template_vehicle_operations"
    "hardware" = "template_vehicle_operations"
    "riding" = "template_vehicle_operations"
    "operations" = "template_vehicle_operations"
    "livechat" = "template_vehicle_operations"
    "phonesupport" = "template_vehicle_operations"
    "in_appnavigation" = "template_vehicle_operations"
    "legal" = "template_general"
    "media" = "template_general"
    "service_inquiries" = "template_general"
    "service_enquiries" = "template_general"
    "general" = "template_general"
}

$sops = @()
$macroMap = @{}
$issueTypeMap = @{}
$globalIssueId = 0
$globalMacroId = 0

foreach ($src in $sopsSource) {
    $sop = @{
        sopName = $src.sop_name
        pageLink = $src.page_link
        issueTypes = @()
        macros = @()
    }

    $macroIds = @()

    foreach ($macroName in ($src.macros)) {
        $id = Get-Id $macroName
        if (-not $macroMap.ContainsKey($id)) {
            $macroMap[$id] = @{
                id = $id
                title = $macroName
                body = ''
                incomplete = $true
                variants = @{}
            }
            $globalMacroId++
        }
        $macroIds += $id
        if ($sop.macros -notcontains $id) {
            $sop.macros += $id
        }
    }

    foreach ($issueName in ($src.issue_types)) {
        $id = Get-Id $issueName
        if (-not $issueTypeMap.ContainsKey($id)) {
            $keywords = Get-Keywords $issueName
            $matchedTemplate = "template_general"
            foreach ($prefix in $prefixMap.Keys) {
                if ($id.StartsWith($prefix)) {
                    $matchedTemplate = $prefixMap[$prefix]
                    break
                }
            }
            $issueTypeMap[$id] = @{
                id = $id
                name = $issueName
                priority = ++$globalIssueId
                rules = @{
                    subjectKeywords = $keywords
                    bodyKeywords = @()
                    zendeskTags = @()
                    fmFlags = @()
                }
                relatedMacros = $macroIds.Clone()
                macroId = if ($macroIds.Length -gt 0) { $macroIds[0] } else { $null }
                supplementBlocks = @()
                adminNoteTemplate = $matchedTemplate
            }
        } else {
            $existing = $issueTypeMap[$id]
            foreach ($mid in $macroIds) {
                if ($existing.relatedMacros -notcontains $mid) {
                    $existing.relatedMacros += $mid
                }
            }
            if (-not $existing.macroId -and $macroIds.Length -gt 0) {
                $existing.macroId = $macroIds[0]
            }
        }
        if ($sop.issueTypes -notcontains $id) {
            $sop.issueTypes += $id
        }
    }

    $sops += $sop
}

$issueTypesArray = $issueTypeMap.Values | Sort-Object priority
$firstMacroId = if ($macroMap.Count -gt 0) { ($macroMap.Keys | Select-Object -First 1) } else { $null }

$macrosObj = @{}
foreach ($m in $macroMap.Values) {
    $macrosObj[$m.id] = $m
}

$sopData = @{
    sops = $sops
    issueTypes = $issueTypesArray
    macros = $macrosObj
    supplementBlocks = @{}
    adminNoteTemplates = @{
        template_vehicle_operations = @{
            issue = '* Issue: {issue_type} reported by customer (Ticket {ticket_id}).'
            solution = '* Solution: Resolved per SOP guidelines for {issue_type}.'
            other = '* Other: User {user_id} | {city}, {country} | Partner: {partner} | Compensation: {compensation} | FM flags: {fm_flags} | Page: {page_type} | Entity: {entity_id}.'
            supportingDocumentation = '* Supporting documentation: {documented_data}'
        }
        template_account_access = @{
            issue = '* Issue: Account/access issue reported by customer (Ticket {ticket_id}).'
            solution = '* Solution: Guided customer through resolution per SOP guidelines.'
            other = '* Other: User {user_id} | {city}, {country} | Partner: {partner} | Compensation: {compensation} | Language: {language} | IVC: {ivc}.'
            supportingDocumentation = '* Supporting documentation: {documented_data}'
        }
        template_payments = @{
            issue = '* Issue: Payment/charge issue reported by customer (Ticket {ticket_id}).'
            solution = '* Solution: Investigated payment record and resolved per SOP guidelines.'
            other = '* Other: User {user_id} | {city}, {country} | Partner: {partner} | Compensation: {compensation} | Requester: {requester_email}.'
            supportingDocumentation = '* Supporting documentation: {documented_data}'
        }
        template_discounts = @{
            issue = '* Issue: Discount/promotion query reported by customer (Ticket {ticket_id}).'
            solution = '* Solution: Verified discount eligibility and explained per SOP guidelines.'
            other = '* Other: User {user_id} | {city}, {country} | Partner: {partner} | Compensation: {compensation} | Language: {language}.'
            supportingDocumentation = '* Supporting documentation: {documented_data}'
        }
        template_user_non_compliance = @{
            issue = '* Issue: User non-compliance/ASB report (Ticket {ticket_id}).'
            solution = '* Solution: Reviewed user behaviour and applied SOP guidelines.'
            other = '* Other: User {user_id} | {city}, {country} | Partner: {partner} | Compensation: {compensation} | FM flags: {fm_flags}.'
            supportingDocumentation = '* Supporting documentation: {documented_data}'
        }
        template_subscriptions = @{
            issue = '* Issue: Subscription/Voi Pass query reported by customer (Ticket {ticket_id}).'
            solution = '* Solution: Verified subscription status and resolved per SOP guidelines.'
            other = '* Other: User {user_id} | {city}, {country} | Partner: {partner} | Compensation: {compensation} | Language: {language} | IVC: {ivc}.'
            supportingDocumentation = '* Supporting documentation: {documented_data}'
        }
        template_feedback = @{
            issue = '* Issue: General feedback/operations feedback reported by customer (Ticket {ticket_id}).'
            solution = '* Solution: Acknowledged feedback and resolved per SOP guidelines.'
            other = '* Other: User {user_id} | {city}, {country} | Partner: {partner} | Compensation: {compensation}.'
            supportingDocumentation = '* Supporting documentation: {documented_data}'
        }
        template_collaborations = @{
            issue = '* Issue: Collaboration/partner inquiry reported (Ticket {ticket_id}).'
            solution = '* Solution: Processed request per SOP guidelines.'
            other = '* Other: User {user_id} | {city}, {country} | Partner: {partner} | Compensation: {compensation}.'
            supportingDocumentation = '* Supporting documentation: {documented_data}'
        }
        template_general = @{
            issue = '* Issue: General support request (Ticket {ticket_id}).'
            solution = '* Solution: Resolved per SOP guidelines.'
            other = '* Other: User {user_id} | {city}, {country} | Partner: {partner} | Compensation: {compensation}.'
            supportingDocumentation = '* Supporting documentation: {documented_data}'
        }
    }
    compensationTypes = @{
        credit = 'account credit'
        voucher = 'voucher'
        refund = 'refund'
    }
} | ConvertTo-Json -Depth 10

Set-Content -LiteralPath $outputPath -Value $sopData -Encoding UTF8
Write-Host "Generated sop-data.json with $($issueTypesArray.Count) issue types and $($macroMap.Count) macros across $($sops.Count) SOPs"
