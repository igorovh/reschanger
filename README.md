# reschanger

Desktopowa aplikacja Electron dla Windows do szybkiej zmiany rozdzielczości i odświeżania monitora z poziomu zasobnika systemowego.

## Wymagania

- Windows
- Bun
- Node.js kompatybilny z Electron

W PowerShell z zablokowanymi skryptami używaj `bun.cmd` zamiast `bun`.

## Instalacja zależności

```powershell
bun.cmd install
```

Pakiety użyte do zbudowania projektu:

```powershell
bun.cmd add react react-dom lucide-react
bun.cmd add -d electron electron-vite electron-builder typescript @types/react @types/react-dom @types/node
```

## Uruchamianie

```powershell
bun.cmd run dev
```

## Sprawdzenie i build

```powershell
bun.cmd run typecheck
bun.cmd run build
```

## Pakowanie instalatora Windows

```powershell
bun.cmd run dist
```

Artefakt NSIS pojawi się w:

```text
release\reschanger Setup 0.1.0.exe
```

Lokalny build jest unsigned i celowo ustawia `CSC_IDENTITY_AUTO_DISCOVERY=false`, żeby `electron-builder` nie próbował używać certyfikatów z systemu.

## Pakowanie wersji portable

```powershell
bun.cmd run dist:portable
```

Artefakt portable pojawi się w:

```text
release\reschanger 0.1.0.exe
```

## Dane lokalne

Ustawienia i presety są zapisywane w pliku:

```text
%APPDATA%\reschanger\settings.json
```

## Funkcje

- automatyczne wykrywanie monitorów
- tworzenie, edycja i usuwanie presetów
- aplikowanie presetu z głównego okna lub menu tray
- menu kontekstowe w zasobniku systemowym
- autostart z Windows
- zmiana trybu ekranu przez PowerShell i WinAPI `ChangeDisplaySettingsEx`
