import { spawn } from "node:child_process";
import { formatMode, type Locale, t } from "../../shared/i18n";
import type { MonitorInfo } from "./types";

type BridgeListResponse = {
  ok: boolean;
  monitors?: MonitorInfo[];
  error?: string;
};

type BridgeApplyResponse = {
  ok: boolean;
  error?: string;
  reason?:
    | "applyFailed"
    | "missingMonitorId"
    | "readCurrentFailed"
    | "testRejected";
  code?: number;
};

const WINDOWS_DISPLAY_BRIDGE = String.raw`
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Text;

public static class DisplayBridge
{
    private const int ENUM_CURRENT_SETTINGS = -1;
    private const int DISPLAY_DEVICE_ACTIVE = 0x00000001;
    private const int DM_PELSWIDTH = 0x00080000;
    private const int DM_PELSHEIGHT = 0x00100000;
    private const int DM_DISPLAYFREQUENCY = 0x00400000;
    private const int CDS_TEST = 0x00000002;
    private const int CDS_UPDATEREGISTRY = 0x00000001;
    private const int DISP_CHANGE_SUCCESSFUL = 0;

    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Ansi)]
    private struct DISPLAY_DEVICE
    {
        public int cb;
        [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 32)]
        public string DeviceName;
        [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 128)]
        public string DeviceString;
        public int StateFlags;
        [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 128)]
        public string DeviceID;
        [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 128)]
        public string DeviceKey;
    }

    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Ansi)]
    private struct DEVMODE
    {
        [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 32)]
        public string dmDeviceName;
        public short dmSpecVersion;
        public short dmDriverVersion;
        public short dmSize;
        public short dmDriverExtra;
        public int dmFields;
        public int dmPositionX;
        public int dmPositionY;
        public int dmDisplayOrientation;
        public int dmDisplayFixedOutput;
        public short dmColor;
        public short dmDuplex;
        public short dmYResolution;
        public short dmTTOption;
        public short dmCollate;
        [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 32)]
        public string dmFormName;
        public short dmLogPixels;
        public int dmBitsPerPel;
        public int dmPelsWidth;
        public int dmPelsHeight;
        public int dmDisplayFlags;
        public int dmDisplayFrequency;
        public int dmICMMethod;
        public int dmICMIntent;
        public int dmMediaType;
        public int dmDitherType;
        public int dmReserved1;
        public int dmReserved2;
        public int dmPanningWidth;
        public int dmPanningHeight;
    }

    [DllImport("user32.dll", CharSet = CharSet.Ansi)]
    private static extern bool EnumDisplayDevices(string lpDevice, uint iDevNum, ref DISPLAY_DEVICE lpDisplayDevice, uint dwFlags);

    [DllImport("user32.dll", CharSet = CharSet.Ansi)]
    private static extern bool EnumDisplaySettings(string lpszDeviceName, int iModeNum, ref DEVMODE lpDevMode);

    [DllImport("user32.dll", CharSet = CharSet.Ansi)]
    private static extern int ChangeDisplaySettingsEx(string lpszDeviceName, ref DEVMODE lpDevMode, IntPtr hwnd, int dwflags, IntPtr lParam);

    public static string ListJson()
    {
        var monitors = new StringBuilder();
        bool firstMonitor = true;

        for (uint index = 0; ; index++)
        {
            DISPLAY_DEVICE device = CreateDisplayDevice();
            if (!EnumDisplayDevices(null, index, ref device, 0))
            {
                break;
            }

            if ((device.StateFlags & DISPLAY_DEVICE_ACTIVE) == 0)
            {
                continue;
            }

            DEVMODE current = CreateDevMode();
            if (!EnumDisplaySettings(device.DeviceName, ENUM_CURRENT_SETTINGS, ref current))
            {
                continue;
            }

            if (!firstMonitor)
            {
                monitors.Append(",");
            }

            monitors.Append("{");
            AppendProperty(monitors, "id", device.DeviceName);
            monitors.Append(",");
            AppendProperty(monitors, "name", String.IsNullOrWhiteSpace(device.DeviceString) ? device.DeviceName : device.DeviceString);
            monitors.Append(",");
            AppendProperty(monitors, "deviceName", device.DeviceName);
            monitors.Append(",");
            monitors.Append("\"current\":");
            AppendMode(monitors, current.dmPelsWidth, current.dmPelsHeight, current.dmDisplayFrequency);
            monitors.Append(",");
            monitors.Append("\"modes\":[");
            AppendModes(monitors, device.DeviceName);
            monitors.Append("]");
            monitors.Append("}");

            firstMonitor = false;
        }

        return "{\"ok\":true,\"monitors\":[" + monitors.ToString() + "]}";
    }

    public static string ApplyJson(string deviceName, int width, int height, int refreshRate)
    {
        if (String.IsNullOrWhiteSpace(deviceName))
        {
            return ErrorJson("Brak identyfikatora monitora.", "missingMonitorId", -100);
        }

        DEVMODE mode = CreateDevMode();
        if (!EnumDisplaySettings(deviceName, ENUM_CURRENT_SETTINGS, ref mode))
        {
            return ErrorJson("Nie można odczytać bieżącego trybu monitora " + deviceName + ".", "readCurrentFailed", -101);
        }

        mode.dmPelsWidth = width;
        mode.dmPelsHeight = height;
        mode.dmDisplayFrequency = refreshRate;
        mode.dmFields = DM_PELSWIDTH | DM_PELSHEIGHT | DM_DISPLAYFREQUENCY;

        int testResult = ChangeDisplaySettingsEx(deviceName, ref mode, IntPtr.Zero, CDS_TEST, IntPtr.Zero);
        if (testResult != DISP_CHANGE_SUCCESSFUL)
        {
            return ErrorJson("Windows odrzucił test trybu " + width + "x" + height + " @ " + refreshRate + " Hz.", "testRejected", testResult);
        }

        int applyResult = ChangeDisplaySettingsEx(deviceName, ref mode, IntPtr.Zero, CDS_UPDATEREGISTRY, IntPtr.Zero);
        if (applyResult != DISP_CHANGE_SUCCESSFUL)
        {
            return ErrorJson("Nie udało się zastosować trybu " + width + "x" + height + " @ " + refreshRate + " Hz.", "applyFailed", applyResult);
        }

        return "{\"ok\":true}";
    }

    private static DISPLAY_DEVICE CreateDisplayDevice()
    {
        DISPLAY_DEVICE device = new DISPLAY_DEVICE();
        device.cb = Marshal.SizeOf(typeof(DISPLAY_DEVICE));
        return device;
    }

    private static DEVMODE CreateDevMode()
    {
        DEVMODE mode = new DEVMODE();
        mode.dmSize = (short)Marshal.SizeOf(typeof(DEVMODE));
        return mode;
    }

    private static void AppendModes(StringBuilder builder, string deviceName)
    {
        var modes = new List<string>();
        var seen = new HashSet<string>();

        for (int index = 0; ; index++)
        {
            DEVMODE mode = CreateDevMode();
            if (!EnumDisplaySettings(deviceName, index, ref mode))
            {
                break;
            }

            if (mode.dmPelsWidth <= 0 || mode.dmPelsHeight <= 0 || mode.dmDisplayFrequency <= 0)
            {
                continue;
            }

            string key = mode.dmPelsWidth + "x" + mode.dmPelsHeight + "@" + mode.dmDisplayFrequency;
            if (seen.Contains(key))
            {
                continue;
            }

            seen.Add(key);
            modes.Add(key);
        }

        modes.Sort(delegate(string left, string right)
        {
            int[] a = ParseModeKey(left);
            int[] b = ParseModeKey(right);
            int pixelCompare = (b[0] * b[1]).CompareTo(a[0] * a[1]);
            if (pixelCompare != 0) return pixelCompare;
            int widthCompare = b[0].CompareTo(a[0]);
            if (widthCompare != 0) return widthCompare;
            return b[2].CompareTo(a[2]);
        });

        for (int i = 0; i < modes.Count; i++)
        {
            if (i > 0) builder.Append(",");
            int[] values = ParseModeKey(modes[i]);
            AppendMode(builder, values[0], values[1], values[2]);
        }
    }

    private static int[] ParseModeKey(string key)
    {
        string[] widthParts = key.Split('x');
        string[] heightParts = widthParts[1].Split('@');
        return new int[]
        {
            Int32.Parse(widthParts[0]),
            Int32.Parse(heightParts[0]),
            Int32.Parse(heightParts[1])
        };
    }

    private static void AppendMode(StringBuilder builder, int width, int height, int refreshRate)
    {
        builder.Append("{\"width\":");
        builder.Append(width);
        builder.Append(",\"height\":");
        builder.Append(height);
        builder.Append(",\"refreshRate\":");
        builder.Append(refreshRate);
        builder.Append("}");
    }

    private static void AppendProperty(StringBuilder builder, string name, string value)
    {
        builder.Append("\"");
        builder.Append(JsonEscape(name));
        builder.Append("\":\"");
        builder.Append(JsonEscape(value ?? ""));
        builder.Append("\"");
    }

    private static string ErrorJson(string message, string reason, int code)
    {
        return "{\"ok\":false,\"error\":\"" + JsonEscape(message) + "\",\"reason\":\"" + JsonEscape(reason) + "\",\"code\":" + code + "}";
    }

    private static string JsonEscape(string value)
    {
        if (value == null)
        {
            return "";
        }

        return value
            .Replace("\\", "\\\\")
            .Replace("\"", "\\\"")
            .Replace("\r", "\\r")
            .Replace("\n", "\\n")
            .Replace("\t", "\\t");
    }
}
`;

export async function listMonitors(locale: Locale): Promise<MonitorInfo[]> {
  ensureWindows(locale);
  const response = await runBridge<BridgeListResponse>(
    "[DisplayBridge]::ListJson()",
    locale,
  );

  if (!response.ok) {
    throw new Error(t(locale, "display.listFailed"));
  }

  return response.monitors ?? [];
}

export async function applyDisplayMode(
  deviceName: string,
  width: number,
  height: number,
  refreshRate: number,
  locale: Locale,
): Promise<void> {
  ensureWindows(locale);

  const response = await runBridge<BridgeApplyResponse>(
    `[DisplayBridge]::ApplyJson('${escapePowerShellSingleQuotedString(deviceName)}', ${width}, ${height}, ${refreshRate})`,
    locale,
  );

  if (!response.ok) {
    throw new Error(
      toApplyErrorMessage(
        response,
        deviceName,
        width,
        height,
        refreshRate,
        locale,
      ),
    );
  }
}

function ensureWindows(locale: Locale): void {
  if (process.platform !== "win32") {
    throw new Error(t(locale, "display.windowsOnly"));
  }
}

function escapePowerShellSingleQuotedString(value: string): string {
  return value.replaceAll("'", "''");
}

async function runBridge<T>(invocation: string, locale: Locale): Promise<T> {
  const script = [
    "$ErrorActionPreference = 'Stop'",
    `Add-Type -TypeDefinition @'\n${WINDOWS_DISPLAY_BRIDGE}\n'@`,
    invocation,
  ].join("\n\n");

  const stdout = await runPowerShell(script, locale);
  const trimmed = stdout.trim();

  if (trimmed.length === 0) {
    throw new Error(t(locale, "display.emptyPowerShell"));
  }

  return JSON.parse(trimmed) as T;
}

function toApplyErrorMessage(
  response: BridgeApplyResponse,
  deviceName: string,
  width: number,
  height: number,
  refreshRate: number,
  locale: Locale,
): string {
  const mode = formatMode(width, height, refreshRate);
  const code = response.code ?? "unknown";

  switch (response.reason) {
    case "missingMonitorId":
      return t(locale, "display.missingMonitorId");
    case "readCurrentFailed":
      return t(locale, "display.readCurrentFailed", { deviceName });
    case "testRejected":
      return t(locale, "display.testRejected", { code, mode });
    default:
      return t(locale, "display.applyFailed", { code, mode });
  }
}

function runPowerShell(script: string, locale: Locale): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(
      "powershell.exe",
      ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", "-"],
      {
        windowsHide: true,
        stdio: ["pipe", "pipe", "pipe"],
      },
    );

    let stdout = "";
    let stderr = "";

    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");

    child.stdout.on("data", (chunk: string) => {
      stdout += chunk;
    });

    child.stderr.on("data", (chunk: string) => {
      stderr += chunk;
    });

    child.on("error", (error) => {
      reject(error);
    });

    child.on("close", (code) => {
      if (code === 0) {
        resolve(stdout);
        return;
      }

      reject(
        new Error(
          stderr.trim() ||
            t(locale, "display.powerShellFailed", { code: code ?? "unknown" }),
        ),
      );
    });

    child.stdin.end(script);
  });
}
