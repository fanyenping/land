import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { createBrowserRouter, RouterProvider } from "react-router";
import { registerSW } from "virtual:pwa-register";
import "@fontsource-variable/noto-sans-tc";
import "@fontsource-variable/chiron-goround-tc";
import "@fontsource-variable/bricolage-grotesque";
import "./styles.css";
import { AppShell } from "./app/AppShell";
import { Today } from "./screens/Today";
import { Patients } from "./screens/Patients";
import { PatientDetail } from "./screens/PatientDetail";
import { Queue } from "./screens/Queue";
import { WorkspaceRoute } from "./screens/Workspace";
import { Recording } from "./screens/Recording";
import { SettingsScreen } from "./screens/Settings";
import { Welcome } from "./screens/Welcome";
import { NotFound } from "./screens/NotFound";
import { boot } from "./app/boot";

const router = createBrowserRouter([
  { path: "/welcome", element: <Welcome /> },
  { path: "/v/:id/rec", element: <Recording /> },
  {
    element: <AppShell />,
    children: [
      { path: "/", element: <Today /> },
      { path: "/patients", element: <Patients /> },
      { path: "/patients/:id", element: <PatientDetail /> },
      { path: "/queue", element: <Queue /> },
      { path: "/queue/:id", element: <Queue /> },
      { path: "/v/:id", element: <WorkspaceRoute /> },
      { path: "/settings", element: <SettingsScreen /> },
      { path: "*", element: <NotFound /> },
    ],
  },
]);

void boot();
registerSW({ immediate: true });

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <RouterProvider router={router} />
  </StrictMode>,
);
