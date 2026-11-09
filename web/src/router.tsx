import { lazy, Suspense } from "react";
import type { ReactNode } from "react";
import { createBrowserRouter, useLocation } from "react-router-dom";
import { App } from "./App";
import { LoadingState } from "./components/LoadingState";
import { ChatPage } from "./pages/ChatPage";
import { MandatePage } from "./pages/MandatePage";

const AuditPage = lazy(() =>
  import("./pages/AuditPage").then((module) => ({ default: module.AuditPage })),
);

function RouteTransition({ children }: { children: ReactNode }) {
  const { pathname } = useLocation();
  return (
    <div key={pathname} className="route-transition">
      {children}
    </div>
  );
}

export const router = createBrowserRouter([
  {
    path: "/",
    element: <App />,
    children: [
      {
        index: true,
        element: (
          <RouteTransition>
            <ChatPage />
          </RouteTransition>
        ),
      },
      {
        path: "mandate",
        element: (
          <RouteTransition>
            <MandatePage />
          </RouteTransition>
        ),
      },
      {
        path: "audit",
        element: (
          <Suspense fallback={<LoadingState />}>
            <RouteTransition>
              <AuditPage />
            </RouteTransition>
          </Suspense>
        ),
      },
    ],
  },
]);
