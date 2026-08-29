param(
    [string]$SchemaPath = "C:\Program Files (x86)\Sage\Sage 100 Contractor SQL\mbxml.xsd"
)

$ErrorActionPreference = "Stop"

if (-not (Test-Path -LiteralPath $SchemaPath -PathType Leaf)) {
    throw "Sage mbxml.xsd was not found at the approved installed path."
}

[xml]$schema = Get-Content -LiteralPath $SchemaPath -Raw
$namespace = New-Object System.Xml.XmlNamespaceManager($schema.NameTable)
$namespace.AddNamespace("xsd", "http://www.w3.org/2001/XMLSchema")

$keywords = @("receipt", "payment", "deposit", "check", "bank", "charge")
$requests = @()
foreach ($element in $schema.SelectNodes("//xsd:element[@name]", $namespace)) {
    $name = [string]$element.name
    $normalized = $name.ToLowerInvariant()
    if (-not ($keywords | Where-Object { $normalized.Contains($_) })) {
        continue
    }
    if (-not ($normalized.EndsWith("rq") -or $normalized.Contains("add"))) {
        continue
    }
    $fields = @()
    foreach ($field in $element.SelectNodes(".//xsd:element[@name or @ref]", $namespace)) {
        $fieldName = if ($field.name) { [string]$field.name } else { [string]$field.ref }
        if ($fieldName -eq $name) { continue }
        $fields += [ordered]@{
            name = $fieldName
            type = [string]$field.type
            minimum = [string]$field.minOccurs
            maximum = [string]$field.maxOccurs
        }
    }
    $requests += [ordered]@{
        request = $name
        fields = $fields
    }
}

[ordered]@{
    schemaPath = $SchemaPath
    schemaSha256 = (Get-FileHash -LiteralPath $SchemaPath -Algorithm SHA256).Hash
    requestCount = $requests.Count
    requests = $requests
} | ConvertTo-Json -Depth 8
