import { lazy, Suspense } from "react";
import "./styles/tokens.css";
import "./styles/app.css";

const VncRunnerWindowApp = lazy(async () => {
  const module = await import("./features/layout/VncRunnerWindowApp");
  return { default: module.VncRunnerWindowApp };
});

const WorkspaceShell = lazy(async () => {
  const module = await import("./features/layout/WorkspaceShell");
  return { default: module.WorkspaceShell };
});

function StartupFallback({ label }: { label: string }) {
  return (
    <div className="app-startup-shell" role="status" aria-live="polite">
      <span className="app-startup-spinner" aria-hidden="true" />
      <span>{label}</span>
    </div>
  );
}

export default function App() {
  const isVncRunner = new URLSearchParams(window.location.search).get("view") === "vnc-runner";
  const Component = isVncRunner ? VncRunnerWindowApp : WorkspaceShell;

  return (
    <Suspense fallback={<StartupFallback label={isVncRunner ? "正在加载 VNC 窗口..." : "正在加载工作区..."} />}>
      <Component />
    </Suspense>
  );
}
