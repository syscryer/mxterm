import { WorkspaceShell } from "./features/layout/WorkspaceShell";
import { VncRunnerWindowApp } from "./features/layout/VncRunnerWindowApp";
import "./styles/tokens.css";
import "./styles/app.css";

export default function App() {
  if (new URLSearchParams(window.location.search).get("view") === "vnc-runner") {
    return <VncRunnerWindowApp />;
  }

  return <WorkspaceShell />;
}
