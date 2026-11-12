import path from "node:path";
import { PlanError } from "../../../domain/plan.ts";
import { runPowerShell, tail } from "./recorded-run.ts";

// A program's windows, as its user sees and uses them. The browsers BaseSeer
// names serve a program used in pages; a program used in windows (a game, an
// audio tool, a desktop app) needs a way to be seen and used too, or nothing
// of it is tried as its user tries it.

export const PROGRAM_WINDOW_TOOL = "program_window";

/** One thing done to a window, in the order given. */
export type WindowStep =
  | { click: string }
  | { set: string; text: string }
  | { keys: string }
  | { hold: string; ms: number }
  | { clickAt: [number, number] }
  | { wait: number };

export type WindowRequest = { pid: number; window?: string; steps: WindowStep[] };

export type WindowView = {
  window: { title: string; width: number; height: number };
  /** The titles of the program's other windows, frontmost first. */
  others: string[];
  picture: string;
  controls: string[];
  done: string[];
  failed?: string;
};

const STEP_KINDS = ["click", "set", "keys", "hold", "clickAt", "wait"] as const;

const text = (value: unknown) => typeof value === "string" && value.length > 0;
const count = (value: unknown) => typeof value === "number" && Number.isFinite(value) && value >= 0;

/** A step as the session gave it, or an error naming what is wrong with it. */
function windowStep(step: any, n: number): WindowStep {
  const kinds = STEP_KINDS.filter((kind) => step?.[kind] !== undefined);
  const valid =
    kinds.length === 1 &&
    {
      click: () => text(step.click),
      set: () => text(step.set) && typeof step.text === "string",
      keys: () => text(step.keys),
      hold: () => text(step.hold) && count(step.ms),
      clickAt: () => Array.isArray(step.clickAt) && step.clickAt.length === 2 && step.clickAt.every(count),
      wait: () => count(step.wait),
    }[kinds[0]]();
  if (!valid)
    throw new PlanError(
      "INVALID",
      `Step ${n} must be one of {click: "<control>"}, {set: "<control>", text}, {keys}, {hold: "<key>", ms}, {clickAt: [x, y]} or {wait: ms}.`,
    );
  return step;
}

/** The request as the session gave it, checked before any of it runs. */
export function windowRequest(args: any): WindowRequest {
  if (!Number.isInteger(args?.pid) || args.pid <= 0)
    throw new PlanError("INVALID", "pid must be the process id of the program you started.");
  if (args.window !== undefined && !text(args.window))
    throw new PlanError("INVALID", "window must be part of a window's title.");
  const steps = args.steps === undefined ? [] : args.steps;
  if (!Array.isArray(steps)) throw new PlanError("INVALID", "steps must be a list.");
  return {
    pid: args.pid,
    ...(args.window ? { window: args.window } : {}),
    steps: steps.map((step: unknown, i: number) => windowStep(step, i + 1)),
  };
}

/** How much of a window's control list the session sees, as with a command's output. */
const CONTROLS_SHOWN = 12_000;

/** The controls that fit, and how many more there are. */
function shown(controls: string[]) {
  let length = 0;
  const fitting = controls.filter((line) => (length += line.length + 1) <= CONTROLS_SHOWN);
  const more = controls.length - fitting.length;
  return more ? [...fitting, `…and ${more} more`] : fitting;
}

/**
 * The window helpers PowerShell cannot reach on its own: the windows of a set
 * of processes, a window's picture, and the real keyboard and mouse. Windows
 * PowerShell compiles it with the .NET Framework's C# 5 compiler.
 */
const NATIVE = String.raw`
using System;
using System.Collections.Generic;
using System.Drawing;
using System.Drawing.Imaging;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;

public static class ProgramWindow {
  public class Window { public long Handle; public string Title; public int Width; public int Height; }
  [StructLayout(LayoutKind.Sequential)] public struct Box { public int Left, Top, Right, Bottom; }
  [StructLayout(LayoutKind.Sequential)] struct Input { public uint Type; public InputData Data; }
  [StructLayout(LayoutKind.Explicit)] struct InputData { [FieldOffset(0)] public MouseInput Mouse; [FieldOffset(0)] public KeyInput Key; }
  [StructLayout(LayoutKind.Sequential)] struct MouseInput { public int X, Y; public uint Data, Flags, Time; public IntPtr Extra; }
  [StructLayout(LayoutKind.Sequential)] struct KeyInput { public ushort Key, Scan; public uint Flags, Time; public IntPtr Extra; }
  delegate bool EachWindow(IntPtr window, IntPtr data);

  [DllImport("user32.dll")] static extern bool SetProcessDpiAwarenessContext(IntPtr context);
  [DllImport("user32.dll")] static extern bool EnumWindows(EachWindow each, IntPtr data);
  [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr window, out uint process);
  [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr window);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern int GetWindowText(IntPtr window, StringBuilder title, int length);
  [DllImport("user32.dll")] static extern bool GetWindowRect(IntPtr window, out Box box);
  [DllImport("user32.dll")] static extern bool PrintWindow(IntPtr window, IntPtr device, uint flags);
  [DllImport("user32.dll")] static extern bool IsIconic(IntPtr window);
  [DllImport("user32.dll")] static extern bool ShowWindow(IntPtr window, int how);
  [DllImport("user32.dll")] static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] static extern bool SetForegroundWindow(IntPtr window);
  [DllImport("user32.dll")] static extern bool BringWindowToTop(IntPtr window);
  [DllImport("user32.dll")] static extern bool AttachThreadInput(uint thread, uint to, bool attach);
  [DllImport("kernel32.dll")] static extern uint GetCurrentThreadId();
  [DllImport("user32.dll")] static extern bool SetCursorPos(int x, int y);
  [DllImport("user32.dll")] static extern uint SendInput(uint count, Input[] inputs, int size);
  [DllImport("user32.dll")] static extern uint MapVirtualKey(uint code, uint type);

  // Places in physical pixels, so a picture, a control's place and a click agree on any display scaling.
  public static void Init() { SetProcessDpiAwarenessContext(new IntPtr(-4)); }

  /** The visible windows of these processes, frontmost first. */
  public static List<Window> Of(int[] processes) {
    List<Window> found = new List<Window>();
    EnumWindows(delegate (IntPtr window, IntPtr data) {
      uint process;
      GetWindowThreadProcessId(window, out process);
      Box box;
      if (Array.IndexOf(processes, (int)process) >= 0 && IsWindowVisible(window) && GetWindowRect(window, out box)
          && box.Right - box.Left > 1 && box.Bottom - box.Top > 1) {
        StringBuilder title = new StringBuilder(512);
        GetWindowText(window, title, title.Capacity);
        Window w = new Window();
        w.Handle = window.ToInt64();
        w.Title = title.ToString();
        w.Width = box.Right - box.Left;
        w.Height = box.Bottom - box.Top;
        found.Add(w);
      }
      return true;
    }, IntPtr.Zero);
    return found;
  }

  public static Box Bounds(long handle) {
    Box box;
    GetWindowRect(new IntPtr(handle), out box);
    return box;
  }

  /** Draws the window as it shows, even behind other windows, games' rendered frames included. */
  public static void Capture(long handle, string path) {
    IntPtr window = new IntPtr(handle);
    if (IsIconic(window)) {
      // A minimized window has no picture: shown again without taking the screen from whoever has it.
      ShowWindow(window, 4);
      Thread.Sleep(300);
    }
    Box box = Bounds(handle);
    using (Bitmap picture = new Bitmap(Math.Max(1, box.Right - box.Left), Math.Max(1, box.Bottom - box.Top))) {
      using (Graphics graphics = Graphics.FromImage(picture)) {
        IntPtr device = graphics.GetHdc();
        try {
          if (!PrintWindow(window, device, 2)) throw new InvalidOperationException("Windows could not draw the window.");
        } finally {
          graphics.ReleaseHdc(device);
        }
      }
      picture.Save(path, ImageFormat.Png);
    }
  }

  /**
   * The real keyboard and mouse reach only the window in front. Windows lets a
   * program bring another to the front only while it shares the input of the
   * one in front now.
   */
  public static void Front(long handle) {
    IntPtr window = new IntPtr(handle);
    if (GetForegroundWindow() == window) return;
    if (IsIconic(window)) ShowWindow(window, 9);
    uint process;
    uint front = GetWindowThreadProcessId(GetForegroundWindow(), out process);
    uint self = GetCurrentThreadId();
    AttachThreadInput(self, front, true);
    BringWindowToTop(window);
    SetForegroundWindow(window);
    AttachThreadInput(self, front, false);
    Thread.Sleep(200);
    if (GetForegroundWindow() != window)
      throw new InvalidOperationException("Windows did not bring the window to the front, so keys and clicks would reach another program.");
  }

  public static void Hold(int key, int ms) {
    Key((ushort)key, false);
    Thread.Sleep(ms);
    Key((ushort)key, true);
  }

  /** Clicks a point of the window's picture. */
  public static void Click(long handle, int x, int y) {
    Box box = Bounds(handle);
    SetCursorPos(box.Left + x, box.Top + y);
    Mouse(0x2);
    Mouse(0x4);
  }

  // Games read a key by its scan code, and the arrows and the keys above them by theirs as extended keys.
  static void Key(ushort key, bool up) {
    Input input = new Input();
    input.Type = 1;
    input.Data.Key.Key = key;
    input.Data.Key.Scan = (ushort)MapVirtualKey(key, 0);
    bool extended = (key >= 0x21 && key <= 0x28) || key == 0x2D || key == 0x2E;
    input.Data.Key.Flags = (up ? 2u : 0u) | (extended ? 1u : 0u);
    Send(input);
  }

  static void Mouse(uint flags) {
    Input input = new Input();
    input.Data.Mouse.Flags = flags;
    Send(input);
  }

  static void Send(Input input) {
    if (SendInput(1, new[] { input }, Marshal.SizeOf(typeof(Input))) != 1)
      throw new InvalidOperationException("Windows refused the input.");
  }
}
`;

/**
 * Finds the program's window, does the steps and looks at the window again.
 * Pressing and setting go through UI Automation, which acts on the window
 * wherever it is, without the keyboard or the mouse.
 */
const SCRIPT = String.raw`
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [Text.Encoding]::UTF8
try {
  $request = $env:BASESEER_WINDOW_REQUEST | ConvertFrom-Json
  Add-Type -AssemblyName UIAutomationClient, UIAutomationTypes, System.Windows.Forms
  Add-Type -ReferencedAssemblies System.Drawing -TypeDefinition $env:BASESEER_WINDOW_NATIVE
  [ProgramWindow]::Init()

  # A launcher or an interpreter often starts the process that shows the window.
  $processes = @(Get-CimInstance Win32_Process | Select-Object ProcessId, ParentProcessId)
  $tree = New-Object System.Collections.Generic.List[int]
  $tree.Add([int]$request.pid)
  for ($i = 0; $i -lt $tree.Count; $i++) {
    foreach ($p in $processes) {
      if ($p.ParentProcessId -eq $tree[$i] -and -not $tree.Contains([int]$p.ProcessId)) { $tree.Add([int]$p.ProcessId) }
    }
  }

  function Find-Window {
    $windows = @([ProgramWindow]::Of($tree.ToArray()))
    if (-not $windows.Count) { throw "No window of process $($request.pid), or of a process it started, is showing." }
    if (-not $request.window) { return ,$windows }
    $named = @($windows | Where-Object { $_.Title.IndexOf($request.window, [StringComparison]::OrdinalIgnoreCase) -ge 0 })
    if (-not $named.Count) { throw "No window's title has '$($request.window)' in it: $(($windows | ForEach-Object Title) -join ', ')." }
    return ,($named + @($windows | Where-Object { $named -notcontains $_ }))
  }

  function Get-Controls($window) {
    [System.Windows.Automation.AutomationElement]::FromHandle([IntPtr]$window.Handle).FindAll(
      [System.Windows.Automation.TreeScope]::Descendants, [System.Windows.Automation.Condition]::TrueCondition)
  }

  function Get-Control($window, [string]$name) {
    foreach ($control in Get-Controls $window) {
      if ($control.Current.Name -eq $name -or $control.Current.AutomationId -eq $name) { return $control }
    }
    throw "The window has no control named '$name'."
  }

  function Get-Pattern($control, $pattern) {
    $found = $null
    if ($control.TryGetCurrentPattern($pattern, [ref]$found)) { return $found }
  }

  function Press($control) {
    if ($p = Get-Pattern $control ([System.Windows.Automation.InvokePattern]::Pattern)) { return $p.Invoke() }
    if ($p = Get-Pattern $control ([System.Windows.Automation.TogglePattern]::Pattern)) { return $p.Toggle() }
    if ($p = Get-Pattern $control ([System.Windows.Automation.SelectionItemPattern]::Pattern)) { return $p.Select() }
    if ($p = Get-Pattern $control ([System.Windows.Automation.ExpandCollapsePattern]::Pattern)) { return $p.Expand() }
    throw "'$($control.Current.Name)' cannot be pressed; click its place with clickAt."
  }

  $window = (Find-Window)[0]
  $done = @()
  $failed = $null
  $step = 0
  try {
    foreach ($s in @($request.steps)) {
      $step++
      if ($null -ne $s.click) {
        Press (Get-Control $window $s.click)
        $done += "pressed '$($s.click)'"
      } elseif ($null -ne $s.set) {
        $value = Get-Pattern (Get-Control $window $s.set) ([System.Windows.Automation.ValuePattern]::Pattern)
        if (-not $value) { throw "'$($s.set)' takes no text; click it and type with keys." }
        $value.SetValue($s.text)
        $done += "set '$($s.set)'"
      } elseif ($null -ne $s.keys) {
        [ProgramWindow]::Front($window.Handle)
        [System.Windows.Forms.SendKeys]::SendWait($s.keys)
        $done += "typed $($s.keys)"
      } elseif ($null -ne $s.hold) {
        [ProgramWindow]::Front($window.Handle)
        [ProgramWindow]::Hold([int][System.Windows.Forms.Keys]$s.hold, [int]$s.ms)
        $done += "held $($s.hold) for $($s.ms) ms"
      } elseif ($null -ne $s.clickAt) {
        [ProgramWindow]::Front($window.Handle)
        [ProgramWindow]::Click($window.Handle, [int]$s.clickAt[0], [int]$s.clickAt[1])
        $done += "clicked at $($s.clickAt -join ', ')"
      } else {
        Start-Sleep -Milliseconds ([int]$s.wait)
        $done += "waited $($s.wait) ms"
      }
    }
  } catch {
    $failed = "Step $step failed: $($_.Exception.Message)"
  }
  # A program repaints after the input it is given, not while it takes it.
  if ($step) { Start-Sleep -Milliseconds 300 }

  $windows = Find-Window
  $window = $windows[0]
  $picture = Join-Path $request.folder "test-results\windows\window-$($request.pid).png"
  [void](New-Item -ItemType Directory -Force (Split-Path $picture))
  [ProgramWindow]::Capture($window.Handle, $picture)
  $box = [ProgramWindow]::Bounds($window.Handle)
  # The controls a step can name; any other part of the window is clicked at its place in the picture.
  $controls = foreach ($control in Get-Controls $window) {
    $c = $control.Current
    if (-not $c.Name -and -not $c.AutomationId) { continue }
    $line = "$($c.ControlType.ProgrammaticName -replace '^ControlType\.', '') '$($c.Name)'"
    if ($c.AutomationId) { $line += " [$($c.AutomationId)]" }
    $value = Get-Pattern $control ([System.Windows.Automation.ValuePattern]::Pattern)
    if ($value -and -not $c.IsPassword -and $value.Current.Value) { $line += " = '$($value.Current.Value)'" }
    if (-not $c.IsEnabled) { $line += ' (disabled)' }
    $r = $c.BoundingRectangle
    if (-not $c.IsOffscreen -and -not $r.IsEmpty) {
      $line += " at $([int]($r.X - $box.Left)),$([int]($r.Y - $box.Top)) $([int]$r.Width)x$([int]$r.Height)"
    }
    $line
  }
  [ordered]@{
    window = [ordered]@{ title = $window.Title; width = $window.Width; height = $window.Height }
    others = @($windows | Select-Object -Skip 1 | ForEach-Object Title)
    picture = $picture
    controls = @($controls)
    done = @($done)
    failed = $failed
  } | ConvertTo-Json -Depth 4 -Compress
} catch {
  @{ error = $_.Exception.Message } | ConvertTo-Json -Compress
}
`;

/** Sees and uses one of the program's windows from `folder`, where its picture is saved. */
export async function useWindow(request: WindowRequest, folder: string, signal?: AbortSignal): Promise<WindowView> {
  if (process.platform !== "win32")
    throw new PlanError("UNAVAILABLE", "A program's windows can be seen and used only on Windows.");
  const result = await runPowerShell(SCRIPT, folder, signal, {
    BASESEER_WINDOW_REQUEST: JSON.stringify({ ...request, folder: path.resolve(folder) }),
    BASESEER_WINDOW_NATIVE: NATIVE,
  });
  const last = result.output.trim().split(/\r?\n/).at(-1) ?? "";
  let answer: any;
  try {
    answer = JSON.parse(last);
  } catch {
    throw new PlanError("UNAVAILABLE", `The window could not be read: ${tail(result.output)}`);
  }
  if (answer.error) throw new PlanError("INVALID", answer.error);
  const { failed, ...view } = answer;
  return { ...view, controls: shown(view.controls), ...(failed ? { failed } : {}) };
}
