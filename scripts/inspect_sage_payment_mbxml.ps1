param(
    [string]$SchemaPath = "C:\Program Files (x86)\Sage\Sage 100 Contractor SQL\mbxml.xsd"
)

$ErrorActionPreference = "Stop"

if (-not (Test-Path -LiteralPath $SchemaPath -PathType Leaf)) {
    throw "Sage mbxml.xsd was not found at the approved installed path."
}

[xml]$schema = Get-Content -LiteralPath $SchemaPath -Raw

# Include both the direct A/R candidates and the adjacent A/P and general-ledger
# requests needed to distinguish customer receipts from other payment writes.
$requestPattern = "(?i)(ARInvoice|Receipt|Payment|Pay|Deposit|Cash|GeneralLedger).*Rq$"
$requests = @()
foreach ($element in $schema.SelectNodes("//*[local-name()='element'][@name]")) {
    $name = [string]$element.Attributes["name"].Value
    if ($name -notmatch $requestPattern) { continue }

    $typeName = ""
    if ($element.Attributes["type"]) {
        $typeName = [string]$element.Attributes["type"].Value
        if ($typeName.Contains(":")) {
            $typeName = $typeName.Substring($typeName.IndexOf(":") + 1)
        }
    }
    $typeNode = $null
    if ($typeName.Length -gt 0) {
        $typeNode = $schema.SelectSingleNode(
            "//*[local-name()='complexType'][@name='$typeName']"
        )
    }
    $fields = @()
    if ($typeNode) {
        foreach ($field in $typeNode.SelectNodes(".//*[local-name()='element'][@name or @ref]")) {
            $fieldName = if ($field.Attributes["name"]) {
                [string]$field.Attributes["name"].Value
            } else {
                [string]$field.Attributes["ref"].Value
            }
            $fields += [ordered]@{
                name = $fieldName
                type = if ($field.Attributes["type"]) { [string]$field.Attributes["type"].Value } else { "" }
                minimum = if ($field.Attributes["minOccurs"]) { [string]$field.Attributes["minOccurs"].Value } else { "" }
                maximum = if ($field.Attributes["maxOccurs"]) { [string]$field.Attributes["maxOccurs"].Value } else { "" }
            }
        }
    }
    $requests += [ordered]@{
        request = $name
        type = $typeName
        fields = $fields
    }
}

$requestNames = @($requests | ForEach-Object { $_.request })
$arReceiptRequests = @(
    $requestNames |
        Where-Object { $_ -match "(?i)(AR.*(Receipt|Payment|Pay)|CashReceipt|CustomerPayment).*Add.*Rq$" }
)

[ordered]@{
    schemaPath = $SchemaPath
    schemaSha256 = (Get-FileHash -LiteralPath $SchemaPath -Algorithm SHA256).Hash
    requestCount = $requests.Count
    arReceiptWriteAvailable = $arReceiptRequests.Count -gt 0
    arReceiptRequests = $arReceiptRequests
    generalLedgerWriteAvailable = @($requestNames | Where-Object { $_ -match "(?i)^GeneralLedgerAdd.*Rq$" }).Count -gt 0
    requests = $requests
} | ConvertTo-Json -Depth 8
