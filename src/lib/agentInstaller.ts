// Builds the one-file Windows installer for the Optimas Print Agent. It
// downloads the agent from this POS site, starts it now, and starts it
// hidden at every Windows sign-in (Startup folder — no admin rights needed).

export function agentInstallerCmd(origin: string): string {
  const o = origin.replace(/\/$/, '')
  if (!/^https?:\/\/[A-Za-z0-9.:-]+$/.test(o)) throw new Error('Unexpected site address')
  const lines = [
    '@echo off',
    'title Optimas Print Agent setup',
    'echo Installing the Optimas Print Agent...',
    'set "DIR=%LOCALAPPDATA%\\OptimasPrintAgent"',
    'if not exist "%DIR%" mkdir "%DIR%"',
    `powershell -NoProfile -ExecutionPolicy Bypass -Command "[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12; Invoke-WebRequest -UseBasicParsing -Uri '${o}/print-agent/optimas-print-agent.ps1' -OutFile (Join-Path $env:LOCALAPPDATA 'OptimasPrintAgent\\optimas-print-agent.ps1')"`,
    'if errorlevel 1 (',
    '  echo Could not download the agent. Check the internet connection and try again.',
    '  pause',
    '  exit /b 1',
    ')',
    // Stop an older copy so the new one can take the port.
    `powershell -NoProfile -Command "Get-CimInstance Win32_Process | Where-Object { $_.ProcessId -ne $PID -and $_.Name -eq 'powershell.exe' -and $_.CommandLine -like '*optimas-print-agent.ps1*' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force }" >nul 2>&1`,
    `> "%DIR%\\start-agent.vbs" echo CreateObject("WScript.Shell").Run "powershell.exe -NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File ""%DIR%\\optimas-print-agent.ps1"" -AllowedOrigins ${o}", 0, False`,
    'copy /Y "%DIR%\\start-agent.vbs" "%APPDATA%\\Microsoft\\Windows\\Start Menu\\Programs\\Startup\\Optimas Print Agent.vbs" >nul',
    'wscript "%DIR%\\start-agent.vbs"',
    'echo.',
    'echo Done. The Optimas Print Agent is running and will start with Windows.',
    'echo Go back to Optimas POS: Settings - Hardware - press Check.',
    'pause',
  ]
  // Windows batch files want CRLF line endings.
  return lines.join('\r\n') + '\r\n'
}
