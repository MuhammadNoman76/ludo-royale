; Ludo Royale installer (Inno Setup 6). Built by build.ps1 from ..\..\publish\windows.
; Per-user: installs into %LOCALAPPDATA%\Programs\Ludo Royale without administrator rights.

#define AppName "Ludo Royale"
#ifndef AppVersion
  #define AppVersion "1.0.0"
#endif
#define AppExe "LudoRoyale.exe"
#ifndef ServerUrl
  #define ServerUrl "https://ludo.nomanshafiq.com"
#endif
#ifndef PublishDir
  #define PublishDir "..\..\publish\windows"
#endif
#ifndef OutputDir
  #define OutputDir "..\..\dist"
#endif

[Setup]
; Keep this AppId for every version: the app's updater finds the install through it.
AppId={{A2855202-BFD4-4982-866A-38326F65D047}
AppName={#AppName}
AppVersion={#AppVersion}
AppVerName={#AppName} {#AppVersion}
AppPublisher=Muhammad Noman
AppPublisherURL=https://www.nomanshafiq.com/ludo-royale/
AppComments=Ludo with friends and colleagues, wherever they are.
VersionInfoDescription={#AppName} setup
DefaultDirName={autopf}\{#AppName}
DisableProgramGroupPage=yes
DisableDirPage=auto
OutputDir={#OutputDir}
OutputBaseFilename=LudoRoyale-Setup-{#AppVersion}
SetupIconFile=..\LudoRoyale\Assets\LudoRoyale.ico
UninstallDisplayIcon={app}\{#AppExe}
UninstallDisplayName={#AppName}
WizardStyle=modern
WizardSizePercent=100
Compression=lzma2/ultra64
SolidCompression=yes
PrivilegesRequired=lowest
; Windows 10 and 11 (the app is .NET Framework 4.8 + WebView2; Windows 7/8.1 players use the browser).
MinVersion=10.0
ArchitecturesAllowed=x86compatible x64compatible arm64
CloseApplications=yes
RestartApplications=no

[Languages]
Name: "english"; MessagesFile: "compiler:Default.isl"

[Messages]
WindowsVersionNotSupported=Ludo Royale for Windows needs Windows 10 or 11.%n%nOn Windows 7 or 8.1 you can play in your browser at {#ServerUrl}

[Tasks]
Name: "desktopicon"; Description: "{cm:CreateDesktopIcon}"; GroupDescription: "{cm:AdditionalIcons}"; Flags: unchecked
Name: "protocol"; Description: "Open game links from the website in Ludo Royale (ludoroyale://)"; GroupDescription: "Windows integration:"
Name: "startup"; Description: "Start Ludo Royale with Windows (quietly, in the notification area)"; GroupDescription: "Windows integration:"; Flags: unchecked

[InstallDelete]
; Updating: remove the previous version's program files first (only in Ludo Royale's own folder).
; Settings (%APPDATA%\LudoRoyale) and the uninstaller are never touched.
Type: filesandordirs; Name: "{app}\web"; Check: IsOwnFolder
Type: filesandordirs; Name: "{app}\runtimes"; Check: IsOwnFolder
Type: files; Name: "{app}\*.dll"; Check: IsOwnFolder
Type: files; Name: "{app}\*.config"; Check: IsOwnFolder
Type: files; Name: "{app}\{#AppExe}"; Check: IsOwnFolder

[Files]
Source: "{#PublishDir}\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs

[Icons]
Name: "{autoprograms}\{#AppName}"; Filename: "{app}\{#AppExe}"
Name: "{autodesktop}\{#AppName}"; Filename: "{app}\{#AppExe}"; Tasks: desktopicon

[Registry]
; ludoroyale://join/<CODE> and ludoroyale://friend/<CODE> open the app (per user, no admin rights).
Root: HKCU; Subkey: "Software\Classes\ludoroyale"; ValueType: string; ValueName: ""; ValueData: "URL:Ludo Royale"; Flags: uninsdeletekey; Tasks: protocol
Root: HKCU; Subkey: "Software\Classes\ludoroyale"; ValueType: string; ValueName: "URL Protocol"; ValueData: ""; Tasks: protocol
Root: HKCU; Subkey: "Software\Classes\ludoroyale\DefaultIcon"; ValueType: string; ValueName: ""; ValueData: """{app}\{#AppExe}"",0"; Tasks: protocol
Root: HKCU; Subkey: "Software\Classes\ludoroyale\shell\open\command"; ValueType: string; ValueName: ""; ValueData: """{app}\{#AppExe}"" ""%1"""; Tasks: protocol
; Start with Windows (opt-in). The app's own setting writes the same value.
Root: HKCU; Subkey: "Software\Microsoft\Windows\CurrentVersion\Run"; ValueType: string; ValueName: "Ludo Royale"; ValueData: """{app}\{#AppExe}"" --tray"; Flags: uninsdeletevalue; Tasks: startup
; Uninstall always removes both, even when they were switched on later in the app's settings.
Root: HKCU; Subkey: "Software\Classes\ludoroyale"; Flags: uninsdeletekey dontcreatekey
Root: HKCU; Subkey: "Software\Microsoft\Windows\CurrentVersion\Run"; ValueType: none; ValueName: "Ludo Royale"; Flags: uninsdeletevalue dontcreatekey

[UninstallDelete]
; The game view's browser cache (WebView2).
Type: filesandordirs; Name: "{localappdata}\LudoRoyale"

[Run]
Filename: "{app}\{#AppExe}"; Description: "{cm:LaunchProgram,{#AppName}}"; Flags: nowait postinstall skipifsilent
; The app's updater runs setup with /VERYSILENT ... /RELAUNCH=1: start it again afterwards.
Filename: "{app}\{#AppExe}"; Parameters: "--updated"; Flags: nowait; Check: RelaunchRequested

[Code]
function RelaunchRequested(): Boolean;
begin
  Result := ExpandConstant('{param:RELAUNCH|0}') = '1';
end;

// The install folder is Ludo Royale's own (named "Ludo Royale" and holding LudoRoyale.exe).
function IsOwnFolder(): Boolean;
begin
  Result := (CompareText(ExtractFileName(RemoveBackslashUnlessRoot(ExpandConstant('{app}'))), '{#AppName}') = 0) and
            FileExists(ExpandConstant('{app}\{#AppExe}'));
end;

function HasDotNet48(): Boolean;
var
  Release: Cardinal;
begin
  Result := RegQueryDWordValue(HKLM, 'SOFTWARE\Microsoft\NET Framework Setup\NDP\v4\Full', 'Release', Release) and (Release >= 528040);
end;

function HasWebView2(): Boolean;
var
  Version: String;
begin
  Result :=
    (RegQueryStringValue(HKLM, 'SOFTWARE\WOW6432Node\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}', 'pv', Version) and (Version <> '') and (Version <> '0.0.0.0')) or
    (RegQueryStringValue(HKLM, 'SOFTWARE\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}', 'pv', Version) and (Version <> '') and (Version <> '0.0.0.0')) or
    (RegQueryStringValue(HKCU, 'Software\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}', 'pv', Version) and (Version <> '') and (Version <> '0.0.0.0'));
end;

function InitializeSetup(): Boolean;
var
  ErrorCode: Integer;
begin
  Result := True;
  if not HasDotNet48() then
  begin
    if SuppressibleMsgBox('Ludo Royale needs Microsoft .NET Framework 4.8, which is part of Windows 10 (version 1903 and later) and Windows 11 but missing on this PC.' + #13#10#13#10 +
              'Open Microsoft''s download page now? Install it, restart if asked, then run this setup again.',
              mbConfirmation, MB_YESNO, IDNO) = IDYES then
      ShellExec('open', 'https://dotnet.microsoft.com/download/dotnet-framework/net48', '', '', SW_SHOWNORMAL, ewNoWait, ErrorCode);
    Result := False;
    Exit;
  end;
  if not HasWebView2() then
    SuppressibleMsgBox('Ludo Royale shows the game with the Microsoft Edge WebView2 Runtime, which seems to be missing on this PC.' + #13#10#13#10 +
              'Setup will continue. When you start Ludo Royale it shows a link to install the runtime from Microsoft (free).',
              mbInformation, MB_OK, IDOK);
end;

// Uninstall: ask whether to forget the friend code too (kept by default so a reinstall keeps your friends).
procedure CurUninstallStepChanged(CurUninstallStep: TUninstallStep);
begin
  if (CurUninstallStep = usPostUninstall) and DirExists(ExpandConstant('{userappdata}\LudoRoyale')) and not UninstallSilent() then
  begin
    if MsgBox('Also remove your Ludo Royale settings and friend code from this PC?' + #13#10#13#10 +
              'Choose No to keep them, so your friends list comes back if you install Ludo Royale again.',
              mbConfirmation, MB_YESNO or MB_DEFBUTTON2) = IDYES then
      DelTree(ExpandConstant('{userappdata}\LudoRoyale'), True, True, True);
  end;
end;
