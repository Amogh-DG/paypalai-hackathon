import { Outlet } from "react-router-dom";
import { Nav } from "./components/Nav";

export function App() {
  return (
    <>
      <Nav />
      <main className="page-content">
        <Outlet />
      </main>
    </>
  );
}
