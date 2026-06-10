import { createBrowserRouter } from "react-router";
import { Layout } from "./components/Layout";
import { Library } from "./screens/Library";
import { Queue } from "./screens/Queue";
import { Logs } from "./screens/Logs";
import { Settings } from "./screens/Settings";

export const router = createBrowserRouter([
  {
    path: "/",
    Component: Layout,
    children: [
      { index: true, Component: Library },
      { path: "queue", Component: Queue },
      { path: "logs", Component: Logs },
      { path: "settings", Component: Settings },
    ],
  },
]);
