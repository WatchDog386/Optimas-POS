<#
  Optimas Print Agent
  -------------------
  Lets the Optimas POS web app print straight to a named Windows printer
  (e.g. the XP-80C for receipts and the XP-330B for barcode labels) with the
  normal Windows drivers, no print dialog and no driver swapping.

  It listens on http://127.0.0.1:9180 (this computer only) and accepts
  requests only from the Optimas POS address(es) given in -AllowedOrigins.

    GET  /status    -> {"ok":true,...}
    GET  /printers  -> {"printers":["XP-80C","XP-330B",...]}
    POST /print     {"printer":"XP-330B","data":"<base64>","name":"Labels"}

  Works with Windows PowerShell 5.1 (built into Windows 10/11).
#>
param(
  [int]$Port = 9180,
  [string[]]$AllowedOrigins = @('https://pos.optimaswifi.co.ke')
)

$ErrorActionPreference = 'Stop'
$Version = '1.0.0'
$MaxBody = 10MB

Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;

public static class OptimasRawPrinter
{
    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    public class DOCINFO
    {
        [MarshalAs(UnmanagedType.LPWStr)] public string pDocName;
        [MarshalAs(UnmanagedType.LPWStr)] public string pOutputFile;
        [MarshalAs(UnmanagedType.LPWStr)] public string pDataType;
    }

    [DllImport("winspool.drv", EntryPoint = "OpenPrinterW", SetLastError = true, CharSet = CharSet.Unicode)]
    static extern bool OpenPrinter(string printerName, out IntPtr handle, IntPtr defaults);

    [DllImport("winspool.drv", SetLastError = true)]
    static extern bool ClosePrinter(IntPtr handle);

    [DllImport("winspool.drv", EntryPoint = "StartDocPrinterW", SetLastError = true, CharSet = CharSet.Unicode)]
    static extern int StartDocPrinter(IntPtr handle, int level, [In, MarshalAs(UnmanagedType.LPStruct)] DOCINFO docInfo);

    [DllImport("winspool.drv", SetLastError = true)]
    static extern bool EndDocPrinter(IntPtr handle);

    [DllImport("winspool.drv", SetLastError = true)]
    static extern bool StartPagePrinter(IntPtr handle);

    [DllImport("winspool.drv", SetLastError = true)]
    static extern bool EndPagePrinter(IntPtr handle);

    [DllImport("winspool.drv", SetLastError = true)]
    static extern bool WritePrinter(IntPtr handle, byte[] bytes, int count, out int written);

    /// Send bytes to the printer untouched (RAW): ESC/POS for receipts, TSPL for labels.
    public static void Send(string printerName, byte[] data, string docName)
    {
        IntPtr handle;
        if (!OpenPrinter(printerName, out handle, IntPtr.Zero))
            throw new Exception("Printer not found: " + printerName + " (Windows error " + Marshal.GetLastWin32Error() + ")");
        try
        {
            DOCINFO info = new DOCINFO();
            info.pDocName = docName;
            info.pDataType = "RAW";
            if (StartDocPrinter(handle, 1, info) == 0)
                throw new Exception("Could not start the print job (Windows error " + Marshal.GetLastWin32Error() + ")");
            try
            {
                if (!StartPagePrinter(handle))
                    throw new Exception("Could not start the page (Windows error " + Marshal.GetLastWin32Error() + ")");
                int written;
                bool ok = WritePrinter(handle, data, data.Length, out written);
                EndPagePrinter(handle);
                if (!ok || written != data.Length)
                    throw new Exception("Could not send the data to the printer (Windows error " + Marshal.GetLastWin32Error() + ")");
            }
            finally
            {
                EndDocPrinter(handle);
            }
        }
        finally
        {
            ClosePrinter(handle);
        }
    }
}
"@

function ConvertTo-JsonString([string]$s) {
  if ($null -eq $s) { return 'null' }
  return (ConvertTo-Json -InputObject $s -Compress)
}

function Test-Origin([string]$origin) {
  if ([string]::IsNullOrEmpty($origin)) { return $true }   # not a browser (e.g. curl on this PC)
  if ($AllowedOrigins -contains $origin) { return $true }
  return ($origin -match '^https?://(localhost|127\.0\.0\.1)(:\d+)?$')
}

function Send-Response($stream, [int]$status, [string]$reason, [string]$body, [string]$origin) {
  $bodyBytes = [System.Text.Encoding]::UTF8.GetBytes($body)
  $lines = @(
    "HTTP/1.1 $status $reason",
    'Content-Type: application/json; charset=utf-8',
    "Content-Length: $($bodyBytes.Length)",
    'Connection: close',
    'Cache-Control: no-store'
  )
  if (-not [string]::IsNullOrEmpty($origin) -and (Test-Origin $origin)) {
    $lines += "Access-Control-Allow-Origin: $origin"
    $lines += 'Vary: Origin'
    $lines += 'Access-Control-Allow-Methods: GET, POST, OPTIONS'
    $lines += 'Access-Control-Allow-Headers: Content-Type'
    $lines += 'Access-Control-Allow-Private-Network: true'
    $lines += 'Access-Control-Max-Age: 600'
  }
  $head = [System.Text.Encoding]::ASCII.GetBytes(($lines -join "`r`n") + "`r`n`r`n")
  $stream.Write($head, 0, $head.Length)
  if ($bodyBytes.Length -gt 0) { $stream.Write($bodyBytes, 0, $bodyBytes.Length) }
  $stream.Flush()
}

function Read-Request($stream) {
  # Headers: read until the blank line (max 16 KB).
  $buffer = New-Object System.IO.MemoryStream
  while ($true) {
    $b = $stream.ReadByte()
    if ($b -lt 0) { return $null }
    $buffer.WriteByte([byte]$b)
    $len = [int]$buffer.Length
    if ($b -eq 10 -and $len -ge 4) {
      $raw = $buffer.GetBuffer()
      if ($raw[$len - 4] -eq 13 -and $raw[$len - 3] -eq 10 -and $raw[$len - 2] -eq 13) { break }
    }
    if ($len -gt 16384) { throw 'Request headers too large' }
  }
  $text = [System.Text.Encoding]::ASCII.GetString($buffer.ToArray())
  $lines = $text -split "`r`n"
  $parts = $lines[0] -split ' '
  $headers = @{}
  for ($k = 1; $k -lt $lines.Length; $k++) {
    $line = $lines[$k]
    $i = $line.IndexOf(':')
    if ($i -gt 0) { $headers[$line.Substring(0, $i).Trim().ToLower()] = $line.Substring($i + 1).Trim() }
  }
  $length = 0
  if ($headers.ContainsKey('content-length')) { $length = [int]$headers['content-length'] }
  if ($length -gt $MaxBody) { throw 'Print job too large' }
  $body = New-Object byte[] $length
  $read = 0
  while ($read -lt $length) {
    $n = $stream.Read($body, $read, $length - $read)
    if ($n -le 0) { break }
    $read += $n
  }
  return @{
    Method  = $parts[0]
    Path    = ($parts[1] -split '\?')[0]
    Headers = $headers
    Body    = [System.Text.Encoding]::UTF8.GetString($body, 0, $read)
  }
}

function Get-PrinterNames {
  $names = @(Get-CimInstance -ClassName Win32_Printer | ForEach-Object { $_.Name })
  return '{"printers":[' + (($names | ForEach-Object { ConvertTo-JsonString $_ }) -join ',') + ']}'
}

$listener = New-Object System.Net.Sockets.TcpListener -ArgumentList ([System.Net.IPAddress]::Loopback), $Port
try {
  $listener.Start()
} catch {
  Write-Host "Optimas Print Agent: port $Port is already in use (is the agent already running?)"
  exit 1
}
Write-Host "Optimas Print Agent $Version listening on http://127.0.0.1:$Port"
Write-Host "Allowed: $($AllowedOrigins -join ', ')"

while ($true) {
  $client = $listener.AcceptTcpClient()
  $stream = $null
  $origin = ''
  try {
    $client.ReceiveTimeout = 10000
    $client.SendTimeout = 10000
    $stream = $client.GetStream()
    $req = Read-Request $stream
    if ($null -eq $req) { continue }
    if ($req.Headers.ContainsKey('origin')) { $origin = $req.Headers['origin'] }

    if (-not (Test-Origin $origin)) {
      Send-Response $stream 403 'Forbidden' '{"error":"This website may not use the Optimas Print Agent"}' ''
      continue
    }

    if ($req.Method -eq 'OPTIONS') {
      Send-Response $stream 204 'No Content' '' $origin
    } elseif ($req.Method -eq 'GET' -and $req.Path -eq '/status') {
      Send-Response $stream 200 'OK' ('{"ok":true,"agent":"optimas-print-agent","version":' + (ConvertTo-JsonString $Version) + '}') $origin
    } elseif ($req.Method -eq 'GET' -and $req.Path -eq '/printers') {
      Send-Response $stream 200 'OK' (Get-PrinterNames) $origin
    } elseif ($req.Method -eq 'POST' -and $req.Path -eq '/print') {
      $job = $req.Body | ConvertFrom-Json
      if ([string]::IsNullOrEmpty($job.printer) -or [string]::IsNullOrEmpty($job.data)) {
        Send-Response $stream 400 'Bad Request' '{"error":"printer and data are required"}' $origin
      } else {
        $bytes = [Convert]::FromBase64String($job.data)
        $name = 'Optimas POS'
        if (-not [string]::IsNullOrEmpty($job.name)) { $name = [string]$job.name }
        [OptimasRawPrinter]::Send([string]$job.printer, $bytes, $name)
        Write-Host ("{0:HH:mm:ss}  {1} bytes -> {2}" -f (Get-Date), $bytes.Length, $job.printer)
        Send-Response $stream 200 'OK' '{"ok":true}' $origin
      }
    } else {
      Send-Response $stream 404 'Not Found' '{"error":"not found"}' $origin
    }
  } catch {
    $msg = $_.Exception.Message
    Write-Host "Error: $msg"
    if ($null -ne $stream) {
      try { Send-Response $stream 500 'Internal Server Error' ('{"error":' + (ConvertTo-JsonString $msg) + '}') $origin } catch { }
    }
  } finally {
    $client.Close()
  }
}
