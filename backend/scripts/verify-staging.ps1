param(
  [string]$BaseUrl = "https://staging-api.drivertk.com",
  [string]$DiaryDate = "2026-04-11"
)

$endpoints = @(
  "/api/signals/health",
  "/api/signals/home?driverId=local-driver",
  "/api/signals/proximity?driverId=local-driver",
  "/api/signals/diary?driverId=local-driver&date=$DiaryDate"
)

Write-Output "DTK staging verification baseUrl=$BaseUrl"
foreach ($path in $endpoints) {
  $url = "$BaseUrl$path"
  try {
    $response = Invoke-WebRequest -Uri $url -UseBasicParsing -TimeoutSec 20
    $body = [string]$response.Content
    Write-Output "URL=$url STATUS=$($response.StatusCode) LEN=$($body.Length)"
    if ($body.Length -gt 0) {
      Write-Output ("BODY_PREVIEW=" + $body.Substring(0, [Math]::Min(220, $body.Length)))
    }
  } catch {
    if ($_.Exception.Response) {
      $resp = $_.Exception.Response
      $statusCode = [int]$resp.StatusCode
      $stream = $resp.GetResponseStream()
      $reader = New-Object System.IO.StreamReader($stream)
      $errorBody = $reader.ReadToEnd()
      Write-Output "URL=$url STATUS=$statusCode LEN=$($errorBody.Length)"
      if ($errorBody.Length -gt 0) {
        Write-Output ("BODY_PREVIEW=" + $errorBody.Substring(0, [Math]::Min(220, $errorBody.Length)))
      }
    } else {
      Write-Output "URL=$url ERROR=$($_.Exception.Message)"
    }
  }
  Write-Output "---"
}
