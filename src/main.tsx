import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { createBrowserRouter, createMemoryRouter, Outlet, RouterProvider, type RouteObject } from "react-router";
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
import { ToastProvider } from "./components/Toast";
import { FlowsProvider } from "./app/Flows";
import { db } from "./lib/db";
import { TRIAL } from "./lib/env";

/** 全站共用的提示與流程（跨頁面時「復原」提示不會消失）。 */
function Root() {
  return (
    <ToastProvider>
      <FlowsProvider>
        <Outlet />
      </FlowsProvider>
    </ToastProvider>
  );
}

const routes: RouteObject[] = [
  {
    element: <Root />,
    children: [
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
    ],
  },
];

// 試用版放在分享網頁的框架裡，網址列不屬於 App：改用記憶體路由。
const router = TRIAL ? createMemoryRouter(routes) : createBrowserRouter(routes);
const root = createRoot(document.getElementById("root")!);

db.open()
  .then(() => {
    void boot();
    registerSW({ immediate: true });
    root.render(
      <StrictMode>
        <RouterProvider router={router} />
      </StrictMode>,
    );
  })
  .catch(() => root.render(<StorageBlocked />));

/** 無痕視窗或封鎖網站資料時，IndexedDB 打不開：說明原因，而不是一片空白。 */
function StorageBlocked() {
  return (
    <div style={{ minHeight: "100dvh", display: "grid", placeItems: "center", padding: "24px 16px", textAlign: "center" }}>
      <div style={{ maxWidth: 420, display: "flex", flexDirection: "column", gap: 12 }}>
        <p className="font-round" style={{ fontSize: "1.6rem", fontWeight: 800 }}>
          TaiOne care 無法在這個視窗儲存資料
        </p>
        <p style={{ fontWeight: 700, lineHeight: 1.7 }}>紀錄只存在這台裝置。請改用一般（非無痕）視窗開啟，或在瀏覽器設定允許這個網站儲存資料。</p>
      </div>
    </div>
  );
}
